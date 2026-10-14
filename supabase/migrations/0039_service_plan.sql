-- =====================================================================
-- 0039_service_plan.sql
--
-- Planned services and trip planning.
--
-- ABSL services equipment for contract clients at sites across the
-- island (Seylan Bank branches, National Youth Corps centres, SLT-Mobitel
-- teleshops, CEA offices). When a technician is sent somewhere far, the
-- app suggests the pending services along the way and orders the stops
-- into one trip (the route itself is worked out in the browser - see
-- tripPlan() in helpers.js - and opened in Google Maps for navigation).
--
--   client_sites      where each client's equipment is, with a map
--                     position (town-level until someone sets it exactly).
--                     One row, is_base, is the ABSL office trips start from.
--   planned_services  a service due at a site for a contract year:
--                     pending, done or skipped.
--
-- Doing a planned service goes through the normal job flow, so it gets a
-- receipt, appears in Reports and in the Google Drive backup:
--   start_planned_service() logs a Service ticket for the site, assigned
--   to the technician who starts it; resolving that ticket (receipt photo,
--   service call number) marks the planned service done
--   (sync_planned_service_from_ticket trigger).
--
-- Who may do what: every ABSL staff role can read sites and planned
-- services (technicians plan their trips); operators and the CEO add and
-- change them. Customers and signed-out visitors see nothing.
--
-- Seed data: Seylan's "TO COMPLETE FOR 2025/26" branches (due by the end
-- of that contract year, 31 Jul 2026) and the National Youth Corps centres
-- for 2026/27 are loaded as pending; SLT-Mobitel and CEA offices are loaded
-- as sites with nothing due yet. Positions are town-level from
-- OpenStreetMap. Re-running never overwrites a site or service someone has
-- since edited.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client text NOT NULL,
  name text NOT NULL,
  address text,
  place text,
  region text,
  device_serial text,
  lat double precision,
  lng double precision,
  -- false: the position is the town's, not the building's.
  location_exact boolean NOT NULL DEFAULT false,
  -- The ABSL office: where a trip starts unless the technician uses GPS.
  is_base boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_sites_client_name_key UNIQUE (client, name),
  CONSTRAINT client_sites_in_sri_lanka CHECK (
    (lat IS NULL AND lng IS NULL) OR (lat BETWEEN 5.5 AND 10.2 AND lng BETWEEN 79.3 AND 82.2)
  ),
  CONSTRAINT client_sites_name_present CHECK (length(trim(client)) > 0 AND length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_sites_one_base ON public.client_sites (is_base) WHERE is_base;

CREATE TABLE IF NOT EXISTS public.planned_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
  contract_year text NOT NULL,
  visit text NOT NULL DEFAULT 'Service',
  due_by date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  started_by uuid REFERENCES public.profiles(id),
  started_at timestamptz,
  done_by uuid REFERENCES public.profiles(id),
  done_at timestamptz,
  service_call_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planned_services_one_per_visit UNIQUE (site_id, contract_year, visit)
);

CREATE INDEX IF NOT EXISTS planned_services_status_idx ON public.planned_services (status);
CREATE INDEX IF NOT EXISTS planned_services_ticket_idx ON public.planned_services (ticket_id);

DROP TRIGGER IF EXISTS set_client_sites_updated_at ON public.client_sites;
CREATE TRIGGER set_client_sites_updated_at
  BEFORE UPDATE ON public.client_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_planned_services_updated_at ON public.planned_services;
CREATE TRIGGER set_planned_services_updated_at
  BEFORE UPDATE ON public.planned_services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2. Who may see and change them
-- ---------------------------------------------------------------------
ALTER TABLE public.client_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view client sites" ON public.client_sites;
CREATE POLICY "Staff view client sites"
  ON public.client_sites FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Operators manage client sites" ON public.client_sites;
CREATE POLICY "Operators manage client sites"
  ON public.client_sites FOR ALL TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

DROP POLICY IF EXISTS "Staff view planned services" ON public.planned_services;
CREATE POLICY "Staff view planned services"
  ON public.planned_services FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Operators manage planned services" ON public.planned_services;
CREATE POLICY "Operators manage planned services"
  ON public.planned_services FOR ALL TO authenticated
  USING (public.is_office())
  WITH CHECK (public.is_office());

REVOKE ALL ON public.client_sites, public.planned_services FROM anon;


-- ---------------------------------------------------------------------
-- 3. Starting a planned service: a Service ticket for the site
-- ---------------------------------------------------------------------
-- Logged like a technician's own job (staff_log_ticket with "this is my
-- own job"): assigned to the technician who starts it. Started by an
-- operator, it is unassigned and goes through normal assigning. Starting
-- one that already has an open ticket returns that ticket.
CREATE OR REPLACE FUNCTION public.start_planned_service(p_service_id uuid)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.planned_services;
  v_site public.client_sites;
  v_ticket public.tickets;
  v_company_id uuid;
  v_assign_to uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only ABSL staff can start a planned service.';
  END IF;

  SELECT * INTO v_plan FROM public.planned_services WHERE id = p_service_id FOR UPDATE;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'That planned service no longer exists.';
  END IF;
  IF v_plan.status <> 'pending' THEN
    RAISE EXCEPTION 'That service is already %.', v_plan.status;
  END IF;

  -- Already started and still open: carry on with that job.
  IF v_plan.ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.tickets WHERE id = v_plan.ticket_id;
    IF v_ticket.id IS NOT NULL AND v_ticket.status NOT IN ('resolved', 'closed') THEN
      IF public.current_role() = 'technician'
         AND v_ticket.assigned_technician_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Another technician has already started this service.';
      END IF;
      RETURN v_ticket;
    END IF;
  END IF;

  SELECT * INTO v_site FROM public.client_sites WHERE id = v_plan.site_id;

  SELECT id INTO v_company_id FROM public.companies WHERE lower(name) = lower(v_site.client);
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, account_limit) VALUES (v_site.client, 10)
    RETURNING id INTO v_company_id;
  END IF;

  IF public.current_role() = 'technician' THEN
    v_assign_to := auth.uid();
  END IF;

  INSERT INTO public.tickets (
    company_id, created_by, title, description, priority, job_type,
    location_name, location_lat, location_lng, open_for_claim,
    assigned_technician_id, status
  )
  VALUES (
    v_company_id,
    auth.uid(),
    v_site.name || ' - ' || v_plan.visit || ' ' || v_plan.contract_year,
    'Planned ' || lower(v_plan.visit) || ' for ' || v_site.client || ', ' || v_site.name ||
      ' (contract year ' || v_plan.contract_year || ').' ||
      CASE WHEN nullif(v_site.device_serial, '') IS NOT NULL THEN ' Device serial: ' || v_site.device_serial || '.' ELSE '' END,
    'medium',
    'service',
    coalesce(nullif(v_site.address, ''), v_site.name || ', ' || coalesce(v_site.place, '')),
    v_site.lat,
    v_site.lng,
    false,
    v_assign_to,
    'new'
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.ticket_comments (ticket_id, author_id, body)
  VALUES (
    v_ticket.id,
    auth.uid(),
    'Planned service from the Service Plan.' ||
      CASE WHEN v_assign_to IS NOT NULL THEN ' Assigned to the technician who started it.' ELSE '' END
  );

  UPDATE public.planned_services
  SET ticket_id = v_ticket.id, started_by = auth.uid(), started_at = now()
  WHERE id = v_plan.id;

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.start_planned_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_planned_service(uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. A resolved ticket marks its planned service done (and reopening the
--    ticket puts the service back to pending).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_planned_service_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN
    UPDATE public.planned_services
    SET status = 'done',
        done_at = now(),
        done_by = coalesce(NEW.assigned_technician_id, auth.uid()),
        service_call_number = coalesce(NEW.service_call_number, service_call_number)
    WHERE ticket_id = NEW.id AND status = 'pending';
  ELSIF NEW.status NOT IN ('resolved', 'closed') AND OLD.status IN ('resolved', 'closed') THEN
    UPDATE public.planned_services
    SET status = 'pending', done_at = NULL, done_by = NULL
    WHERE ticket_id = NEW.id AND status = 'done';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_planned_service_from_ticket ON public.tickets;
CREATE TRIGGER sync_planned_service_from_ticket
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sync_planned_service_from_ticket();

REVOKE ALL ON FUNCTION public.sync_planned_service_from_ticket() FROM PUBLIC, anon;


-- ---------------------------------------------------------------------
-- 5. Sites and due services
-- ---------------------------------------------------------------------
-- The ABSL office. Its exact position isn't known yet: central Colombo
-- until an operator sets it on the Service Plan page.
INSERT INTO public.client_sites (client, name, place, lat, lng, is_base)
VALUES ('ABSL', 'ABSL Office', 'Colombo', 6.93886, 79.85420, true)
ON CONFLICT (client, name) DO NOTHING;

INSERT INTO public.client_sites (client, name, address, place, region, device_serial, lat, lng)
SELECT v.client, v.name, v.address, v.place, v.region, v.serial, v.lat, v.lng
FROM (VALUES
  ('Seylan Bank', 'Head Office - 1st Floor - Millennium Branch', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 2nd Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 3rd Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 4th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 5th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 6th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 7th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 8th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 9th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 10th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 11th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 12th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 13th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 14th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 15th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 16th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - 17th Floor', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - PMD - Basement', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - Imports', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - Card Centre', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - MSL', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Head Office - COL', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 'Greater Colombo', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Ambalantota', NULL, 'Ambalantota', 'South', NULL, 6.12246, 81.02386),
  ('Seylan Bank', 'Aralaganwila', NULL, 'Aralaganwila', 'N.C', NULL, 7.78261, 81.18469),
  ('Seylan Bank', 'Akkaraipattu', NULL, 'Akkaraipattu', 'East', NULL, 7.21406, 81.84825),
  ('Seylan Bank', 'Akuressa', NULL, 'Akuressa', 'South', NULL, 6.10118, 80.47649),
  ('Seylan Bank', 'Ampara', NULL, 'Ampara', 'East', NULL, 7.07376, 81.83229),
  ('Seylan Bank', 'Anuradhapura', NULL, 'Anuradhapura', 'N.C', NULL, 8.33498, 80.41061),
  ('Seylan Bank', 'Avissawella', NULL, 'Avissawella', 'US', NULL, 6.95212, 80.21286),
  ('Seylan Bank', 'Balangoda', NULL, 'Balangoda', 'US', NULL, 6.65014, 80.69857),
  ('Seylan Bank', 'Batticaloa', NULL, 'Batticaloa', 'East', NULL, 7.83814, 81.55692),
  ('Seylan Bank', 'Bogawantalawa', NULL, 'Bogawantalawa', 'Central', NULL, 6.79624, 80.67810),
  ('Seylan Bank', 'Boralesgamuwa', NULL, 'Boralesgamuwa', 'Sub I', NULL, 6.84106, 79.90170),
  ('Seylan Bank', 'Colombo Gold Centre', NULL, 'Pettah', 'Metro II', NULL, 6.93276, 79.85491),
  ('Seylan Bank', 'Chenkalady', NULL, 'Chenkalady', 'East', NULL, 7.78442, 81.59401),
  ('Seylan Bank', 'Dehiattakandiya', NULL, 'Dehiattakandiya', 'N.C', NULL, 7.67150, 81.04089),
  ('Seylan Bank', 'Eheliyagoda', NULL, 'Eheliyagoda', 'US', NULL, 6.85313, 80.26254),
  ('Seylan Bank', 'Eppawala', NULL, 'Eppawala', 'N.C', NULL, 8.14613, 80.41139),
  ('Seylan Bank', 'Galenbidunuwewa', NULL, 'Galenbindunuwewa', 'N.C', NULL, 8.29245, 80.71897),
  ('Seylan Bank', 'Hingurakgoda', NULL, 'Hingurakgoda', 'N.C', NULL, 8.04151, 80.95317),
  ('Seylan Bank', 'Hatton', NULL, 'Hatton', 'Central', NULL, 6.89163, 80.59846),
  ('Seylan Bank', 'Kamburupitiya', NULL, 'Kamburupitiya', 'South', NULL, 6.08028, 80.56738),
  ('Seylan Bank', 'Kanthale', NULL, 'Kantale', 'N.C', NULL, 8.36700, 81.00284),
  ('Seylan Bank', 'Kaduruwela', NULL, 'Kaduruwela', 'N.C', NULL, 7.93065, 81.03274),
  ('Seylan Bank', 'Kekirawa', NULL, 'Kekirawa', 'N.C', NULL, 8.04083, 80.59710),
  ('Seylan Bank', 'Kattankudy', NULL, 'Kattankudy', 'East', NULL, 7.68049, 81.72897),
  ('Seylan Bank', 'Kelaniya', NULL, 'Kelaniya', 'West', NULL, 6.95023, 79.91719),
  ('Seylan Bank', 'Kalmunai', NULL, 'Kalmunai', 'East', NULL, 7.41316, 81.82693),
  ('Seylan Bank', 'Kalpitiya', NULL, 'Kalpitiya', 'NW II', NULL, 8.23681, 79.76615),
  ('Seylan Bank', 'Katugastota', NULL, 'Katugastota', 'Central', NULL, 7.32208, 80.62496),
  ('Seylan Bank', 'Kalawanchikudy', NULL, 'Kaluwanchikudy', 'East', NULL, 7.51750, 81.78713),
  ('Seylan Bank', 'Monaragala', NULL, 'Monaragala', 'US', NULL, 6.87273, 81.35058),
  ('Seylan Bank', 'Mahiyangana', NULL, 'Mahiyangana', 'Central', NULL, 7.32075, 80.99096),
  ('Seylan Bank', 'Manampitiya', NULL, 'Manampitiya', 'N.C', NULL, 7.90885, 81.11192),
  ('Seylan Bank', 'Moratuwa', NULL, 'Moratuwa', 'Sub I', NULL, 6.77468, 79.88261),
  ('Seylan Bank', 'Mullaitivu', NULL, 'Mullaitivu', 'North', NULL, 9.26985, 80.81453),
  ('Seylan Bank', 'Mawathagama', NULL, 'Mawathagama', 'NW II', NULL, 7.43299, 80.44641),
  ('Seylan Bank', 'Nochiyagama', NULL, 'Nochchiyagama', 'N.C', NULL, 8.26401, 80.21051),
  ('Seylan Bank', 'Nawalapitiya', NULL, 'Nawalapitiya', 'Central', NULL, 7.05589, 80.53501),
  ('Seylan Bank', 'Priority Banking Centre', NULL, 'Kollupitiya', 'Branch', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Pitakotte', NULL, 'Pita Kotte', 'Sub II', NULL, 6.88307, 79.90181),
  ('Seylan Bank', 'Piliyandala', NULL, 'Piliyandala', 'Sub I', NULL, 6.79995, 79.92312),
  ('Seylan Bank', 'Pilimathalawa', NULL, 'Pilimathalawa', 'Central', NULL, 7.26563, 80.55211),
  ('Seylan Bank', 'Puttalam', NULL, 'Puttalam', 'NW II', NULL, 7.98184, 79.82934),
  ('Seylan Bank', 'Pothuvil', NULL, 'Pottuvil', 'East', NULL, 6.87324, 81.83005),
  ('Seylan Bank', 'Padaviya', NULL, 'Padaviya', 'N.C', NULL, 8.83503, 80.77007),
  ('Seylan Bank', 'Ratnapura', NULL, 'Ratnapura', 'US', NULL, 6.57957, 80.58822),
  ('Seylan Bank', 'Sarikkamulla', NULL, 'Panadura', 'Sub I', NULL, 6.71241, 79.90458),
  ('Seylan Bank', 'Sammanthurai', NULL, 'Sammanthurai', 'East', NULL, 7.35798, 81.79846),
  ('Seylan Bank', 'Siyambalanduwa', NULL, 'Siyambalanduwa', 'US', NULL, 6.90640, 81.55921),
  ('Seylan Bank', 'Trincomalee', NULL, 'Trincomalee', 'East', NULL, 8.57643, 81.23450),
  ('Seylan Bank', 'Thalawakele', NULL, 'Talawakele', 'Central', NULL, 6.93808, 80.66147),
  ('Seylan Bank', 'Udappu', NULL, 'Udappuwa', 'NW II', NULL, 7.74668, 79.79047),
  ('Seylan Bank', 'Vavuniya', NULL, 'Vavuniya', 'North', NULL, 8.75935, 80.50008),
  ('Seylan Bank', 'Wijerama', NULL, 'Gangodawila', 'Sub II', NULL, 6.86217, 79.90231),
  ('Seylan Bank', 'Welimada', NULL, 'Welimada', 'US', NULL, 6.90584, 80.90981),
  ('Seylan Bank', 'Wariyapola', NULL, 'Wariyapola', 'NW II', NULL, 7.61981, 80.24612),
  ('Seylan Bank', 'Yatiyantota', NULL, 'Yatiyantota', 'US', NULL, 7.02896, 80.29503),
  ('Seylan Bank', 'Metropolitan I Area Office', NULL, 'Kollupitiya', 'Area Office Metro I', NULL, 6.91353, 79.85081),
  ('Seylan Bank', 'Uva Sabaragamuwa Area Office', NULL, 'Ratnapura', 'Area Office US', NULL, 6.57957, 80.58822),
  ('National Youth Corps', 'Akurassa', NULL, 'Akuressa', NULL, '6421154300019', 6.10118, 80.47649),
  ('National Youth Corps', 'Alauwa', NULL, 'Alawwa', NULL, '6421154300049', 7.29402, 80.23924),
  ('National Youth Corps', 'Anuradhapura', NULL, 'Anuradhapura', NULL, '6421154300026', 8.33498, 80.41061),
  ('National Youth Corps', 'Bandarawela', NULL, 'Bandarawela', NULL, '6421154300037', 6.83048, 80.98882),
  ('National Youth Corps', 'Bulathsinhala', NULL, 'Bulathsinhala', NULL, '6421154300047', 6.64990, 80.17802),
  ('National Youth Corps', 'Dambulla', NULL, 'Dambulla', NULL, '6421154300029', 7.87420, 80.65109),
  ('National Youth Corps', 'Dehiaththakandiya', NULL, 'Dehiattakandiya', NULL, '6421154300039', 7.67150, 81.04089),
  ('National Youth Corps', 'Dehiowita', NULL, 'Dehiowita', NULL, '6421154300041', 6.96656, 80.26592),
  ('National Youth Corps', 'Dikwalla', NULL, 'Dickwella', NULL, '6421154300044', 5.96394, 80.69404),
  ('National Youth Corps', 'Diulapitiya', NULL, 'Divulapitiya', NULL, '6421154300015', 7.22454, 80.01937),
  ('National Youth Corps', 'Dodamgaslanda', NULL, 'Dodangaslanda', NULL, '6421154300030', 7.57293, 80.52945),
  ('National Youth Corps', 'Galle', NULL, 'Galle', NULL, '6421154300043', 6.03281, 80.21496),
  ('National Youth Corps', 'Gampola', NULL, 'Gampola', NULL, '6421154300023', 7.16365, 80.57027),
  ('National Youth Corps', 'Head Office', NULL, 'Maharagama', NULL, '6421154300038', 6.84728, 79.92661),
  ('National Youth Corps', 'Kala-Wewa', NULL, 'Kalawewa', NULL, '6421154300028', 7.99965, 80.53363),
  ('National Youth Corps', 'Kuliyapitiya', NULL, 'Kuliyapitiya', NULL, '6421154300035', 7.47014, 80.04403),
  ('National Youth Corps', 'Mahiyanganaya', NULL, 'Mahiyangana', NULL, '6421154300040', 7.32075, 80.99096),
  ('National Youth Corps', 'Mawathgama', NULL, 'Mawathagama', NULL, '6421154300031', 7.43299, 80.44641),
  ('National Youth Corps', 'Neluwa', NULL, 'Neluwa', NULL, '6421154300018', 6.37734, 80.36079),
  ('National Youth Corps', 'Nivithigala', NULL, 'Nivithigala', NULL, '6421154300020', 6.59591, 80.45779),
  ('National Youth Corps', 'NuwaraEliya', NULL, 'Nuwara Eliya', NULL, '6421154300036', 7.01240, 80.75716),
  ('National Youth Corps', 'Paduwasnuwara', NULL, 'Panduwasnuwara', NULL, '6421154300033', 7.59964, 80.10333),
  ('National Youth Corps', 'Senkadagala', NULL, 'Kandy', NULL, '6421154300022', 7.29312, 80.63504),
  ('National Youth Corps', 'Sooriyawewa', NULL, 'Suriyawewa', NULL, '6421154300045', 6.31310, 80.99549),
  ('National Youth Corps', 'Walahena', NULL, 'Walahena', NULL, '6421154300034', 7.40571, 80.60239),
  ('National Youth Corps', 'Walapane', NULL, 'Walapane', NULL, '6421144600230', 7.09581, 80.86244),
  ('National Youth Corps', 'Wariyapola', NULL, 'Wariyapola', NULL, '6421154300032', 7.61981, 80.24612),
  ('National Youth Corps', 'Weerakatiya', NULL, 'Weeraketiya', NULL, '6421154300046', 6.14843, 80.76324),
  ('National Youth Corps', 'Yakkala', NULL, 'Yakkala', NULL, '6421154300017', 7.08592, 80.03356),
  ('National Youth Corps', 'Yatinuwara', NULL, 'Kiribathkumbura', NULL, '6421154300021', 7.26773, 80.57626),
  ('National Youth Corps', 'Madirigiriya', NULL, 'Medirigiriya', NULL, '3929091914431', 8.14233, 80.97134),
  ('National Youth Corps', 'Weerawila', NULL, 'Weerawila', NULL, '3929091914432', 6.25750, 81.22812),
  ('National Youth Corps', 'Wellawaya', NULL, 'Wellawaya', NULL, '3929091914433', 6.73178, 81.10184),
  ('National Youth Corps', 'Akmeemana', NULL, 'Akmeemana', NULL, 'OLK6060056061500001', 6.06956, 80.26100),
  ('National Youth Corps', 'Embilipitiya', NULL, 'Embilipitiya', NULL, 'OLK6060056061500002', 6.33406, 80.85383),
  ('National Youth Corps', 'Kuchchaweli', NULL, 'Kuchchaveli', NULL, 'OLK6060056061500003', 8.81826, 81.09962),
  ('National Youth Corps', 'Mannar', NULL, 'Mannar', NULL, 'OLK6060056061500005', 8.98129, 79.90439),
  ('National Youth Corps', 'Monaragala', NULL, 'Monaragala', NULL, 'OLK6060056061500006', 6.87273, 81.35058),
  ('National Youth Corps', 'Thanamalwila', NULL, 'Thanamalwila', NULL, 'OLK6060056061500007', 6.43329, 81.13104),
  ('National Youth Corps', 'Valaichchenai', NULL, 'Valaichchenai', NULL, 'OLK6060056061500009', 7.90908, 81.53312),
  ('National Youth Corps', 'Seruwawila', NULL, 'Seruvila', NULL, 'OLK6060056061500010', 8.32569, 81.30063),
  ('National Youth Corps', 'Irattaperiyakulam', NULL, 'Irattaperiyakulam', NULL, 'OLK6060056061500011', 8.75069, 80.50355),
  ('National Youth Corps', 'Ampara', NULL, 'Ampara', NULL, 'OLK6060056061500012', 7.07376, 81.83229),
  ('National Youth Corps', 'Trincomalee', NULL, 'Trincomalee', NULL, 'OLK6060056061500013', 8.57643, 81.23450),
  ('National Youth Corps', 'Gomarankadawala', NULL, 'Gomarankadawala', NULL, 'A2BW174660001', 8.67456, 80.95620),
  ('National Youth Corps', 'Galenbidunuwewa', NULL, 'Galenbindunuwewa', NULL, 'CEPN192160001', 8.29245, 80.71897),
  ('National Youth Corps', 'Balangoda', NULL, 'Balangoda', NULL, 'CEPN194460001', 6.65014, 80.69857),
  ('National Youth Corps', 'Mulathiv', NULL, 'Mullaitivu', NULL, 'CEPN194460002', 9.26985, 80.81453),
  ('National Youth Corps', 'Rajagiriya', NULL, 'Rajagiriya', NULL, 'EJB8240200002', 6.90950, 79.89622),
  ('National Youth Corps', 'Naula', NULL, 'Naula', NULL, 'EJB8251600001', 7.70704, 80.65308),
  ('National Youth Corps', 'Kegalle', NULL, 'Kegalle', NULL, 'NYU7253000387', 7.11344, 80.32174),
  ('National Youth Corps', 'Katharagama HS', NULL, 'Kataragama', NULL, 'NYU7253000400', 6.41356, 81.33244),
  ('National Youth Corps', 'Galigamuwa', NULL, 'Galigamuwa', NULL, 'NYU7253000412', 7.23574, 80.31026),
  ('National Youth Corps', 'Kakirawa', NULL, 'Kekirawa', NULL, 'NYU7253000419', 8.04083, 80.59710),
  ('National Youth Corps', 'Aththanagalla Face', NULL, 'Attanagalla', NULL, 'NYU7253000422', 7.11384, 80.13677),
  ('National Youth Corps', 'Lunugam Wehera', NULL, 'Lunugamvehera', NULL, 'NYU7253000425', 6.34704, 81.19614),
  ('National Youth Corps', 'Diganpathaha', NULL, 'Digampathana', NULL, 'NYU7253000618', 7.98406, 80.72080),
  ('National Youth Corps', 'Katunayake Face', NULL, 'Katunayake', NULL, 'NYU7253000619', 7.15677, 79.87167),
  ('National Youth Corps', 'Naththandiya', NULL, 'Nattandiya', NULL, 'NYU7253000620', 7.41219, 79.86434),
  ('National Youth Corps', 'Wennapuwa', NULL, 'Wennappuwa', NULL, 'NYU7253000374', 7.34264, 79.84131),
  ('National Youth Corps', 'Head Office Attendance', NULL, 'Maharagama', NULL, NULL, 6.84728, 79.92661),
  ('SLT-Mobitel', 'SLT Corporate Head Office', 'Lotus Road, Colombo 01', 'Fort, Colombo', NULL, NULL, 6.93435, 79.84482),
  ('SLT-Mobitel', 'Mobitel Corporate Head Office', '148/15 Lesley Ranagala Mawatha, Baseline Road, Colombo 08', 'Borella', NULL, NULL, 6.91483, 79.87760),
  ('SLT-Mobitel', 'Central Telegraph Office (CTO)', 'Lower Chatham Street / Lotus Road, Colombo 01', 'Fort, Colombo', NULL, NULL, 6.93435, 79.84482),
  ('SLT-Mobitel', 'SLT Welikada Center', 'Welikada, Colombo', 'Welikada', NULL, NULL, 6.91073, 79.89306),
  ('SLT-Mobitel', 'Ambalangoda Teleshop', 'Regional Telecom Office / Teleshop, Galle Road, Ambalangoda', 'Ambalangoda', NULL, NULL, 6.23891, 80.05415),
  ('SLT-Mobitel', 'Ampara Teleshop', 'Regional Telecom Office / Teleshop, Secretariat Quadrangle, Ampara', 'Ampara', NULL, NULL, 7.07376, 81.83229),
  ('SLT-Mobitel', 'Anuradhapura Teleshop', 'Regional Telecom Office / Teleshop, Stage II, Anuradhapura', 'Anuradhapura', NULL, NULL, 8.33498, 80.41061),
  ('SLT-Mobitel', 'Badulla Teleshop', 'Regional Telecom Office / Teleshop, Bandaranayake Mawatha, Badulla', 'Badulla', NULL, NULL, 6.99004, 81.05703),
  ('SLT-Mobitel', 'Bandarawela Teleshop', 'Regional Telecom Office / Teleshop, Welimada Road, Bandarawela', 'Bandarawela', NULL, NULL, 6.83048, 80.98882),
  ('SLT-Mobitel', 'Batticaloa Teleshop', 'Regional Telecom Office / Teleshop, Bar Road, Batticaloa', 'Batticaloa', NULL, NULL, 7.83814, 81.55692),
  ('SLT-Mobitel', 'Chilaw Teleshop', 'Regional Telecom Office / Teleshop, Puttalam Road, Chilaw', 'Chilaw', NULL, NULL, 7.57626, 79.79536),
  ('SLT-Mobitel', 'Dambulla Teleshop', 'Regional Telecom Office / Teleshop, Anuradhapura Road, Dambulla', 'Dambulla', NULL, NULL, 7.87420, 80.65109),
  ('SLT-Mobitel', 'Embilipitiya Teleshop', 'Regional Telecom Office / Teleshop, Pallegama, Embilipitiya', 'Embilipitiya', NULL, NULL, 6.33406, 80.85383),
  ('SLT-Mobitel', 'Galle Teleshop', 'Regional Telecom Office / Teleshop, No. 32, Wakwella Road, Galle', 'Galle', NULL, NULL, 6.03281, 80.21496),
  ('SLT-Mobitel', 'Gampaha Teleshop', 'Regional Telecom Office / Teleshop, Court Road, Gampaha', 'Gampaha', NULL, NULL, 7.11902, 79.91599),
  ('SLT-Mobitel', 'Gampola Teleshop', 'Regional Telecom Office / Teleshop, Nuwara Eliya Road, Gampola', 'Gampola', NULL, NULL, 7.16365, 80.57027),
  ('SLT-Mobitel', 'Hambantota Teleshop', 'Regional Telecom Office / Teleshop, Hambantota, Hambantota', 'Hambantota', NULL, NULL, 6.12491, 81.12426),
  ('SLT-Mobitel', 'Hatton Teleshop', 'Regional Telecom Office / Teleshop, Dimbula Road, Hatton', 'Hatton', NULL, NULL, 6.89163, 80.59846),
  ('SLT-Mobitel', 'Havelock Town Teleshop', 'Regional Telecom Office / Teleshop, Dickmans Road, Colombo 05, Havelock Town', 'Havelock Town', NULL, NULL, 6.88623, 79.86528),
  ('SLT-Mobitel', 'Homagama Teleshop', 'Regional Telecom Office / Teleshop, High Level Road, Homagama', 'Homagama', NULL, NULL, 6.84124, 80.00345),
  ('SLT-Mobitel', 'Horana Teleshop', 'Regional Telecom Office / Teleshop, Panadura Road, Horana', 'Horana', NULL, NULL, 6.71665, 80.06195),
  ('SLT-Mobitel', 'Jaffna Teleshop', 'Regional Telecom Office / Teleshop, Mahatma Gandhi Road, Jaffna', 'Jaffna', NULL, NULL, 9.66509, 80.00930),
  ('SLT-Mobitel', 'Kadawatha Teleshop', 'Regional Telecom Office / Teleshop, Ragama Road, Kadawatha', 'Kadawatha', NULL, NULL, 7.00214, 79.95123),
  ('SLT-Mobitel', 'Kalmunai Teleshop', 'Regional Telecom Office / Teleshop, Main Street, Kalmunai', 'Kalmunai', NULL, NULL, 7.41316, 81.82693),
  ('SLT-Mobitel', 'Kalutara Teleshop', 'Regional Telecom Office / Teleshop, Main Street, Kalutara', 'Kalutara', NULL, NULL, 6.57453, 80.02863),
  ('SLT-Mobitel', 'Kandy Teleshop', 'Regional Telecom Office / Teleshop, Dalada Veediya, Kandy', 'Kandy', NULL, NULL, 7.29312, 80.63504),
  ('SLT-Mobitel', 'Kegalle Teleshop', 'Regional Telecom Office / Teleshop, Main Street, Kegalle', 'Kegalle', NULL, NULL, 7.11344, 80.32174),
  ('SLT-Mobitel', 'Kelaniya Teleshop', 'Regional Telecom Office / Teleshop, Station Road, Kelaniya', 'Kelaniya', NULL, NULL, 6.95023, 79.91719),
  ('SLT-Mobitel', 'Kilinochchi Teleshop', 'Regional Telecom Office / Teleshop, A9 Road, Kilinochchi', 'Kilinochchi', NULL, NULL, 9.38401, 80.40872),
  ('SLT-Mobitel', 'Kotte Teleshop', 'Regional Telecom Office / Teleshop, Nawala Road, Kotte', 'Sri Jayawardenepura Kotte', NULL, NULL, 6.89955, 79.90585),
  ('SLT-Mobitel', 'Kuliyapitiya Teleshop', 'Regional Telecom Office / Teleshop, Main Street, Kuliyapitiya', 'Kuliyapitiya', NULL, NULL, 7.47014, 80.04403),
  ('SLT-Mobitel', 'Kurunegala Teleshop', 'Regional Telecom Office / Teleshop, Colombo Road, Kurunegala', 'Kurunegala', NULL, NULL, 7.48705, 80.36491),
  ('SLT-Mobitel', 'Mannar Teleshop', 'Regional Telecom Office / Teleshop, Station Road, Mannar', 'Mannar', NULL, NULL, 8.98129, 79.90439),
  ('SLT-Mobitel', 'Maradana Teleshop', 'Regional Telecom Office / Teleshop, Maradana Road, Colombo 08, Maradana', 'Maradana', NULL, NULL, 6.92843, 79.86486),
  ('SLT-Mobitel', 'Matale Teleshop', 'Regional Telecom Office / Teleshop, Main Street, Matale', 'Matale', NULL, NULL, 7.69821, 80.66091),
  ('SLT-Mobitel', 'Matara Teleshop', 'Regional Telecom Office / Teleshop, Anagarika Dharmapala Mawatha, Matara', 'Matara', NULL, NULL, 5.94782, 80.54829),
  ('SLT-Mobitel', 'Negombo Teleshop', 'Regional Telecom Office / Teleshop, St. Joseph''s Street, Negombo', 'Negombo', NULL, NULL, 7.20943, 79.83312),
  ('SLT-Mobitel', 'Nittambuwa Teleshop', 'Regional Telecom Office / Teleshop, Kandy Road, Nittambuwa', 'Nittambuwa', NULL, NULL, 7.14408, 80.09650),
  ('SLT-Mobitel', 'Nugegoda Teleshop', 'Regional Telecom Office / Teleshop, High Level Road, Nugegoda', 'Nugegoda', NULL, NULL, 6.86997, 79.88828),
  ('SLT-Mobitel', 'Nuwara Eliya Teleshop', 'Regional Telecom Office / Teleshop, Badulla Road, Nuwara Eliya', 'Nuwara Eliya', NULL, NULL, 7.01240, 80.75716),
  ('SLT-Mobitel', 'Panadura Teleshop', 'Regional Telecom Office / Teleshop, Galle-Colombo Road, Panadura', 'Panadura', NULL, NULL, 6.71241, 79.90458),
  ('SLT-Mobitel', 'Polonnaruwa Teleshop', 'Regional Telecom Office / Teleshop, Batticaloa Road, Polonnaruwa', 'Polonnaruwa', NULL, NULL, 7.99824, 81.04717),
  ('SLT-Mobitel', 'Ratnapura Teleshop', 'Regional Telecom Office / Teleshop, Outer Circular Road, Ratnapura', 'Ratnapura', NULL, NULL, 6.57957, 80.58822),
  ('SLT-Mobitel', 'Ratmalana Teleshop', 'Regional Telecom Office / Teleshop, Galle Road, Ratmalana', 'Ratmalana', NULL, NULL, 6.81975, 79.86826),
  ('SLT-Mobitel', 'Trincomalee Teleshop', 'Regional Telecom Office / Teleshop, Inner Harbour Road, Trincomalee', 'Trincomalee', NULL, NULL, 8.57643, 81.23450),
  ('SLT-Mobitel', 'Vavuniya Teleshop', 'Regional Telecom Office / Teleshop, Jaffna Road, Vavuniya', 'Vavuniya', NULL, NULL, 8.75935, 80.50008),
  ('SLT-Mobitel', 'Wattala Teleshop', 'Regional Telecom Office / Teleshop, Negombo Road, Wattala', 'Wattala', NULL, NULL, 6.98987, 79.89271),
  ('Central Environmental Authority', 'Head Office (Parisara Piyasa)', 'No. 104, Denzil Kobbekaduwa Mawatha, Battaramulla', 'Battaramulla', NULL, NULL, 6.90218, 79.91958),
  ('Central Environmental Authority', 'Western Provincial Office', 'No. 104, Denzil Kobbekaduwa Mawatha, Battaramulla', 'Battaramulla', NULL, NULL, 6.90218, 79.91958),
  ('Central Environmental Authority', 'Central Provincial Office', 'Polgolla Dam Site, Polgolla, Kandy', 'Polgolla', NULL, NULL, 7.32795, 80.64673),
  ('Central Environmental Authority', 'Southern Provincial Office', 'Habaraduwa Road, Koggala, Galle', 'Koggala', NULL, NULL, 5.99037, 80.32263),
  ('Central Environmental Authority', 'Eastern Provincial Office', 'No. 05, Priyantha Mawatha, Kantale', 'Kantale', NULL, NULL, 8.36700, 81.00284),
  ('Central Environmental Authority', 'North Central Provincial Office', 'No. 388/40, Harishchandra Mawatha, Anuradhapura', 'Anuradhapura', NULL, NULL, 8.33498, 80.41061),
  ('Central Environmental Authority', 'North Western Provincial Office', 'Kurunegala', 'Kurunegala', NULL, NULL, 7.48705, 80.36491),
  ('Central Environmental Authority', 'Northern Provincial Office', '4th Cross, Ponnagar, Ariviyal Nagar, Kilinochchi', 'Kilinochchi', NULL, NULL, 9.38401, 80.40872),
  ('Central Environmental Authority', 'Sabaragamuwa Provincial Office', 'No. 582/2, New Town, Ratnapura', 'Ratnapura', NULL, NULL, 6.57957, 80.58822),
  ('Central Environmental Authority', 'Uva Provincial Office', 'No. 179, Keppetipola Road, Badulla', 'Badulla', NULL, NULL, 6.99004, 81.05703),
  ('Central Environmental Authority', 'Ampara District Office', 'Ampara', 'Ampara', NULL, NULL, 7.07376, 81.83229),
  ('Central Environmental Authority', 'Batticaloa District Office', 'Batticaloa', 'Batticaloa', NULL, NULL, 7.83814, 81.55692),
  ('Central Environmental Authority', 'Gampaha District Office', 'No. 181, 1 Kandy Road, Yakkala', 'Yakkala', NULL, NULL, 7.08592, 80.03356),
  ('Central Environmental Authority', 'Hambantota District Office', 'No. 279A, Tissa Road, Tangalle', 'Tangalle', NULL, NULL, 6.02508, 80.79493),
  ('Central Environmental Authority', 'Jaffna District Office', 'Jaffna', 'Jaffna', NULL, NULL, 9.66509, 80.00930),
  ('Central Environmental Authority', 'Kalutara District Office', 'No. 7A, Central Junction, Kalutara', 'Kalutara', NULL, NULL, 6.57453, 80.02863),
  ('Central Environmental Authority', 'Kegalle District Office', 'No. 54/7, Albert Seneviratne Mawatha, Kegalle', 'Kegalle', NULL, NULL, 7.11344, 80.32174),
  ('Central Environmental Authority', 'Mannar District Office', 'Mannar', 'Mannar', NULL, NULL, 8.98129, 79.90439),
  ('Central Environmental Authority', 'Matale District Office', 'Matale', 'Matale', NULL, NULL, 7.69821, 80.66091),
  ('Central Environmental Authority', 'Matara District Office', 'Harischandra Mawatha, Matara', 'Matara', NULL, NULL, 5.94782, 80.54829),
  ('Central Environmental Authority', 'Monaragala District Office', 'Monaragala', 'Monaragala', NULL, NULL, 6.87273, 81.35058),
  ('Central Environmental Authority', 'Mullaitivu District Office', 'Muslim Vidyalaya Road, Vannankulam, Mullaitivu', 'Mullaitivu', NULL, NULL, 9.26985, 80.81453),
  ('Central Environmental Authority', 'Nuwara Eliya District Office', 'No. 04, Wajira Mawatha, Hawa Eliya, Nuwara Eliya', 'Nuwara Eliya', NULL, NULL, 7.01240, 80.75716),
  ('Central Environmental Authority', 'Polonnaruwa District Office', '2nd Floor, Methsiripaya Administrative Complex, New Town, Polonnaruwa', 'Polonnaruwa', NULL, NULL, 7.99824, 81.04717),
  ('Central Environmental Authority', 'Puttalam District Office', 'No. 155/A, A3 Road, Puttalam', 'Puttalam', NULL, NULL, 7.98184, 79.82934),
  ('Central Environmental Authority', 'Vavuniya District Office', 'Vavuniya', 'Vavuniya', NULL, NULL, 8.75935, 80.50008)
) AS v(client, name, address, place, region, serial, lat, lng)
ON CONFLICT (client, name) DO NOTHING;

INSERT INTO public.planned_services (site_id, contract_year, visit, due_by)
SELECT s.id, v.contract_year, 'Service', v.due_by::date
FROM (VALUES
  ('Seylan Bank', 'Head Office - 1st Floor - Millennium Branch', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 2nd Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 3rd Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 4th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 5th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 6th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 7th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 8th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 9th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 10th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 11th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 12th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 13th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 14th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 15th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 16th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - 17th Floor', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - PMD - Basement', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - Imports', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - Card Centre', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - MSL', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Head Office - COL', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Ambalantota', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Aralaganwila', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Akkaraipattu', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Akuressa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Ampara', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Anuradhapura', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Avissawella', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Balangoda', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Batticaloa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Bogawantalawa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Boralesgamuwa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Colombo Gold Centre', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Chenkalady', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Dehiattakandiya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Eheliyagoda', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Eppawala', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Galenbidunuwewa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Hingurakgoda', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Hatton', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kamburupitiya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kanthale', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kaduruwela', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kekirawa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kattankudy', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kelaniya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kalmunai', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kalpitiya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Katugastota', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Kalawanchikudy', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Monaragala', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Mahiyangana', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Manampitiya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Moratuwa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Mullaitivu', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Mawathagama', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Nochiyagama', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Nawalapitiya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Priority Banking Centre', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Pitakotte', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Piliyandala', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Pilimathalawa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Puttalam', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Pothuvil', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Padaviya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Ratnapura', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Sarikkamulla', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Sammanthurai', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Siyambalanduwa', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Trincomalee', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Thalawakele', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Udappu', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Vavuniya', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Wijerama', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Welimada', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Wariyapola', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Yatiyantota', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Metropolitan I Area Office', '2025/26', '2026-07-31'),
  ('Seylan Bank', 'Uva Sabaragamuwa Area Office', '2025/26', '2026-07-31'),
  ('National Youth Corps', 'Akurassa', '2026/27', NULL),
  ('National Youth Corps', 'Alauwa', '2026/27', NULL),
  ('National Youth Corps', 'Anuradhapura', '2026/27', NULL),
  ('National Youth Corps', 'Bandarawela', '2026/27', NULL),
  ('National Youth Corps', 'Bulathsinhala', '2026/27', NULL),
  ('National Youth Corps', 'Dambulla', '2026/27', NULL),
  ('National Youth Corps', 'Dehiaththakandiya', '2026/27', NULL),
  ('National Youth Corps', 'Dehiowita', '2026/27', NULL),
  ('National Youth Corps', 'Dikwalla', '2026/27', NULL),
  ('National Youth Corps', 'Diulapitiya', '2026/27', NULL),
  ('National Youth Corps', 'Dodamgaslanda', '2026/27', NULL),
  ('National Youth Corps', 'Galle', '2026/27', NULL),
  ('National Youth Corps', 'Gampola', '2026/27', NULL),
  ('National Youth Corps', 'Head Office', '2026/27', NULL),
  ('National Youth Corps', 'Kala-Wewa', '2026/27', NULL),
  ('National Youth Corps', 'Kuliyapitiya', '2026/27', NULL),
  ('National Youth Corps', 'Mahiyanganaya', '2026/27', NULL),
  ('National Youth Corps', 'Mawathgama', '2026/27', NULL),
  ('National Youth Corps', 'Neluwa', '2026/27', NULL),
  ('National Youth Corps', 'Nivithigala', '2026/27', NULL),
  ('National Youth Corps', 'NuwaraEliya', '2026/27', NULL),
  ('National Youth Corps', 'Paduwasnuwara', '2026/27', NULL),
  ('National Youth Corps', 'Senkadagala', '2026/27', NULL),
  ('National Youth Corps', 'Sooriyawewa', '2026/27', NULL),
  ('National Youth Corps', 'Walahena', '2026/27', NULL),
  ('National Youth Corps', 'Walapane', '2026/27', NULL),
  ('National Youth Corps', 'Wariyapola', '2026/27', NULL),
  ('National Youth Corps', 'Weerakatiya', '2026/27', NULL),
  ('National Youth Corps', 'Yakkala', '2026/27', NULL),
  ('National Youth Corps', 'Yatinuwara', '2026/27', NULL),
  ('National Youth Corps', 'Madirigiriya', '2026/27', NULL),
  ('National Youth Corps', 'Weerawila', '2026/27', NULL),
  ('National Youth Corps', 'Wellawaya', '2026/27', NULL),
  ('National Youth Corps', 'Akmeemana', '2026/27', NULL),
  ('National Youth Corps', 'Embilipitiya', '2026/27', NULL),
  ('National Youth Corps', 'Kuchchaweli', '2026/27', NULL),
  ('National Youth Corps', 'Mannar', '2026/27', NULL),
  ('National Youth Corps', 'Monaragala', '2026/27', NULL),
  ('National Youth Corps', 'Thanamalwila', '2026/27', NULL),
  ('National Youth Corps', 'Valaichchenai', '2026/27', NULL),
  ('National Youth Corps', 'Seruwawila', '2026/27', NULL),
  ('National Youth Corps', 'Irattaperiyakulam', '2026/27', NULL),
  ('National Youth Corps', 'Ampara', '2026/27', NULL),
  ('National Youth Corps', 'Trincomalee', '2026/27', NULL),
  ('National Youth Corps', 'Gomarankadawala', '2026/27', NULL),
  ('National Youth Corps', 'Galenbidunuwewa', '2026/27', NULL),
  ('National Youth Corps', 'Balangoda', '2026/27', NULL),
  ('National Youth Corps', 'Mulathiv', '2026/27', NULL),
  ('National Youth Corps', 'Rajagiriya', '2026/27', NULL),
  ('National Youth Corps', 'Naula', '2026/27', NULL),
  ('National Youth Corps', 'Kegalle', '2026/27', NULL),
  ('National Youth Corps', 'Katharagama HS', '2026/27', NULL),
  ('National Youth Corps', 'Galigamuwa', '2026/27', NULL),
  ('National Youth Corps', 'Kakirawa', '2026/27', NULL),
  ('National Youth Corps', 'Aththanagalla Face', '2026/27', NULL),
  ('National Youth Corps', 'Lunugam Wehera', '2026/27', NULL),
  ('National Youth Corps', 'Diganpathaha', '2026/27', NULL),
  ('National Youth Corps', 'Katunayake Face', '2026/27', NULL),
  ('National Youth Corps', 'Naththandiya', '2026/27', NULL),
  ('National Youth Corps', 'Wennapuwa', '2026/27', NULL),
  ('National Youth Corps', 'Head Office Attendance', '2026/27', NULL)
) AS v(client, name, contract_year, due_by)
JOIN public.client_sites s ON s.client = v.client AND s.name = v.name
ON CONFLICT (site_id, contract_year, visit) DO NOTHING;


-- ---------------------------------------------------------------------
-- 6. What was loaded
-- ---------------------------------------------------------------------
SELECT s.client,
       count(DISTINCT s.id) AS sites,
       count(p.id) FILTER (WHERE p.status = 'pending') AS pending_services
FROM public.client_sites s
LEFT JOIN public.planned_services p ON p.site_id = s.id
GROUP BY s.client
ORDER BY s.client;
