-- =====================================================================
-- 0025_self_service_tickets.sql
--
-- Not every job starts with a customer, on the portal or on the phone.
-- Sometimes a technician (or any staff member) has to go do something
-- that nobody called in about - routine maintenance, something they
-- spotted on a previous visit, anything self-initiated. Until now the
-- only entry point for a staff-logged job (staff_log_ticket) demanded a
-- caller's name, which made no sense for work that has no caller at all.
--
-- Adds a "this is my own job, nobody called" option to the same Log a
-- Job form every staff role already has (agent, operator, technician,
-- admin - not just technician, since anyone might need to log work with
-- no customer contact). Caller name/phone become optional instead of
-- required whenever this is set. And when the person logging it is a
-- technician, the job comes out already assigned to them - "his own" -
-- so they can just start it, or hand it to a colleague the exact same
-- way they can already hand off any job assigned to them
-- (reassign_ticket, unchanged by this file). It is deliberately NOT
-- auto-assigned for agent/operator/admin, since assigned_technician_id
-- can only ever be a technician account.
--
-- Idempotent: safe to re-run.
-- =====================================================================

DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean);

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
  IF public.current_role() NOT IN ('agent', 'technician', 'admin', 'operator') THEN
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

  -- Only a technician can be assigned_technician_id, so a self-job logged
  -- by an agent/operator/admin stays unassigned like any other new ticket.
  IF p_self_job AND public.current_role() = 'technician' THEN
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
  END IF;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean, boolean) TO authenticated;
