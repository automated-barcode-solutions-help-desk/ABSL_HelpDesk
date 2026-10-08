-- =====================================================================
-- 0033_unified_operator_role.sql
--
-- The CEO Console, Agent Desk and Operator Desk become ONE interface:
-- Operator. Customers and technicians keep their own.
--
--   * Operator now has every permission the Agent and CEO roles had -
--     reports, assigning technicians, status changes, approvals, company
--     limits, notifications, alerts, receipts, client errors, inventory,
--     and deleting tickets, replies and files.
--   * Except managing staff. Changing an existing account's role, or
--     granting Operator or CEO, stays with the CEO (role 'admin') in the
--     Main Console. Operators approve new sign-ups as Customer or
--     Technician only.
--   * CEO accounts keep the CEO role and use the same Operator interface,
--     plus the Main Console.
--   * The Agent role is retired: every Agent account becomes Operator,
--     keeping its tickets, replies and history (all keyed by account id,
--     not by role), and nothing can give the Agent role again.
--
-- Prints every Operator and CEO account afterwards.
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Role helpers. Never NULL (see 0029).
-- ---------------------------------------------------------------------
-- Operator, CEO, and any agent account not yet moved (step 5 moves them).
CREATE OR REPLACE FUNCTION public.is_office()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_role() IN ('operator', 'admin', 'agent'), false)
$$;

-- Operators were left out of is_staff(), so they could not change a job's
-- status, assign a technician or add a progress photo. Now they can.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_role() IN ('agent', 'technician', 'admin', 'operator'), false)
$$;


-- ---------------------------------------------------------------------
-- 2. Functions that named agent/admin directly. Copied from their latest
--    versions; only the role check changes.
-- ---------------------------------------------------------------------

-- report_jobs (0029)
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
  IF NOT public.is_office() THEN
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

-- consume_inventory (0029)
CREATE OR REPLACE FUNCTION public.consume_inventory(
  p_ticket_id uuid,
  p_inventory_item_id uuid,
  p_quantity integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_quantity integer;
  v_item public.inventory_items;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF coalesce(public.current_role()::text, '') <> 'technician' AND NOT public.is_office() THEN
    RAISE EXCEPTION 'Only technicians, operators or the CEO can use stock';
  END IF;

  IF p_ticket_id IS NOT NULL AND NOT public.can_view_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'You can only use parts against your own job.';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_inventory_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  current_quantity := v_item.quantity_on_hand;

  IF current_quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: % left', current_quantity;
  END IF;

  UPDATE public.inventory_items
  SET quantity_on_hand = quantity_on_hand - p_quantity
  WHERE id = p_inventory_item_id;

  INSERT INTO public.inventory_movements (
    inventory_item_id, ticket_id, technician_id, movement_type, quantity, note
  )
  VALUES (
    p_inventory_item_id, p_ticket_id, auth.uid(), 'use', -p_quantity,
    'Used from technician Work button'
  );

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (auth.uid(), 'inventory.consumed', 'inventory_items', p_inventory_item_id,
          jsonb_build_object('quantity', p_quantity, 'ticket_id', p_ticket_id,
                             'remaining', current_quantity - p_quantity));

  -- Warn the admin once, on the crossing, not on every later use.
  IF (current_quantity - p_quantity) <= v_item.reorder_level
     AND current_quantity > v_item.reorder_level THEN
    INSERT INTO public.admin_alerts (alert_type, severity, title, body, related_record_id)
    VALUES ('low_stock', 'warning',
            'Low stock: ' || v_item.name,
            v_item.sku || ' is down to ' || (current_quantity - p_quantity) ||
            ' (reorder level ' || v_item.reorder_level || ').',
            p_inventory_item_id);
  END IF;

  RETURN true;
END;
$$;


-- ---------------------------------------------------------------------
-- 3. Reviewing sign-ups: operators may approve as customer/technician;
--    everything else about roles stays with the CEO.
-- ---------------------------------------------------------------------

-- admin_review_registration (0015)
CREATE OR REPLACE FUNCTION public.admin_review_registration(
  p_profile_id uuid,
  p_approve boolean,
  p_grant_role public.user_role DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_requested public.user_role;
  v_role public.user_role;
BEGIN
  IF NOT public.is_office() THEN
    RAISE EXCEPTION 'Only an approved operator or the CEO can review registrations.';
  END IF;

  SELECT requested_role INTO v_requested
  FROM public.approval_requests
  WHERE profile_id = p_profile_id
  ORDER BY created_at DESC
  LIMIT 1;

  v_role := coalesce(p_grant_role, v_requested, 'customer');

  -- The Agent role is retired: anyone given it becomes an Operator.
  IF v_role = 'agent' THEN
    v_role := 'operator';
  END IF;

  -- An operator reviews new sign-ups only, and only as customer or
  -- technician. Changing an existing account, or making someone an
  -- operator or CEO, is the CEO's job in the Main Console. "New" is the
  -- account's own status, not a leftover request row.
  IF NOT public.is_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_profile_id AND approval_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Only the CEO can change an existing account, from the Main Console.';
    END IF;

    IF p_approve AND v_role NOT IN ('customer', 'technician') THEN
      RAISE EXCEPTION 'Operators can approve accounts as Customer or Technician only. The CEO grants Operator or CEO access from the Main Console.';
    END IF;
  END IF;

  -- Lets guard_profile_privileges() accept this reviewed change.
  PERFORM set_config('absl.review_rpc', '1', true);

  IF p_approve THEN
    UPDATE public.profiles
    SET approval_status = 'approved',
        role = v_role,
        rejection_reason = NULL
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;
  ELSE
    UPDATE public.profiles
    SET approval_status = 'rejected',
        rejection_reason = p_reason
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;
  END IF;

  PERFORM set_config('absl.review_rpc', '0', true);

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  UPDATE public.approval_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END::public.approval_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = p_reason
  WHERE profile_id = p_profile_id
    AND status = 'pending';

  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN p_approve THEN 'registration.approved' ELSE 'registration.rejected' END,
    'profiles',
    p_profile_id,
    jsonb_build_object('granted_role', v_role, 'reason', p_reason)
  );

  -- Tell the applicant. Not tied to any ticket (ticket_id is nullable
  -- for exactly this reason), so the notification worker still picks it
  -- up and sends it the same way as every other queued email.
  IF v_profile.email IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_profile_id, recipient_email, subject, body)
    VALUES (
      p_profile_id,
      v_profile.email,
      CASE
        WHEN p_approve THEN 'Your ABSL Helpdesk account has been approved'
        ELSE 'Your ABSL Helpdesk account request was not approved'
      END,
      CASE
        WHEN p_approve THEN
          'Good news - your account has been approved. You can now log in at the helpdesk and start raising tickets.'
        ELSE
          'Your account request was not approved.' ||
          CASE WHEN coalesce(trim(p_reason), '') <> '' THEN ' Reason: ' || trim(p_reason) ELSE '' END
      END
    );
  END IF;

  RETURN v_profile;
END;
$$;

-- guard_profile_privileges (0003)
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The Agent role is retired: setting it gives Operator instead.
  IF NEW.role = 'agent' AND NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.role := 'operator';
  END IF;

  -- service_role / trigger context (no end-user JWT): allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- An approved admin acting through admin_review_registration() or the
  -- admin console may change these.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- A sign-up reviewed by an operator through admin_review_registration(),
  -- which has already checked what an operator may grant.
  IF coalesce(current_setting('absl.review_rpc', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.id IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'You may not change your own role, approval status, or company.';
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 4. Row security: what the CEO alone could see or do, operators can
--    too. Profiles ("Admins manage profiles") and approval updates stay
--    CEO-only - that is managing staff.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Own approval request visible" ON public.approval_requests;
CREATE POLICY "Own approval request visible"
  ON public.approval_requests
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.is_office());

DROP POLICY IF EXISTS "Visible to admin only" ON public.audit_logs;
DROP POLICY IF EXISTS "Visible to operators and admins" ON public.audit_logs;
CREATE POLICY "Visible to operators and admins"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_office());

DROP POLICY IF EXISTS "Admins acknowledge client error logs" ON public.client_error_logs;
DROP POLICY IF EXISTS "Operators and admins acknowledge client error logs" ON public.client_error_logs;
CREATE POLICY "Operators and admins acknowledge client error logs"
  ON public.client_error_logs
  FOR UPDATE
  TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

DROP POLICY IF EXISTS "Admins view client error logs" ON public.client_error_logs;
DROP POLICY IF EXISTS "Operators and admins view client error logs" ON public.client_error_logs;
CREATE POLICY "Operators and admins view client error logs"
  ON public.client_error_logs
  FOR SELECT
  TO authenticated
  USING (public.is_office());

DROP POLICY IF EXISTS "Admins manage companies" ON public.companies;
DROP POLICY IF EXISTS "Operators and admins manage companies" ON public.companies;
CREATE POLICY "Operators and admins manage companies"
  ON public.companies
  FOR ALL
  TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

DROP POLICY IF EXISTS "Admins manage inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Operators and admins manage inventory" ON public.inventory_items;
CREATE POLICY "Operators and admins manage inventory"
  ON public.inventory_items
  FOR ALL
  TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

DROP POLICY IF EXISTS "Inventory visible to staff" ON public.inventory_items;
CREATE POLICY "Inventory visible to staff"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (public.is_office() OR public.current_role() = 'technician');

DROP POLICY IF EXISTS "Staff read inventory" ON public.inventory_items;
CREATE POLICY "Staff read inventory"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (public.is_office() OR public.current_role() = 'technician');

DROP POLICY IF EXISTS "Insert by technician and admin only" ON public.inventory_movements;
DROP POLICY IF EXISTS "Insert by technicians, operators and admins" ON public.inventory_movements;
CREATE POLICY "Insert by technicians, operators and admins"
  ON public.inventory_movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_office() OR public.current_role() = 'technician')
    AND technician_id = auth.uid()
  );

DROP POLICY IF EXISTS "Visible to staff" ON public.inventory_movements;
CREATE POLICY "Visible to staff"
  ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (public.is_office() OR public.current_role() = 'technician');

DROP POLICY IF EXISTS "Admins read notification attempts" ON public.notification_attempts;
DROP POLICY IF EXISTS "Operators and admins read notification attempts" ON public.notification_attempts;
CREATE POLICY "Operators and admins read notification attempts"
  ON public.notification_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_office());

DROP POLICY IF EXISTS "Admins update notifications" ON public.notifications;
DROP POLICY IF EXISTS "Operators and admins update notifications" ON public.notifications;
CREATE POLICY "Operators and admins update notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

DROP POLICY IF EXISTS "Notifications visible to recipient and admin" ON public.notifications;
DROP POLICY IF EXISTS "Notifications visible to recipient, operators and admins" ON public.notifications;
CREATE POLICY "Notifications visible to recipient, operators and admins"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_profile_id = auth.uid() OR public.is_office());

DROP POLICY IF EXISTS "Uploader or admin deletes attachment" ON public.ticket_attachments;
DROP POLICY IF EXISTS "Uploader, operator or admin deletes attachment" ON public.ticket_attachments;
CREATE POLICY "Uploader, operator or admin deletes attachment"
  ON public.ticket_attachments
  FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_office());

DROP POLICY IF EXISTS "Author or admin deletes comment" ON public.ticket_comments;
DROP POLICY IF EXISTS "Author, operator or admin deletes comment" ON public.ticket_comments;
CREATE POLICY "Author, operator or admin deletes comment"
  ON public.ticket_comments
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_office());

DROP POLICY IF EXISTS "Admins view receipts" ON public.ticket_receipts;
DROP POLICY IF EXISTS "Operators and admins view receipts" ON public.ticket_receipts;
CREATE POLICY "Operators and admins view receipts"
  ON public.ticket_receipts
  FOR SELECT
  TO authenticated
  USING (public.is_office());

DROP POLICY IF EXISTS "Admins delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "Operators and admins delete tickets" ON public.tickets;
CREATE POLICY "Operators and admins delete tickets"
  ON public.tickets
  FOR DELETE
  TO authenticated
  USING (public.is_office());

DROP POLICY IF EXISTS "Inventory imports are admin only" ON storage.objects;
DROP POLICY IF EXISTS "Inventory imports are for operators and admins" ON storage.objects;
CREATE POLICY "Inventory imports are for operators and admins"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'inventory-csv-imports' AND public.is_office())
  WITH CHECK (bucket_id = 'inventory-csv-imports' AND public.is_office());

DROP POLICY IF EXISTS "Uploader or admin deletes ticket file" ON storage.objects;
DROP POLICY IF EXISTS "Uploader, operator or admin deletes ticket file" ON storage.objects;
CREATE POLICY "Uploader, operator or admin deletes ticket file"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('ticket-photos', 'ticket-voice-notes', 'ticket-videos', 'ticket-service-receipts')
    AND (owner = auth.uid() OR public.is_office())
  );


-- ---------------------------------------------------------------------
-- 5. Move every Agent account to Operator, then list the office accounts.
-- ---------------------------------------------------------------------
WITH moved AS (
  UPDATE public.profiles
  SET role = 'operator'
  WHERE role = 'agent'
  RETURNING id
),
logged AS (
  INSERT INTO public.audit_logs (actor_id, action, record_table, record_id, metadata)
  SELECT NULL, 'profile.role_changed', 'profiles', m.id,
         jsonb_build_object('from', 'agent', 'to', 'operator', 'migration', '0033')
  FROM moved m
  RETURNING record_id
),
requests AS (
  UPDATE public.approval_requests
  SET requested_role = 'operator'
  WHERE requested_role = 'agent' AND status = 'pending'
  RETURNING id
)
SELECT coalesce(p.full_name, '') AS name,
       p.email,
       CASE WHEN m.id IS NOT NULL THEN 'operator' ELSE p.role::text END AS role_now,
       p.approval_status::text AS status,
       CASE
         WHEN m.id IS NOT NULL THEN 'was Agent - now Operator dashboard'
         WHEN p.role = 'admin' THEN 'CEO - Operator dashboard + Main Console'
         ELSE 'Operator dashboard'
       END AS access
FROM public.profiles p
LEFT JOIN moved m ON m.id = p.id
WHERE p.role IN ('operator', 'admin', 'agent')
ORDER BY CASE WHEN p.role = 'admin' THEN 0 ELSE 1 END, p.full_name;
