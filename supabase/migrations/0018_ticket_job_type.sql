-- =====================================================================
-- 0018_ticket_job_type.sql
--
-- Every ticket carried a priority (how urgent) and a status (how far
-- along), but nothing said what kind of work it actually is. Adds a
-- required job_type: Service, Fault, or Installation - chosen once at
-- creation, on both the customer's own ticket form and the staff
-- "Log a Call-In Job" form, and searchable/filterable in Reports.
--
-- Existing tickets default to 'fault' (a fault report is what the
-- product has only ever supported until now), then the column becomes
-- NOT NULL - a fresh ticket must have an explicit job_type going forward,
-- the client form enforces "you have to choose" rather than silently
-- keeping the default.
--
-- ticket_detail() needs no change: it returns to_jsonb(the whole ticket
-- row), so job_type is already included.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The column itself, backfilled and constrained.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'fault';

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_job_type_values;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_job_type_values
  CHECK (job_type IN ('service', 'fault', 'installation'));


-- ---------------------------------------------------------------------
-- 2. staff_log_ticket(): accepts the same choice a call-in job needs too.
--    Adding p_job_type changes the argument list from 0017's version, so
--    the old 6-argument overload must be dropped explicitly first - see
--    the report_search() comment below for why this matters.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.staff_log_ticket(
  p_company_name text,
  p_caller_name text,
  p_caller_phone text,
  p_title text,
  p_description text,
  p_priority text DEFAULT 'medium',
  p_job_type text DEFAULT 'fault'
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
    title, description, priority, job_type, status
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
    'new'
  )
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text) TO authenticated;


-- ---------------------------------------------------------------------
-- 3. report_search(): job_type returned, plus a matching filter -
--    "show me every Installation this month" is exactly the kind of
--    question Reports exists to answer. Adding p_job_type changes the
--    argument list from 0017's version - same reasoning as
--    staff_log_ticket() above, the old signature must be dropped first
--    or this silently leaves 0017's version behind as a dead overload
--    (PostgreSQL keys a function's identity on name + argument types).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.report_search(text, text, date, date, text, text, uuid);

CREATE OR REPLACE FUNCTION public.report_search(
  p_customer_query text DEFAULT NULL,
  p_service_call_number text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_technician_id uuid DEFAULT NULL,
  p_job_type text DEFAULT NULL
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
  caller_phone text,
  job_type text
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
    t.caller_phone,
    t.job_type
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
    AND (p_job_type IS NULL OR t.job_type = p_job_type)
  ORDER BY t.created_at DESC
  LIMIT 500;
END;
$$;
