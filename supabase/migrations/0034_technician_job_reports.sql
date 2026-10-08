-- =====================================================================
-- 0034_technician_job_reports.sql
--
-- My Jobs & Reports for technicians.
--
--   1. tickets.assigned_at: when the current technician got the job. A
--      trigger sets it whenever the technician changes and clears it when
--      nobody has the job; a signed-in user can't edit it directly.
--      Existing jobs are filled in from their history.
--   2. technician_job_views: when a technician last opened a job they
--      hold. A job is "New" to its technician until they open it after it
--      was given to them, then "Assigned" until work starts. Handing a job
--      to someone else makes it New for them. mark_job_opened() records
--      it, and only for the job's own technician.
--   3. my_job_report(): every job assigned to the signed-in technician -
--      and nothing else. Who the technician is comes from the login, never
--      from a parameter, so no one can ask for someone else's jobs.
--      Operators keep report_jobs() for every technician.
--
-- Prints each technician's New / Assigned / Ongoing / Resolved counts.
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Assigned date.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_ticket_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_technician_id IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_technician_id IS NULL THEN NULL ELSE now() END;
  ELSIF auth.uid() IS NOT NULL THEN
    -- Only an assignment moves this date; nobody signed in can edit it.
    NEW.assigned_at := OLD.assigned_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_ticket_assignment ON public.tickets;
CREATE TRIGGER stamp_ticket_assignment
  BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_ticket_assignment();

-- Existing jobs: the best evidence of when their technician got them -
-- they logged it themselves, a recorded hand-over to them, the first
-- status change they made, the 0031/0032 credit, else the job's creation.
-- "Last updated" is left alone: filling in a date isn't an update.
ALTER TABLE public.tickets DISABLE TRIGGER set_tickets_updated_at;

UPDATE public.tickets t
SET assigned_at = coalesce(
  CASE WHEN t.created_by = t.assigned_technician_id THEN t.created_at END,
  (
    SELECT max(a.created_at) FROM public.audit_logs a
    WHERE a.record_table = 'tickets' AND a.record_id = t.id
      AND a.action = 'ticket.reassigned'
      AND a.metadata->>'to' = t.assigned_technician_id::text
  ),
  (
    SELECT min(h.created_at) FROM public.ticket_status_history h
    WHERE h.ticket_id = t.id AND h.changed_by = t.assigned_technician_id
      AND h.old_status IS NOT NULL
  ),
  (
    SELECT min(a.created_at) FROM public.audit_logs a
    WHERE a.record_table = 'tickets' AND a.record_id = t.id
      AND a.action = 'ticket.technician_credited'
      AND a.metadata->>'to' = t.assigned_technician_id::text
  ),
  t.created_at
)
WHERE t.assigned_technician_id IS NOT NULL
  AND t.assigned_at IS NULL;

ALTER TABLE public.tickets ENABLE TRIGGER set_tickets_updated_at;


-- ---------------------------------------------------------------------
-- 2. Opened by its technician.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.technician_job_views (
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, technician_id)
);

ALTER TABLE public.technician_job_views ENABLE ROW LEVEL SECURITY;

-- Read-only from the browser; mark_job_opened() is the only writer.
DROP POLICY IF EXISTS "Technicians see their own opened jobs" ON public.technician_job_views;
CREATE POLICY "Technicians see their own opened jobs"
  ON public.technician_job_views
  FOR SELECT
  TO authenticated
  USING (technician_id = auth.uid() OR public.is_office());

CREATE OR REPLACE FUNCTION public.mark_job_opened(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the job's own technician. For anyone else it isn't their job, so
  -- there is nothing to record.
  IF NOT EXISTS (
    SELECT 1 FROM public.tickets
    WHERE id = p_ticket_id AND assigned_technician_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.technician_job_views (ticket_id, technician_id, opened_at)
  VALUES (p_ticket_id, auth.uid(), now())
  ON CONFLICT (ticket_id, technician_id) DO UPDATE SET opened_at = EXCLUDED.opened_at;
END;
$$;

-- Jobs a technician has clearly already looked at count as opened: they
-- logged it, replied, added a photo, changed its status or took it.
INSERT INTO public.technician_job_views (ticket_id, technician_id, opened_at)
SELECT t.id, t.assigned_technician_id, now()
FROM public.tickets t
WHERE t.assigned_technician_id IS NOT NULL
  AND (
    t.created_by = t.assigned_technician_id
    OR EXISTS (SELECT 1 FROM public.ticket_comments c
               WHERE c.ticket_id = t.id AND c.author_id = t.assigned_technician_id)
    OR EXISTS (SELECT 1 FROM public.ticket_attachments f
               WHERE f.ticket_id = t.id AND f.uploaded_by = t.assigned_technician_id)
    OR EXISTS (SELECT 1 FROM public.ticket_status_history h
               WHERE h.ticket_id = t.id AND h.changed_by = t.assigned_technician_id
                 AND h.old_status IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.audit_logs a
               WHERE a.record_table = 'tickets' AND a.record_id = t.id
                 AND a.action = 'ticket.reassigned' AND a.actor_id = t.assigned_technician_id)
  )
ON CONFLICT (ticket_id, technician_id) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. The signed-in technician's own jobs.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_job_report(date, date);

CREATE OR REPLACE FUNCTION public.my_job_report(
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
  resolution_notes text,
  resolved_at timestamptz,
  company_id uuid,
  company_name text,
  customer_name text,
  caller_name text,
  technician_id uuid,
  technician_name text,
  assigned_at timestamptz,
  opened boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(public.current_role()::text, '') <> 'technician' THEN
    RAISE EXCEPTION 'My Job Reports are for technicians.';
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
    t.resolution_notes,
    (
      SELECT max(h.created_at) FROM public.ticket_status_history h
      WHERE h.ticket_id = t.id AND h.new_status = 'resolved'
    ) AS resolved_at,
    t.company_id,
    comp.name AS company_name,
    cust.full_name AS customer_name,
    t.caller_name,
    t.assigned_technician_id AS technician_id,
    tech.full_name AS technician_name,
    t.assigned_at,
    EXISTS (
      SELECT 1 FROM public.technician_job_views v
      WHERE v.ticket_id = t.id
        AND v.technician_id = t.assigned_technician_id
        AND (t.assigned_at IS NULL OR v.opened_at >= t.assigned_at)
    ) AS opened
  FROM public.tickets t
  LEFT JOIN public.companies comp ON comp.id = t.company_id
  LEFT JOIN public.profiles cust ON cust.id = t.created_by
  LEFT JOIN public.profiles tech ON tech.id = t.assigned_technician_id
  WHERE t.assigned_technician_id = auth.uid()
    AND (p_date_from IS NULL OR t.created_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_date_to IS NULL OR t.created_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Colombo'))
  ORDER BY t.created_at DESC
  LIMIT 20000;
END;
$$;

REVOKE ALL ON FUNCTION public.my_job_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_job_report(date, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_job_opened(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_job_opened(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. Each technician's counts, as their dashboard will show them.
-- ---------------------------------------------------------------------
SELECT coalesce(tech.full_name, tech.email) AS technician,
       count(*) FILTER (WHERE t.status = 'new' AND NOT seen.opened) AS "new",
       count(*) FILTER (WHERE t.status = 'new' AND seen.opened) AS assigned,
       count(*) FILTER (WHERE t.status = 'in_progress') AS ongoing,
       count(*) FILTER (WHERE t.status IN ('resolved', 'closed')) AS resolved
FROM public.tickets t
JOIN public.profiles tech ON tech.id = t.assigned_technician_id
CROSS JOIN LATERAL (
  SELECT EXISTS (
    SELECT 1 FROM public.technician_job_views v
    WHERE v.ticket_id = t.id
      AND v.technician_id = t.assigned_technician_id
      AND (t.assigned_at IS NULL OR v.opened_at >= t.assigned_at)
  ) AS opened
) seen
GROUP BY tech.full_name, tech.email
ORDER BY 1;
