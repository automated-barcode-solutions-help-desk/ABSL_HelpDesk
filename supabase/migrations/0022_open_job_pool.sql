-- =====================================================================
-- 0022_open_job_pool.sql
--
-- A technician who takes a call directly (staff_log_ticket) sometimes
-- can't do the job themselves right then. Until now the only options
-- were: leave it unassigned where only agents/admins could see it, or
-- assign it to themselves anyway. This adds a third option: open it to
-- every technician at once - first to accept it gets it, and if nobody
-- does, an agent or admin can still assign it manually exactly as
-- before. Nothing about the manual path changes.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The flag itself. False for every existing/ordinary ticket - it only
--    ever becomes true when the logging staff member explicitly chooses
--    "open this to any technician".
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS open_for_claim boolean NOT NULL DEFAULT false;


-- ---------------------------------------------------------------------
-- 2. can_view_ticket(): a technician can now also see an unassigned
--    ticket that has been opened to the pool, not just their own jobs.
--    This is the row-taking overload from 0001; the uuid-taking overload
--    added in 0002 just calls this one, so it picks the change up for
--    free, and so does the "Tickets visible by role" SELECT policy that
--    already reads through it.
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
    or public.current_role() in ('agent', 'admin')
    or (
      ticket_row.open_for_claim = true
      and ticket_row.assigned_technician_id is null
      and public.current_role() = 'technician'
    )
$$;


-- ---------------------------------------------------------------------
-- 3. staff_log_ticket(): the "open this to any technician" checkbox.
--    Adding an argument changes the signature from 0021's version, so
--    that 9-argument overload must be dropped first - same reasoning as
--    every earlier change to this function.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text, text, text);

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

GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean) TO authenticated;


-- ---------------------------------------------------------------------
-- 4. reassign_ticket() already lets a technician self-assign an
--    unassigned ticket (0006_audit_fixes.sql added that guard rail: "you
--    may only claim an unassigned job for yourself, not assign it to
--    someone else"). That path already existed but was unreachable from
--    the UI, because a technician could never SEE an unassigned ticket
--    that wasn't theirs until step 2 above. So "Accept" for an open job
--    is just reassign_ticket(ticket_id, self) - no new RPC needed - and
--    it is already race-safe: the function's `SELECT ... FOR UPDATE`
--    locks the row, so if two technicians tap Accept at once, the second
--    one's transaction waits, then sees the first technician already
--    assigned and hits "you may only claim an unassigned job", not a
--    double-claim.
--
--    All that is left is making sure a self-claim also leaves the open
--    pool, same as any other assignment - the redefinition below adds
--    exactly that one line.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_ticket(
  p_ticket_id uuid,
  p_technician_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets;
  v_previous uuid;
  v_new_name text;
  v_new_email text;
  v_old_name text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only ABSL staff can assign a technician.';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  v_previous := v_ticket.assigned_technician_id;

  IF public.current_role() = 'technician' THEN
    -- May only touch a job that is unclaimed or already theirs. Handing a
    -- colleague's active job to someone else is an agent/admin action, not
    -- something any technician can do to any other technician.
    IF v_previous IS NOT NULL AND v_previous <> auth.uid() THEN
      RAISE EXCEPTION 'You may only claim an unassigned job or hand off a job currently assigned to you.';
    END IF;

    -- "Claim" means claim for yourself. Without this, a technician could
    -- leave a job unclaimed by themselves but still choose which colleague
    -- picks it up next — the same unsupervised handoff closed above, just
    -- approached from the unclaimed side instead of the assigned side.
    IF v_previous IS NULL AND p_technician_id IS NOT NULL AND p_technician_id <> auth.uid() THEN
      RAISE EXCEPTION 'You may only claim an unassigned job for yourself, not assign it to someone else.';
    END IF;
  END IF;

  IF p_technician_id IS NOT NULL THEN
    SELECT full_name, email INTO v_new_name, v_new_email
    FROM public.profiles
    WHERE id = p_technician_id
      AND role = 'technician'
      AND approval_status = 'approved';

    IF v_new_name IS NULL THEN
      RAISE EXCEPTION 'That technician is not an approved technician account.';
    END IF;
  END IF;

  SELECT full_name INTO v_old_name FROM public.profiles WHERE id = v_previous;

  PERFORM set_config('absl.status_rpc', '1', true);
  UPDATE public.tickets
  SET assigned_technician_id = p_technician_id,
      open_for_claim = false
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;
  PERFORM set_config('absl.status_rpc', '0', true);

  -- Visible hand-off note on the thread (Diagram 12).
  INSERT INTO public.ticket_comments (ticket_id, author_id, body)
  VALUES (
    p_ticket_id,
    auth.uid(),
    CASE
      WHEN p_technician_id IS NULL THEN 'Technician unassigned.'
      WHEN v_previous IS NULL THEN 'Technician assigned: ' || v_new_name || '.'
      ELSE 'Job handed over from ' || coalesce(v_old_name, 'a colleague') || ' to ' || v_new_name || '.'
    END ||
    CASE WHEN coalesce(trim(p_reason), '') = '' THEN '' ELSE ' Reason: ' || trim(p_reason) END
  );

  -- Tell the technician they have work.
  IF p_technician_id IS NOT NULL AND v_new_email IS NOT NULL THEN
    INSERT INTO public.notifications (
      ticket_id, recipient_profile_id, recipient_email, channel, subject, body
    )
    VALUES (
      p_ticket_id,
      p_technician_id,
      v_new_email,
      'email',
      'Job assigned: ' || v_ticket.ticket_number,
      'You have been assigned to ticket ' || v_ticket.ticket_number || ': ' || v_ticket.title
    );
  END IF;

  -- The customer is already told: the hand-off comment inserted above is
  -- authored by staff, and queue_comment_notification() emails every
  -- staff comment to the customer automatically. A second, explicit
  -- notification here duplicated that email for the exact same event.

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (auth.uid(), 'ticket.reassigned', 'tickets', p_ticket_id,
          jsonb_build_object('from', v_previous, 'to', p_technician_id, 'reason', p_reason));

  RETURN v_ticket;
END;
$$;
