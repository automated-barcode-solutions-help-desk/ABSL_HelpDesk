-- =====================================================================
-- 0032_no_empty_assignments.sql
--
-- On a job with no technician, the Assign control started on
-- "Unassigned". Pressing Assign without picking anyone sent "unassign"
-- for a job nobody had: nothing changed, but reassign_ticket() still wrote
-- a "Technician unassigned." note and a ticket.reassigned audit entry
-- (from nobody to nobody). 0031 read any such entry as "a technician was
-- deliberately removed" and left those jobs alone, which is why some jobs
-- Benedict logged kept showing as Unassigned.
--
--   1. reassign_ticket() refuses a change that changes nothing: unassigning
--      a job with no technician, or assigning the technician who already
--      has it. Otherwise identical to 0022's version.
--   2. Credits the remaining jobs exactly as 0031 did, but treats a job as
--      deliberately unassigned only when an entry really took a technician
--      off it (from someone to nobody). Jobs opened to every technician
--      still wait in the pool. No emails; each change is audited.
--   3. Prints the jobs it assigned, then every job still without one.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. reassign_ticket() - 0022's version plus the no-op guard.
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

  -- Nothing to change: "unassign" a job that has no technician, or assign
  -- the technician who already has it. Both used to go through, adding a
  -- hand-off note and an audit entry for something that never happened.
  IF p_technician_id IS NULL AND v_previous IS NULL THEN
    RAISE EXCEPTION 'Choose a technician to assign.';
  END IF;

  IF p_technician_id = v_previous THEN
    RAISE EXCEPTION 'That technician already has this job.';
  END IF;

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


-- ---------------------------------------------------------------------
-- 2 + 3. Credit the remaining jobs, then print the outcome.
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
    -- Left alone only if a technician was really taken off the job.
    AND NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.record_table = 'tickets'
        AND a.record_id = t.id
        AND a.action = 'ticket.reassigned'
        AND a.metadata->>'from' IS NOT NULL
        AND a.metadata->>'to' IS NULL
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
         jsonb_build_object('to', a.technician_id, 'reason', a.reason, 'migration', '0032')
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
