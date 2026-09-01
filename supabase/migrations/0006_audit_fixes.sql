-- =====================================================================
-- 0006_audit_fixes.sql
--
-- Two defects found in a full code-by-code re-audit of 0001-0005, both
-- real and both silent — neither raised an error, they just did the wrong
-- thing quietly.
--
--   1. Customer replies never reached staff. queue_comment_notification()
--      routed a customer's reply to tickets.assigned_agent_id — a column
--      nothing in this application has ever written to. Every "customer
--      replied" notification silently no-opped since the day it was
--      written (0004). Staff only ever found out via the live dashboard;
--      anyone not watching it at that moment never got told.
--
--   2. Any technician could reassign any ticket, not just their own.
--      reassign_ticket() checked only is_staff() — agent, technician or
--      admin — with no check on whether the calling technician had
--      anything to do with the ticket. A technician could reach into a
--      colleague's job and hand it to someone else without the colleague
--      or an agent being involved.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Route a customer's reply to whoever is actually working the ticket.
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
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_author FROM public.profiles WHERE id = NEW.author_id;

  IF NEW.author_id = v_ticket.created_by THEN
    -- Customer replied: notify whoever is actively on this job.
    -- assigned_agent_id is never populated anywhere in the application, so
    -- routing there (the original 0004 behaviour) meant this branch always
    -- resolved to NULL and silently sent nothing. The assigned technician
    -- is the one real point of contact once the ticket has one.
    v_recipient := v_ticket.assigned_technician_id;
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
-- Trigger already exists from 0004 and points at this function name;
-- CREATE OR REPLACE above is enough, no DROP/CREATE TRIGGER needed.


-- ---------------------------------------------------------------------
-- 2. A technician may claim an unassigned job or hand off their own —
--    never reach into a job assigned to someone else. Agents and admins
--    keep full reassignment rights over every ticket, as before.
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
  v_customer_email text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only ABSL staff can assign a technician.';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  v_previous := v_ticket.assigned_technician_id;

  -- A technician may only touch a job that is unclaimed or already theirs.
  -- Handing a colleague's active job to someone else is an agent/admin
  -- action, not something any technician can do to any other technician.
  IF public.current_role() = 'technician'
     AND v_previous IS NOT NULL
     AND v_previous <> auth.uid()
  THEN
    RAISE EXCEPTION 'You may only claim an unassigned job or hand off a job currently assigned to you.';
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
  SET assigned_technician_id = p_technician_id
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

  -- Tell the customer too. First assignment only, so a hand-over between
  -- two technicians does not double-notify the customer for what is, to
  -- them, the same event already announced.
  IF p_technician_id IS NOT NULL AND v_previous IS NULL THEN
    SELECT email INTO v_customer_email FROM public.profiles WHERE id = v_ticket.created_by;

    IF v_customer_email IS NOT NULL THEN
      INSERT INTO public.notifications (
        ticket_id, recipient_profile_id, recipient_email, channel, subject, body
      )
      VALUES (
        p_ticket_id,
        v_ticket.created_by,
        v_customer_email,
        'email',
        'Technician assigned: ' || v_ticket.ticket_number,
        v_new_name || ' has been assigned to your ticket ' || v_ticket.ticket_number || ' and will be in touch.'
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (auth.uid(), 'ticket.reassigned', 'tickets', p_ticket_id,
          jsonb_build_object('from', v_previous, 'to', p_technician_id, 'reason', p_reason));

  RETURN v_ticket;
END;
$$;
