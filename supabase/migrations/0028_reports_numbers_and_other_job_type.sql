-- =====================================================================
-- 0028_reports_numbers_and_other_job_type.sql
--
-- For the rebuilt Reports page (technician, customer, date, faults,
-- service call and all-jobs reports with Excel export):
--
--   1. Installation Number and Reference Number become their own columns.
--      A ticket number, a service call number, an installation number and
--      a reference number are four different things - storing any two in
--      one field would make searching and reporting on them unreliable.
--      All four are now separate: ticket_number (0001, automatic),
--      service_call_number (0007, recorded on resolve), and the two new
--      ones below (recorded on resolve or from "Edit ticket details").
--
--   2. A fourth job type, 'other', alongside service / fault / installation.
--
--   3. report_jobs(): one row per ticket with everything the reports show -
--      customer (company), technician, all four numbers, description,
--      the technician's notes from the ticket thread, the resolution, and
--      when it was resolved. Agents and admins only, same as Reports today.
--      The page filters, sorts and exports in the browser, so this returns
--      the full set (optionally bounded by date) in one call.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Separate number fields. Nullable - not every job has either.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS installation_number text,
  ADD COLUMN IF NOT EXISTS reference_number text;


-- ---------------------------------------------------------------------
-- 2. 'other' job type.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_job_type_values;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_job_type_values
  CHECK (job_type IN ('service', 'fault', 'installation', 'other'));


-- ---------------------------------------------------------------------
-- 3. report_jobs()
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.report_jobs(date, date);

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
  IF public.current_role() NOT IN ('agent', 'admin') THEN
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

GRANT EXECUTE ON FUNCTION public.report_jobs(date, date) TO authenticated;
