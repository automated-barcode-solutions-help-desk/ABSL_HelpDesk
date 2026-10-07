-- =====================================================================
-- 0031_technician_logged_jobs_assigned.sql
--
-- A technician who logs a job takes it - unless they tick "Open it to
-- every technician". That is what the Log a Job form has always said
-- ("Can't take this yourself right now? Open it to every technician"),
-- but staff_log_ticket() only assigned the technician for a no-caller
-- self-job. A customer call a technician logged for himself was saved
-- with no technician at all: it showed as "Unassigned" in Reports and
-- never appeared under his name - even after he worked and resolved it
-- (as the job's creator he could still update it).
--
--   1. staff_log_ticket(): a technician's job is assigned to them unless
--      they open it to every technician. A job logged by an agent,
--      operator or admin still waits for an agent to assign it.
--   2. Existing jobs with no technician are credited to whoever has
--      them:
--        - the technician who last changed the job's status (they worked
--          it), otherwise
--        - the technician who logged it, unless they opened it to every
--          technician.
--      Jobs whose technician was deliberately removed (there is an
--      assignment change in the audit log) are left alone. No emails are
--      sent; every change is written to the audit log.
--   3. Prints the jobs it assigned, then every job still without a
--      technician and who logged it.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. staff_log_ticket() - same as 0029 apart from who gets assigned and
--    the matching note on the job's thread.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_log_ticket(
  p_company_name text,
  p_caller_name text,
  p_caller_phone text,
  p_title text,
  p_description text,
  p_priority text DEFAULT 'medium',
  p_job_type text DEFAULT 'fault',
  p_department text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_open_for_claim boolean DEFAULT false,
  p_self_job boolean DEFAULT false
)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_ticket public.tickets;
  v_assign_to uuid;
BEGIN
  IF coalesce(public.current_role()::text, '') NOT IN ('agent', 'technician', 'admin', 'operator') THEN
    RAISE EXCEPTION 'Only ABSL staff can log a job on someone else''s behalf.';
  END IF;

  IF coalesce(trim(p_company_name), '') = '' THEN
    RAISE EXCEPTION 'A company name is required.';
  END IF;

  -- A self-job has no caller to name - that is the whole point of it.
  IF NOT p_self_job AND coalesce(trim(p_caller_name), '') = '' THEN
    RAISE EXCEPTION 'The caller''s name is required.';
  END IF;

  SELECT id INTO v_company_id
  FROM public.companies
  WHERE lower(name) = lower(trim(p_company_name));

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, account_limit)
    VALUES (trim(p_company_name), 10)
    RETURNING id INTO v_company_id;
  END IF;

  -- A technician who logs a job takes it, unless they open it to every
  -- technician (a self-job is never opened - see open_for_claim below).
  -- Only a technician can be assigned_technician_id, so a job logged by
  -- an agent/operator/admin stays unassigned like any other new ticket.
  IF public.current_role() = 'technician'
     AND (p_self_job OR NOT coalesce(p_open_for_claim, false)) THEN
    v_assign_to := auth.uid();
  END IF;

  INSERT INTO public.tickets (
    company_id, created_by, caller_name, caller_phone,
    title, description, priority, job_type, department, location_name,
    open_for_claim, assigned_technician_id, status
  )
  VALUES (
    v_company_id,
    auth.uid(),
    CASE WHEN p_self_job THEN NULL ELSE trim(p_caller_name) END,
    CASE WHEN p_self_job THEN NULL ELSE nullif(trim(p_caller_phone), '') END,
    trim(p_title),
    coalesce(nullif(trim(p_description), ''), trim(p_title)),
    coalesce(nullif(lower(trim(p_priority)), ''), 'medium'),
    coalesce(nullif(lower(trim(p_job_type)), ''), 'fault'),
    nullif(trim(p_department), ''),
    nullif(trim(p_location), ''),
    -- A job assigned to its own creator is not "open" to anyone else.
    CASE WHEN p_self_job THEN false ELSE coalesce(p_open_for_claim, false) END,
    v_assign_to,
    'new'
  )
  RETURNING * INTO v_ticket;

  IF p_self_job THEN
    INSERT INTO public.ticket_comments (ticket_id, author_id, body)
    VALUES (
      v_ticket.id,
      auth.uid(),
      'Logged as a self-service job — no customer call.' ||
        CASE WHEN v_assign_to IS NOT NULL THEN ' Assigned to the technician who logged it.' ELSE '' END
    );
  ELSIF v_ticket.open_for_claim THEN
    INSERT INTO public.ticket_comments (ticket_id, author_id, body)
    VALUES (v_ticket.id, auth.uid(), 'Opened to all technicians - first to accept it gets the job.');
  ELSIF v_assign_to IS NOT NULL THEN
    INSERT INTO public.ticket_comments (ticket_id, author_id, body)
    VALUES (v_ticket.id, auth.uid(), 'Logged by the technician who took the call - assigned to them.');
  END IF;

  RETURN v_ticket;
END;
$$;


-- ---------------------------------------------------------------------
-- 2 + 3. Credit existing jobs, then print the outcome.
-- ---------------------------------------------------------------------
WITH status_workers AS (
  -- The technician who most recently moved each job along.
  SELECT DISTINCT ON (h.ticket_id) h.ticket_id, h.changed_by AS technician_id
  FROM public.ticket_status_history h
  JOIN public.profiles p ON p.id = h.changed_by AND p.role = 'technician'
  WHERE h.old_status IS NOT NULL
  ORDER BY h.ticket_id, h.created_at DESC
),
candidates AS (
  SELECT t.id,
         coalesce(w.technician_id, t.created_by) AS technician_id,
         CASE WHEN w.technician_id IS NOT NULL THEN 'they updated its status'
              ELSE 'they logged it' END AS reason
  FROM public.tickets t
  LEFT JOIN status_workers w ON w.ticket_id = t.id
  LEFT JOIN public.profiles creator ON creator.id = t.created_by
  WHERE t.assigned_technician_id IS NULL
    AND (
      w.technician_id IS NOT NULL
      OR (creator.role = 'technician' AND NOT coalesce(t.open_for_claim, false))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.record_table = 'tickets'
        AND a.record_id = t.id
        AND a.action = 'ticket.reassigned'
    )
),
assigned AS (
  UPDATE public.tickets t
  SET assigned_technician_id = c.technician_id,
      open_for_claim = false
  FROM candidates c
  WHERE t.id = c.id
  RETURNING t.id, t.ticket_number, t.status, t.company_id, c.technician_id, c.reason
),
logged AS (
  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  SELECT NULL, 'ticket.technician_credited', 'tickets', a.id,
         jsonb_build_object('to', a.technician_id, 'reason', a.reason, 'migration', '0031')
  FROM assigned a
  RETURNING record_id
)
SELECT 'assigned now' AS result,
       a.ticket_number,
       comp.name AS company,
       a.status::text AS status,
       tech.full_name AS technician,
       a.reason AS why
FROM assigned a
LEFT JOIN public.companies comp ON comp.id = a.company_id
LEFT JOIN public.profiles tech ON tech.id = a.technician_id
UNION ALL
SELECT 'still no technician',
       t.ticket_number,
       comp.name,
       t.status::text,
       NULL,
       'logged by ' || coalesce(creator.full_name, 'unknown') ||
         ' (' || coalesce(creator.role::text, 'no role') || ')' ||
         CASE WHEN t.open_for_claim THEN ' - open to every technician' ELSE '' END
FROM public.tickets t
LEFT JOIN public.companies comp ON comp.id = t.company_id
LEFT JOIN public.profiles creator ON creator.id = t.created_by
WHERE t.assigned_technician_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM assigned a WHERE a.id = t.id)
ORDER BY 1, 2;
