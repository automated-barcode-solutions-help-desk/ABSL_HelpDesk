-- =====================================================================
-- 0016_report_filters_and_attachments.sql
--
-- Two gaps in the Reports page:
--
--   1. report_search() could only be narrowed by customer, service call
--      number and a date range. Finding "every open High ticket" or
--      "everything Kasun resolved this month" meant scrolling the whole
--      500-row result by eye. Adds three more optional filters: status,
--      priority and assigned technician - all AND'd in alongside the
--      existing ones, so any combination narrows the result further.
--
--   2. The service call number and the evidence photo behind it lived in
--      two different places - report_search() returned the number as
--      text, but never how many files (photos, the receipt, anything
--      else) were actually attached to back it up. Reports had no way
--      to tell a well-documented job from a bare number with nothing
--      behind it. Adds attachment_count so that's visible in the same
--      row the service call number is in.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- PostgreSQL identifies a function by name + argument types, not by name
-- alone. Adding p_status/p_priority/p_technician_id below changes that
-- signature, so CREATE OR REPLACE would not touch the old 4-argument
-- version at all - it would silently leave it in place as a second,
-- dead-but-still-callable overload (exactly the bug already fixed for
-- change_ticket_status() in 0007/0009 - same fix here).
DROP FUNCTION IF EXISTS public.report_search(text, text, date, date);

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
  attachment_count bigint
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
  -- Escape the ILIKE special characters in the raw search text itself, so
  -- a literal '%', '_' or '\' the user typed is matched literally instead
  -- of acting as a wildcard. '%' and '_' become the search term; '%'/'_'
  -- surrounding them make it a "contains" search, same as before.
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
    ) AS attachment_count
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
    )
    AND (
      v_service_call_pattern IS NULL
      OR t.service_call_number ILIKE v_service_call_pattern
    )
    -- Pinned to the business timezone (Sri Lanka, UTC+5:30) rather than
    -- whatever the database session's default happens to be, so a
    -- "From X To X" search matches the calendar day staff actually mean.
    AND (p_date_from IS NULL OR t.created_at >= (p_date_from::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_date_to IS NULL OR t.created_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Colombo'))
    AND (p_status IS NULL OR t.status = p_status::public.ticket_status)
    AND (p_priority IS NULL OR t.priority = p_priority)
    AND (p_technician_id IS NULL OR t.assigned_technician_id = p_technician_id)
  ORDER BY t.created_at DESC
  LIMIT 500;
END;
$$;
