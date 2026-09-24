-- =====================================================================
-- 0021_department_phone_location.sql
--
-- Three additions requested for launch:
--
--   1. Registration now collects a phone number. profiles.phone already
--      existed (0001) but nothing ever wrote to it at signup — it was
--      only ever set later, manually. handle_new_user() now reads it out
--      of the same raw_user_meta_data payload full_name/company_name
--      already travel through.
--
--   2. Tickets gain an optional "department" (which department has the
--      fault/needs the service) — free text, nobody has a fixed list of
--      department names to validate against, so no CHECK constraint.
--      Both the customer's own ticket form and the staff "Log a Call-In
--      Job" form can set it. ticket_detail() needs no change: it already
--      returns to_jsonb(the whole ticket row) — see 0017's note.
--
--   3. The staff "Log a Call-In Job" form (staff_log_ticket()) never had
--      a location field at all — a technician logging their own call-in
--      job can now record where the fault is, same as a customer already
--      could on their own form.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. department column. Nullable, no constraint - free text.
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS department text;


-- ---------------------------------------------------------------------
-- 2. handle_new_user(): also store the phone number collected at
--    registration. Everything else here is unchanged from 0003.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id uuid;
  v_company_name text;
  v_full_name text;
  v_phone text;
  v_email_domain text;
  v_auto_approve boolean;
  v_approval_status public.approval_status;
  v_current_count integer;
  v_account_limit integer;
  v_requested_role public.user_role;
  v_raw_role text;
BEGIN
  v_email_domain := split_part(NEW.email, '@', 2);
  v_company_name := NEW.raw_user_meta_data->>'company_name';
  v_full_name := coalesce(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_phone := nullif(trim(NEW.raw_user_meta_data->>'phone'), '');

  -- Whatever the client sent is a REQUEST, never an assignment, and only
  -- these two values are accepted. Anything else (including 'admin' and
  -- 'agent') falls back to customer.
  v_raw_role := coalesce(
    nullif(NEW.raw_user_meta_data->>'requested_role', ''),
    nullif(NEW.raw_user_meta_data->>'role', ''),
    'customer'
  );

  IF v_raw_role = 'technician' THEN
    v_requested_role := 'technician';
  ELSE
    v_requested_role := 'customer';
  END IF;

  SELECT company_id, auto_approve
  INTO v_company_id, v_auto_approve
  FROM public.company_domains
  WHERE domain = v_email_domain;

  IF v_company_id IS NULL THEN
    SELECT id, account_limit
    INTO v_company_id, v_account_limit
    FROM public.companies
    WHERE lower(name) = lower(v_company_name);

    IF v_company_id IS NULL AND v_company_name IS NOT NULL THEN
      INSERT INTO public.companies (name, account_limit)
      VALUES (v_company_name, 10)
      RETURNING id INTO v_company_id;

      v_account_limit := 10;
    END IF;
  ELSE
    SELECT account_limit INTO v_account_limit
    FROM public.companies
    WHERE id = v_company_id;
  END IF;

  IF v_company_id IS NOT NULL AND v_account_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current_count
    FROM public.profiles
    WHERE company_id = v_company_id AND approval_status = 'approved';

    IF v_current_count >= v_account_limit THEN
      RAISE EXCEPTION 'Company account limit reached. Please contact your administrator.';
    END IF;
  END IF;

  -- A staff role is NEVER auto-approved, even on a verified domain.
  IF v_auto_approve IS TRUE AND v_requested_role = 'customer' THEN
    v_approval_status := 'approved';
  ELSE
    v_approval_status := 'pending';
  END IF;

  INSERT INTO public.profiles (id, company_id, full_name, email, phone, role, approval_status)
  VALUES (
    NEW.id,
    v_company_id,
    v_full_name,
    NEW.email,
    v_phone,
    'customer'::public.user_role,   -- always unprivileged at creation
    v_approval_status
  );

  IF v_approval_status = 'pending' THEN
    INSERT INTO public.approval_requests (
      profile_id, company_name, requested_email, requested_role, status
    )
    VALUES (NEW.id, v_company_name, NEW.email, v_requested_role, 'pending');
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 3. staff_log_ticket(): adds p_department and p_location. Adding
--    arguments changes the signature from 0018's version, so that
--    7-argument overload must be dropped explicitly first - same
--    reasoning as 0018's own comment on this.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.staff_log_ticket(
  p_company_name text,
  p_caller_name text,
  p_caller_phone text,
  p_title text,
  p_description text,
  p_priority text DEFAULT 'medium',
  p_job_type text DEFAULT 'fault',
  p_department text DEFAULT NULL,
  p_location text DEFAULT NULL
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
    title, description, priority, job_type, department, location_name, status
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
    'new'
  )
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_log_ticket(text, text, text, text, text, text, text, text, text) TO authenticated;
