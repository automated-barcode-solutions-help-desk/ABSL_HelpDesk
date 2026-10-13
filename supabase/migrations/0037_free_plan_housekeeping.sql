-- =====================================================================
-- 0037_free_plan_housekeeping.sql
--
-- The helpdesk runs on Supabase's Free plan: 500 MB of database, 1 GB of
-- file storage and no automatic backups. This keeps it inside those
-- limits and makes up for the missing backups:
--
--   1. leftover_ticket_files() - photos and other files left in storage
--      after their ticket was deleted. Deleting a ticket removes its
--      database rows but the files themselves stayed behind, using space
--      nobody could see or free. The email worker removes them hourly.
--   2. free_plan_usage() - database and file space used against the
--      plan's limits, plus when the last backup was taken. Shown to the
--      CEO in the Main Console.
--   3. admin_backup() - every table as one JSON file the CEO downloads
--      from the Main Console. Each download is recorded in the audit log.
--   4. check_free_plan_limits() - run hourly by the email worker. Raises
--      a System Alert when storage or the database passes 80% of the
--      plan, and a weekly reminder when no backup has been taken.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Files left behind by deleted tickets.
-- ---------------------------------------------------------------------
-- Every upload goes to <ticket id>/<file> in one of the ticket buckets.
-- A file only counts as left over when its ticket no longer exists AND
-- nothing still points at it - receipts outlive their ticket on purpose
-- (ticket_receipts.ticket_id is ON DELETE SET NULL) and keep their photo.
-- Files younger than a day are never touched.
CREATE OR REPLACE FUNCTION public.leftover_ticket_files(p_limit integer DEFAULT 100)
RETURNS TABLE (bucket_id text, name text, bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0)
  FROM storage.objects o
  WHERE o.bucket_id IN ('ticket-photos', 'ticket-voice-notes', 'ticket-videos', 'ticket-service-receipts')
    AND o.created_at < now() - interval '1 day'
    AND split_part(o.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = split_part(o.name, '/', 1)::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.ticket_attachments a
                    WHERE a.bucket_name = o.bucket_id AND a.file_path = o.name)
    AND NOT EXISTS (SELECT 1 FROM public.ticket_receipts r
                    WHERE r.receipt_photo_bucket = o.bucket_id AND r.receipt_photo_path = o.name)
  ORDER BY o.created_at
  LIMIT greatest(coalesce(p_limit, 100), 0);
$$;

-- Only the email worker (service role) uses this directly.
REVOKE ALL ON FUNCTION public.leftover_ticket_files(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leftover_ticket_files(integer) TO service_role;


-- ---------------------------------------------------------------------
-- 2. Space used against the Free plan.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.free_plan_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buckets jsonb;
  v_storage bigint;
  v_files bigint;
  v_leftover jsonb;
  v_backup record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the CEO can see plan usage.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'files', b.files, 'bytes', b.bytes)
                            ORDER BY b.bytes DESC), '[]'::jsonb),
         coalesce(sum(b.bytes), 0),
         coalesce(sum(b.files), 0)
  INTO v_buckets, v_storage, v_files
  FROM (
    SELECT o.bucket_id, count(*) AS files, coalesce(sum((o.metadata->>'size')::bigint), 0) AS bytes
    FROM storage.objects o
    GROUP BY o.bucket_id
  ) b;

  SELECT jsonb_build_object('files', count(*), 'bytes', coalesce(sum(l.bytes), 0))
  INTO v_leftover
  FROM public.leftover_ticket_files(100000) l;

  SELECT a.created_at, coalesce(p.full_name, p.email) AS who
  INTO v_backup
  FROM public.audit_logs a
  LEFT JOIN public.profiles p ON p.id = a.actor_id
  WHERE a.action = 'backup.downloaded'
  ORDER BY a.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'database_limit', 500 * 1024 * 1024,
    'storage_bytes', v_storage,
    'storage_limit', 1024 * 1024 * 1024,
    'files', v_files,
    'buckets', v_buckets,
    'leftover', v_leftover,
    'last_backup_at', v_backup.created_at,
    'last_backup_by', v_backup.who
  );
END;
$$;

REVOKE ALL ON FUNCTION public.free_plan_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_plan_usage() TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. Backup: every table as JSON, for the CEO to download and keep.
-- ---------------------------------------------------------------------
-- Covers every table in the public schema, so tables added later are
-- included without changing this. Files in storage are listed (bucket,
-- name, size) but not copied - they are too big for one download.
CREATE OR REPLACE FUNCTION public.admin_backup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table record;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_table_count integer := 0;
  v_files jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the CEO can download a backup.';
  END IF;

  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t', v_table.relname)
      INTO v_rows;
    v_tables := v_tables || jsonb_build_object(v_table.relname, v_rows);
    v_counts := v_counts || jsonb_build_object(v_table.relname, jsonb_array_length(v_rows));
    v_total := v_total + jsonb_array_length(v_rows);
    v_table_count := v_table_count + 1;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'bucket', o.bucket_id, 'name', o.name,
           'bytes', coalesce((o.metadata->>'size')::bigint, 0), 'created_at', o.created_at)
         ORDER BY o.bucket_id, o.name), '[]'::jsonb)
  INTO v_files
  FROM storage.objects o;

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (auth.uid(), 'backup.downloaded', 'database', NULL,
          jsonb_build_object('rows', v_total, 'tables', v_table_count));

  -- A backup answers the weekly reminder.
  UPDATE public.admin_alerts
  SET acknowledged = true, acknowledged_by = auth.uid(), acknowledged_at = now()
  WHERE alert_type = 'backup_reminder' AND NOT acknowledged;

  RETURN jsonb_build_object(
    'format', 'absl-helpdesk-backup',
    'version', 1,
    'created_at', now(),
    'row_counts', v_counts,
    'tables', v_tables,
    'storage_files', v_files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backup() TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. Hourly check, run by the email worker.
-- ---------------------------------------------------------------------
-- One alert per kind at a time: nothing new is raised while an earlier
-- alert of the same kind is still unacknowledged.
CREATE OR REPLACE FUNCTION public.check_free_plan_limits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage jsonb := public.free_plan_usage();
  v_storage_pct numeric;
  v_db_pct numeric;
  v_raised text[] := ARRAY[]::text[];
BEGIN
  v_storage_pct := round(100.0 * (v_usage->>'storage_bytes')::numeric / (v_usage->>'storage_limit')::numeric);
  v_db_pct := round(100.0 * (v_usage->>'database_bytes')::numeric / (v_usage->>'database_limit')::numeric);

  IF v_storage_pct >= 80 AND NOT EXISTS (
    SELECT 1 FROM public.admin_alerts WHERE alert_type = 'storage_limit' AND NOT acknowledged
  ) THEN
    INSERT INTO public.admin_alerts (alert_type, severity, title, body)
    VALUES ('storage_limit', CASE WHEN v_storage_pct >= 95 THEN 'critical' ELSE 'warning' END,
            'Photo storage is ' || v_storage_pct || '% full',
            'The Free plan holds 1 GB of photos and files. When it is full, technicians cannot attach receipt photos and so cannot resolve jobs. '
            || 'Download a backup from the Main Console, then delete old test tickets, or move to Supabase Pro (100 GB).');
    v_raised := array_append(v_raised, 'storage_limit');
  END IF;

  IF v_db_pct >= 80 AND NOT EXISTS (
    SELECT 1 FROM public.admin_alerts WHERE alert_type = 'database_limit' AND NOT acknowledged
  ) THEN
    INSERT INTO public.admin_alerts (alert_type, severity, title, body)
    VALUES ('database_limit', CASE WHEN v_db_pct >= 95 THEN 'critical' ELSE 'warning' END,
            'Database is ' || v_db_pct || '% full',
            'The Free plan holds 500 MB of data. When it is full, Supabase makes the database read-only and no one can log or update jobs. '
            || 'Download a backup from the Main Console and move to Supabase Pro.');
    v_raised := array_append(v_raised, 'database_limit');
  END IF;

  IF (v_usage->>'last_backup_at' IS NULL OR (v_usage->>'last_backup_at')::timestamptz < now() - interval '7 days')
     AND EXISTS (SELECT 1 FROM public.tickets)
     AND NOT EXISTS (SELECT 1 FROM public.admin_alerts WHERE alert_type = 'backup_reminder' AND NOT acknowledged)
  THEN
    INSERT INTO public.admin_alerts (alert_type, severity, title, body)
    VALUES ('backup_reminder', 'info',
            'Weekly backup due',
            'The Free plan has no automatic backups. The CEO should open Main Console and choose "Download backup", '
            || 'then keep the file somewhere safe (Google Drive or a USB drive).');
    v_raised := array_append(v_raised, 'backup_reminder');
  END IF;

  RETURN jsonb_build_object('storage_pct', v_storage_pct, 'database_pct', v_db_pct, 'raised', to_jsonb(v_raised));
END;
$$;

REVOKE ALL ON FUNCTION public.check_free_plan_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_free_plan_limits() TO service_role;
