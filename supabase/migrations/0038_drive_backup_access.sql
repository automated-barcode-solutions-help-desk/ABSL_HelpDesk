-- =====================================================================
-- 0038_drive_backup_access.sql
--
-- Automatic backups to Google Drive. A Google Apps Script in the
-- helpdesk's Google account calls the drive-export Edge Function every
-- hour; that function runs inside Supabase with the service role and
-- needs two things the CEO could already do from the Main Console:
--
--   * admin_backup()  - every table as JSON, saved to Drive daily;
--   * report_jobs()   - the jobs report, saved to Drive as a monthly
--                       Google Sheet.
--
-- Both now also accept the service role (the JWT role claim, which only
-- Supabase's own servers hold - never a signed-in user or a visitor).
-- Nothing else changes: anon still has no EXECUTE on either, operators
-- still can't back up, technicians and customers still can't report.
--
-- A Drive backup is recorded in the audit log like a manual one, so the
-- Main Console shows it as the last backup and the weekly reminder
-- (0037) only fires if the Drive copies stop.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- report_jobs (copied from 0033; only the access check changes)
CREATE OR REPLACE FUNCTION public.report_jobs(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  ticket_number text,
  title text,
  description text,
  status public.ticket_status,
  job_type text,
  priority text,
  service_call_number text,
  installation_number text,
  reference_number text,
  resolution_notes text,
  resolved_at timestamptz,
  company_id uuid,
  company_name text,
  customer_name text,
  customer_email text,
  caller_name text,
  caller_phone text,
  technician_id uuid,
  technician_name text,
  technician_notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_office() AND coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only operators and the CEO can run reports.';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.created_at,
    t.ticket_number,
    t.title,
    t.description,
    t.status,
    t.job_type,
    t.priority,
    t.service_call_number,
    t.installation_number,
    t.reference_number,
    t.resolution_notes,
    (
      SELECT max(h.created_at) FROM public.ticket_status_history h
      WHERE h.ticket_id = t.id AND h.new_status = 'resolved'
    ) AS resolved_at,
    t.company_id,
    comp.name AS company_name,
    cust.full_name AS customer_name,
    cust.email AS customer_email,
    t.caller_name,
    t.caller_phone,
    t.assigned_technician_id AS technician_id,
    tech.full_name AS technician_name,
    -- What the technicians wrote on the ticket thread, oldest first.
    (
      SELECT string_agg(
               to_char(c.created_at AT TIME ZONE 'Asia/Colombo', 'DD Mon HH24:MI') || ' - ' || c.body,
               E'\n' ORDER BY c.created_at
             )
      FROM public.ticket_comments c
      JOIN public.profiles author ON author.id = c.author_id
      WHERE c.ticket_id = t.id AND author.role = 'technician'
    ) AS technician_notes
  FROM public.tickets t
  LEFT JOIN public.companies comp ON comp.id = t.company_id
  LEFT JOIN public.profiles cust ON cust.id = t.created_by
  LEFT JOIN public.profiles tech ON tech.id = t.assigned_technician_id
  WHERE (p_date_from IS NULL OR t.created_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_date_to IS NULL OR t.created_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Colombo'))
  ORDER BY t.created_at DESC
  LIMIT 20000;
END;
$$;

REVOKE ALL ON FUNCTION public.report_jobs(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_jobs(date, date) TO authenticated, service_role;


-- admin_backup (copied from 0037; access check and audit source change)
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
  IF NOT public.is_admin() AND coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
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
          jsonb_build_object('rows', v_total, 'tables', v_table_count,
                             'source', CASE WHEN auth.uid() IS NULL THEN 'google-drive' ELSE 'download' END));

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


-- free_plan_usage (copied from 0037; names a Drive backup)
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

  SELECT a.created_at, coalesce(p.full_name, p.email, 'Google Drive (automatic)') AS who
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
