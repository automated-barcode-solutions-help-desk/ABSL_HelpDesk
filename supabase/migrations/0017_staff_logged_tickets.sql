-- =====================================================================
-- 0017_staff_logged_tickets.sql
--
-- Until now a ticket only existed if a customer raised it themselves
-- through the portal. Real work doesn't only arrive that way - a
-- customer phones ABSL directly, an agent or technician takes the call,
-- and does the job. That work never went into the system at all, so
-- Reports, the service call receipt archive, and the audit trail all
-- missed it - the "one searchable place for every job" Reports promises
-- was never actually true for phone-in work.
--
-- Adds a staff-only way to log a job on a caller's behalf: agent,
-- technician or admin enters the caller's name, phone and company (an
-- unrecognised company name is created on the spot, the same way
-- registration already does), plus the usual title/description/priority.
-- From there it is a completely ordinary ticket - assign it, resolve it
-- with the same service-call-number-and-photo requirement as any other
-- job, and it shows up in Reports exactly like a customer-raised one.
--
-- ticket_detail() needs no change: it returns to_jsonb(the whole ticket
-- row), so the two new columns are already included.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Two new columns. Both null for an ordinary customer-raised ticket;
--    both set only for one a staff member logged on a caller's behalf.
--    created_by is still set (to the staff member who took the call) -
--    that is what makes it visible to them under can_view_ticket(), and
--    it is who actually gets credited/audited for logging it. There is
--    no profile for the caller themselves, since the whole point is they
--    never touched the portal - caller_name/caller_phone is the only
--    record of who they are.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS caller_name text,
  ADD COLUMN IF NOT EXISTS caller_phone text;


-- ---------------------------------------------------------------------
-- 2. staff_log_ticket(): the only way these two columns ever get set.
--    Mirrors the same "look up the company by name, create it if this is
--    the first time we've heard of it" logic the signup trigger (0002)
--    already uses, so a brand new caller's company doesn't have to exist
--    in the system beforehand.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_log_ticket(
  p_company_name text,
  p_caller_name text,
  p_caller_phone text,
  p_title text,
  p_description text,
  p_priority text DEFAULT 'medium'
)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_ticket public.tickets;
BEGIN
  IF public.current_role() NOT IN ('agent', 'technician', 'admin') THEN
    RAISE EXCEPTION 'Only ABSL staff can log a job on someone else''s behalf.';
  END IF;

  IF coalesce(trim(p_company_name), '') = '' THEN
    RAISE EXCEPTION 'A company name is required.';
  END IF;

  IF coalesce(trim(p_caller_name), '') = '' THEN
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

  INSERT INTO public.tickets (
    company_id, created_by, caller_name, caller_phone,
    title, description, priority, status
  )
  VALUES (
    v_company_id,
    auth.uid(),
    trim(p_caller_name),
    nullif(trim(p_caller_phone), ''),
    trim(p_title),
    -- Same fallback the customer-facing form already relies on
    -- (createRealTicket() in app.js): description is optional there, and
    -- the tickets_description_length constraint requires it non-empty,
    -- so an unfilled one just repeats the title.
    coalesce(nullif(trim(p_description), ''), trim(p_title)),
    coalesce(nullif(lower(trim(p_priority)), ''), 'medium'),
    'new'
  )
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text) TO authenticated;


-- ---------------------------------------------------------------------
-- 3. queue_ticket_notification(): a staff-logged ticket's created_by is
--    the staff member who took the call, not a real customer account.
--    Unguarded, this would email that staff member "your ticket was
--    created" and then "your ticket status changed to ..." for their own
--    work - self-addressed noise, not a real customer notification. The
--    caller has no account and no email on file to notify instead, so
--    the correct behaviour is simply not to queue this one.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_ticket_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_email text;
  v_body text;
BEGIN
  IF NEW.caller_name IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_creator_email
  FROM public.profiles
  WHERE id = NEW.created_by;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications(ticket_id, recipient_profile_id, recipient_email, subject, body)
    VALUES (
      NEW.id,
      NEW.created_by,
      v_creator_email,
      'Ticket created: ' || NEW.ticket_number,
      'Your support ticket was created successfully.'
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'resolved' THEN
      v_body := 'Your ticket has been resolved.';

      IF NEW.resolution_notes IS NOT NULL AND trim(NEW.resolution_notes) <> '' THEN
        v_body := v_body || E'\n\nWhat we did: ' || NEW.resolution_notes;
      END IF;

      IF NEW.service_call_number IS NOT NULL AND trim(NEW.service_call_number) <> '' THEN
        v_body := v_body || E'\n\nService call number: ' || NEW.service_call_number;
      END IF;
    ELSE
      v_body := 'Your ticket status changed to ' || NEW.status::text || '.';
    END IF;

    INSERT INTO public.notifications(ticket_id, recipient_profile_id, recipient_email, subject, body)
    VALUES (
      NEW.id,
      NEW.created_by,
      v_creator_email,
      'Ticket status updated: ' || NEW.ticket_number,
      v_body
    );
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 4. Companies were only readable by agent/admin (or your own company) -
--    a technician logging a call-in job needs to see the company list
--    too, to pick an existing one instead of accidentally creating a
--    near-duplicate by retyping a name slightly differently. This is not
--    new exposure: a technician can already see any ticket's company
--    name through ticket_detail() for a job assigned to them; this just
--    lets them browse the list up front.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Companies visible to same company and staff" ON public.companies;
CREATE POLICY "Companies visible to same company and staff"
ON public.companies FOR SELECT
TO authenticated
USING (
  id IN (SELECT company_id FROM public.profiles WHERE profiles.id = auth.uid())
  OR public.current_role() IN ('agent', 'admin', 'technician')
);


-- ---------------------------------------------------------------------
-- 5. report_search(): surface the caller's name/phone alongside the
--    profile-joined customer_name/customer_email it already returns.
--    Kept as separate columns rather than overwriting customer_name -
--    for a staff-logged ticket customer_name is the staff member who
--    logged it (a real, meaningful fact: who took the call), and
--    caller_name is who it was actually for. The client shows whichever
--    applies.
--
--    This keeps the exact same argument list 0016 just created (only the
--    output columns are changing), which PostgreSQL treats as redefining
--    that same function - and it refuses to change a function's return
--    type in place ("cannot change return type of existing function...
--    Use DROP FUNCTION first"). Without this, running this file after
--    0016 would fail outright, rolling back everything else in it too
--    (staff_log_ticket, the notification fix, the companies policy).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.report_search(text, text, date, date, text, text, uuid);

CREATE OR REPLACE FUNCTION public.report_search(
  p_customer_query text DEFAULT NULL,
  p_service_call_number text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_technician_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  ticket_number text,
  title text,
  description text,
  status public.ticket_status,
  priority text,
  service_call_number text,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz,
  customer_name text,
  customer_email text,
  company_name text,
  technician_name text,
  attachment_count bigint,
  caller_name text,
  caller_phone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_pattern text;
  v_service_call_pattern text;
BEGIN
  IF p_customer_query IS NOT NULL AND trim(p_customer_query) <> '' THEN
    v_customer_pattern := '%' || replace(replace(replace(p_customer_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  IF p_service_call_number IS NOT NULL AND trim(p_service_call_number) <> '' THEN
    v_service_call_pattern := '%' || replace(replace(replace(p_service_call_number, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.ticket_number,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.service_call_number,
    t.resolution_notes,
    (
      SELECT max(h.created_at) FROM public.ticket_status_history h
      WHERE h.ticket_id = t.id AND h.new_status = 'resolved'
    ) AS resolved_at,
    t.created_at,
    cust.full_name AS customer_name,
    cust.email AS customer_email,
    comp.name AS company_name,
    tech.full_name AS technician_name,
    (
      SELECT count(*) FROM public.ticket_attachments a WHERE a.ticket_id = t.id
    ) AS attachment_count,
    t.caller_name,
    t.caller_phone
  FROM public.tickets t
  LEFT JOIN public.profiles cust ON cust.id = t.created_by
  LEFT JOIN public.profiles tech ON tech.id = t.assigned_technician_id
  LEFT JOIN public.companies comp ON comp.id = t.company_id
  WHERE public.current_role() IN ('agent', 'admin')
    AND (
      v_customer_pattern IS NULL
      OR cust.full_name ILIKE v_customer_pattern
      OR cust.email ILIKE v_customer_pattern
      OR comp.name ILIKE v_customer_pattern
      OR t.caller_name ILIKE v_customer_pattern
    )
    AND (
      v_service_call_pattern IS NULL
      OR t.service_call_number ILIKE v_service_call_pattern
    )
    AND (p_date_from IS NULL OR t.created_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_date_to IS NULL OR t.created_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_status IS NULL OR t.status = p_status::public.ticket_status)
    AND (p_priority IS NULL OR t.priority = p_priority)
    AND (p_technician_id IS NULL OR t.assigned_technician_id = p_technician_id)
  ORDER BY t.created_at DESC
  LIMIT 500;
END;
$$;
