-- =====================================================================
-- 0029_null_safe_role_checks.sql  -  SECURITY FIX, run as soon as possible
--
-- current_role() deliberately returns NULL for anyone who is not signed in
-- or whose account is not approved yet. In SQL, a comparison with NULL is
-- neither true nor false, so checks written as
--     IF current_role() NOT IN ('agent', 'admin') THEN RAISE ...
--     IF NOT is_staff() THEN RAISE ...
--     IF NOT can_view_ticket(...) THEN RAISE ...
-- did NOT stop those callers - the IF simply didn't fire. Combined with
-- Supabase letting anonymous visitors call functions by default, that
-- meant, for example, report_jobs() (0028) returned every job to anyone
-- holding the public key that ships in config.js.
--
-- Fixed at the source wherever possible:
--   1. is_staff() and can_view_ticket() now return false, never NULL -
--      that closes the gap in every function that relies on them
--      (reassign_ticket, change_ticket_status, ticket_detail, ...).
--   2. The five functions that compare current_role() directly now treat
--      'no role' as a role that is never allowed. Each is otherwise an
--      exact copy of its latest version (named next to it).
--   3. Anonymous visitors can no longer call any staff/ticket function
--      at all - a second lock on the same door. (The app only calls them
--      after sign-in. The helpers above stay callable: row security on
--      tickets, companies and storage evaluates them for every visitor.)
--
-- The last statement prints a one-row self-check.
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helpers that must never return NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_role() IN ('agent', 'technician', 'admin'), false)
$$;

-- Same rules as 0024's version, wrapped so 'unknown' becomes 'no'.
CREATE OR REPLACE FUNCTION public.can_view_ticket(ticket_row public.tickets)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    ticket_row.created_by = auth.uid()
    OR ticket_row.assigned_agent_id = auth.uid()
    OR ticket_row.assigned_technician_id = auth.uid()
    OR public.current_role() IN ('agent', 'admin', 'operator')
    OR (
      ticket_row.open_for_claim = true
      AND ticket_row.assigned_technician_id IS NULL
      AND public.current_role() = 'technician'
    ),
    false
  )
$$;


-- ---------------------------------------------------------------------
-- 2. Direct role comparisons, made NULL-safe. Only the role check line
--    differs from each source version.
-- ---------------------------------------------------------------------

-- complete_callback (copied from 0024_operator_role_permissions.sql)
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
  IF coalesce(public.current_role()::text, '') NOT IN ('agent', 'admin', 'operator') THEN
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

-- consume_inventory (copied from 0004_feature_completion.sql)
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

  IF coalesce(public.current_role()::text, '') NOT IN ('technician', 'admin') THEN
    RAISE EXCEPTION 'Only technicians or admins can consume inventory';
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

-- release_ticket_to_pool (copied from 0024_operator_role_permissions.sql)
CREATE OR REPLACE FUNCTION public.release_ticket_to_pool(p_ticket_id uuid)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets;
BEGIN
  IF coalesce(public.current_role()::text, '') NOT IN ('agent', 'admin', 'operator') THEN
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

-- report_jobs (copied from 0028_reports_numbers_and_other_job_type.sql)
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
  IF coalesce(public.current_role()::text, '') NOT IN ('agent', 'admin') THEN
    RAISE EXCEPTION 'Only agents and admins can run reports.';
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

-- staff_log_ticket (copied from 0025_self_service_tickets.sql)
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


-- ---------------------------------------------------------------------
-- 3. No anonymous access to staff / ticket functions. Signed-in users
--    (and the server's service role) keep EXECUTE.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.report_jobs(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_jobs(date, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.release_ticket_to_pool(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_ticket_to_pool(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_callback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_callback(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.consume_inventory(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_inventory(uuid, uuid, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reassign_ticket(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_ticket(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.change_ticket_status(uuid, public.ticket_status, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_ticket_status(uuid, public.ticket_status, integer, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ticket_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_detail(uuid) TO authenticated, service_role;

-- These five already reject anonymous callers on their own (they check
-- is_admin(), the uuid form of can_view_ticket(), or the uploader, all of
-- which are NULL-safe) - locked anyway so no ticket function is reachable
-- without signing in.
REVOKE ALL ON FUNCTION public.add_progress_photo(uuid, text, text, bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_progress_photo(uuid, text, text, bigint, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_callback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_callback(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_review_registration(uuid, boolean, public.user_role, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_registration(uuid, boolean, public.user_role, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.discard_orphaned_receipt_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_orphaned_receipt_attachment(uuid) TO authenticated, service_role;

-- No longer used by the app (Reports now uses report_jobs).
REVOKE ALL ON FUNCTION public.report_search(text, text, date, date, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_search(text, text, date, date, text, text, uuid, text) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. Self-check. Expect: locked_functions 13, still_open_to_anonymous 0,
--    signed_in_users_still_allowed true.
-- ---------------------------------------------------------------------
SELECT
  count(*) AS locked_functions,
  count(*) FILTER (WHERE has_function_privilege('anon', f::regprocedure, 'EXECUTE')) AS still_open_to_anonymous,
  bool_and(has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')) AS signed_in_users_still_allowed
FROM unnest(ARRAY[
  'public.report_jobs(date, date)',
  'public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean, boolean)',
  'public.release_ticket_to_pool(uuid)',
  'public.complete_callback(uuid, text)',
  'public.consume_inventory(uuid, uuid, integer)',
  'public.reassign_ticket(uuid, uuid, text)',
  'public.change_ticket_status(uuid, public.ticket_status, integer, text, text)',
  'public.ticket_detail(uuid)',
  'public.add_progress_photo(uuid, text, text, bigint, text, text, text)',
  'public.request_callback(uuid, text)',
  'public.admin_review_registration(uuid, boolean, public.user_role, text)',
  'public.discard_orphaned_receipt_attachment(uuid)',
  'public.report_search(text, text, date, date, text, text, uuid, text)'
]) AS f;
