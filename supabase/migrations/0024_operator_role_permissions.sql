-- =====================================================================
-- 0024_operator_role_permissions.sql
--
-- Run this AFTER 0023_add_operator_role.sql has been run and committed
-- on its own (see that file's header for why).
--
-- What an operator can do, end to end:
--   - See every ticket, not just their own (same breadth as agent/admin) -
--     "check unassigned tickets" needs this, since an unassigned ticket
--     belongs to nobody yet.
--   - Log a phone-in job (staff_log_ticket), including the "open to every
--     technician" checkbox added in 0022.
--   - Release an ALREADY-EXISTING unassigned ticket to that same open
--     pool after the fact - the new release_ticket_to_pool() below. This
--     is deliberately separate from directly assigning a named
--     technician: that stays an agent/admin action (or a technician
--     claiming their own), exactly as before. An operator dispatches by
--     opening the job to everyone, not by picking a name.
--   - See and acknowledge admin_alerts, same as admin.
--   - Edit basic ticket fields and the callback queue, same as agent.
--
-- Deliberately NOT granted: managing companies/account limits, approving
-- registrations, promoting accounts, deleting tickets, managing
-- inventory, or reading Reports/notifications/client error logs - none of
-- that was asked for, and admin keeps sole ownership of it.
--
-- Idempotent: safe to re-run (after 0023 has committed).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. can_view_ticket(): operator sees every ticket, same as agent/admin.
-- ---------------------------------------------------------------------
create or replace function public.can_view_ticket(ticket_row public.tickets)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    ticket_row.created_by = auth.uid()
    or ticket_row.assigned_agent_id = auth.uid()
    or ticket_row.assigned_technician_id = auth.uid()
    or public.current_role() in ('agent', 'admin', 'operator')
    or (
      ticket_row.open_for_claim = true
      and ticket_row.assigned_technician_id is null
      and public.current_role() = 'technician'
    )
$$;


-- ---------------------------------------------------------------------
-- 2. Companies visible to staff (needed for the Log-a-Call-In-Job
--    company picker) - same policy 0017 defined, operator added.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Companies visible to same company and staff" ON public.companies;
CREATE POLICY "Companies visible to same company and staff"
ON public.companies FOR SELECT
TO authenticated
USING (
  id IN (SELECT company_id FROM public.profiles WHERE profiles.id = auth.uid())
  OR public.current_role() IN ('agent', 'admin', 'technician', 'operator')
);


-- ---------------------------------------------------------------------
-- 3. Profiles visible to staff - without this, ticket queries that join
--    the creator's profile (created_by_profile:profiles!...) silently
--    show "Customer" for every ticket, because the join itself is RLS-
--    filtered independently of can_view_ticket() on the ticket row.
-- ---------------------------------------------------------------------
drop policy if exists "Profiles visible to self and staff" on public.profiles;
create policy "Profiles visible to self and staff"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.current_role() in ('agent', 'admin', 'operator')
);


-- ---------------------------------------------------------------------
-- 4. Staff update tickets - lets an operator correct a ticket's title,
--    priority or location the same way an agent can. This does NOT by
--    itself grant technician assignment - that is a separate RPC
--    (reassign_ticket, gated by is_staff(), left untouched below).
-- ---------------------------------------------------------------------
drop policy if exists "Staff update tickets" on public.tickets;
create policy "Staff update tickets"
on public.tickets for update
to authenticated
using (
  assigned_agent_id = auth.uid()
  or assigned_technician_id = auth.uid()
  or public.current_role() in ('agent', 'admin', 'operator')
)
with check (
  assigned_agent_id = auth.uid()
  or assigned_technician_id = auth.uid()
  or public.current_role() in ('agent', 'admin', 'operator')
);


-- ---------------------------------------------------------------------
-- 5. Callback queue - operator works this the same way agent does.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view all callback requests" ON public.callback_requests;
CREATE POLICY "Staff can view all callback requests"
  ON public.callback_requests
  FOR SELECT
  TO authenticated
  USING (public.current_role() IN ('agent', 'admin', 'operator'));

DROP POLICY IF EXISTS "Staff can update callback requests" ON public.callback_requests;
CREATE POLICY "Staff can update callback requests"
  ON public.callback_requests
  FOR UPDATE
  TO authenticated
  USING (public.current_role() IN ('agent', 'admin', 'operator'))
  WITH CHECK (public.current_role() IN ('agent', 'admin', 'operator'));

CREATE OR REPLACE FUNCTION public.complete_callback(
  p_callback_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.callback_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.callback_requests;
BEGIN
  IF public.current_role() NOT IN ('agent', 'admin', 'operator') THEN
    RAISE EXCEPTION 'Only an agent, operator or admin can complete a callback.';
  END IF;

  UPDATE public.callback_requests
  SET status = 'completed',
      completed_by = auth.uid(),
      completed_at = now()
  WHERE id = p_callback_id
    AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Callback request not found, or it was already completed.';
  END IF;

  PERFORM set_config('absl.status_rpc', '1', true);
  UPDATE public.tickets SET wants_callback = false WHERE id = v_row.ticket_id;
  PERFORM set_config('absl.status_rpc', '0', true);

  INSERT INTO public.ticket_comments (ticket_id, author_id, body)
  VALUES (
    v_row.ticket_id,
    auth.uid(),
    'Callback completed by phone.' ||
      CASE WHEN coalesce(trim(p_note), '') = '' THEN '' ELSE ' Note: ' || trim(p_note) END
  );

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (auth.uid(), 'callback.completed', 'callback_requests', v_row.id,
          jsonb_build_object('ticket_id', v_row.ticket_id));

  RETURN v_row;
END;
$$;


-- ---------------------------------------------------------------------
-- 6. admin_alerts - operator sees and acknowledges alerts, same as
--    admin. These policies checked profiles.role directly rather than
--    going through current_role(), so the replacement keeps that shape.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view admin_alerts" ON public.admin_alerts;
CREATE POLICY "Admins can view admin_alerts"
  ON public.admin_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'operator')
        AND profiles.approval_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Admins can update admin_alerts" ON public.admin_alerts;
CREATE POLICY "Admins can update admin_alerts"
  ON public.admin_alerts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'operator')
        AND profiles.approval_status = 'approved'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'operator')
        AND profiles.approval_status = 'approved'
    )
  );


-- ---------------------------------------------------------------------
-- 7. staff_log_ticket(): operator can log a phone-in job, same as agent
--    and technician. Same signature as 0022's version - only the role
--    check changes - so this is a plain CREATE OR REPLACE, no DROP
--    needed.
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
  p_open_for_claim boolean DEFAULT false
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
  IF public.current_role() NOT IN ('agent', 'technician', 'admin', 'operator') THEN
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
    title, description, priority, job_type, department, location_name,
    open_for_claim, status
  )
  VALUES (
    v_company_id,
    auth.uid(),
    trim(p_caller_name),
    nullif(trim(p_caller_phone), ''),
    trim(p_title),
    coalesce(nullif(trim(p_description), ''), trim(p_title)),
    coalesce(nullif(lower(trim(p_priority)), ''), 'medium'),
    coalesce(nullif(lower(trim(p_job_type)), ''), 'fault'),
    nullif(trim(p_department), ''),
    nullif(trim(p_location), ''),
    coalesce(p_open_for_claim, false),
    'new'
  )
  RETURNING * INTO v_ticket;

  IF v_ticket.open_for_claim THEN
    INSERT INTO public.ticket_comments (ticket_id, author_id, body)
    VALUES (v_ticket.id, auth.uid(), 'Opened to all technicians - first to accept it gets the job.');
  END IF;

  RETURN v_ticket;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. release_ticket_to_pool(): the new half of the dispatcher job - take
--    a ticket that already exists and is still unassigned (raised by a
--    customer, or logged without checking the "open to everyone" box)
--    and open it to every technician, the same way staff_log_ticket's
--    checkbox does at creation time.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_ticket_to_pool(p_ticket_id uuid)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets;
BEGIN
  IF public.current_role() NOT IN ('agent', 'admin', 'operator') THEN
    RAISE EXCEPTION 'Only an agent, operator or admin can release a job to the technician pool.';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket.assigned_technician_id IS NOT NULL THEN
    RAISE EXCEPTION 'This job is already assigned to a technician.';
  END IF;

  IF v_ticket.open_for_claim THEN
    RAISE EXCEPTION 'This job is already open to every technician.';
  END IF;

  UPDATE public.tickets
  SET open_for_claim = true
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  INSERT INTO public.ticket_comments (ticket_id, author_id, body)
  VALUES (p_ticket_id, auth.uid(), 'Released to the open pool - any technician can now accept it.');

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_ticket_to_pool(uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- 9. queue_comment_notification(): when a customer replies on a ticket
--    that has no technician yet, operator gets notified alongside every
--    agent/admin - they're as likely as anyone to be the one triaging it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_comment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets;
  v_author text;
  v_recipient uuid;
  v_email text;
  v_staff record;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_author FROM public.profiles WHERE id = NEW.author_id;

  IF NEW.author_id = v_ticket.created_by THEN
    v_recipient := v_ticket.assigned_technician_id;

    IF v_recipient IS NULL THEN
      FOR v_staff IN
        SELECT id, email FROM public.profiles
        WHERE role IN ('agent', 'admin', 'operator')
          AND approval_status = 'approved'
          AND email IS NOT NULL
          AND id <> NEW.author_id
      LOOP
        INSERT INTO public.notifications (
          ticket_id, recipient_profile_id, recipient_email, channel, subject, body
        )
        VALUES (
          NEW.ticket_id,
          v_staff.id,
          v_staff.email,
          'email',
          'New reply on ' || v_ticket.ticket_number,
          coalesce(v_author, 'Someone') || ' replied: ' || left(NEW.body, 500)
        );
      END LOOP;
      RETURN NEW;
    END IF;
  ELSE
    v_recipient := v_ticket.created_by;
  END IF;

  IF v_recipient IS NULL OR v_recipient = NEW.author_id THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_recipient;
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    ticket_id, recipient_profile_id, recipient_email, channel, subject, body
  )
  VALUES (
    NEW.ticket_id,
    v_recipient,
    v_email,
    'email',
    'New reply on ' || v_ticket.ticket_number,
    coalesce(v_author, 'Someone') || ' replied: ' || left(NEW.body, 500)
  );

  RETURN NEW;
END;
$$;
