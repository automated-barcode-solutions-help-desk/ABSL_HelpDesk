-- =====================================================================
-- 0040_service_plan_improvements.sql
--
-- Service Plan, round two.
--
-- 1. The sheets 0039 was loaded from are old: their locations are right,
--    their service dates are not. The pending services 0039 loaded from
--    them (Seylan "TO COMPLETE 2025/26", NYC 2026/27) are removed, unless
--    someone has already started, finished, skipped or edited one. Sites
--    stay. Due services come back from updated sheets (Service Plan ->
--    Import) or "Mark sites due".
-- 2. Every Seylan location named anywhere in those sheets is now a site:
--    126 more branches and head-office units (206 in all), town-level
--    positions from OpenStreetMap as before.
-- 3. Sites get a contact person and phone, shown on trips so a technician
--    can call ahead.
-- 4. start_planned_service() takes an optional technician: an operator
--    planning a trip can hand every stop to one technician, who is emailed
--    for each job exactly as with any assignment (via reassign_ticket()).
--    The old one-argument version is dropped, so there is one function.
-- 5. start_site_visit(): a job at any client site, even with nothing due
--    there - for the "other client sites on the way" a trip passes. It is
--    recorded as a planned visit, so it shows as the site's last service.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Site contacts
-- ---------------------------------------------------------------------
ALTER TABLE public.client_sites
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text;


-- ---------------------------------------------------------------------
-- 2. Starting a planned service, optionally for a chosen technician
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_planned_service(uuid);

CREATE OR REPLACE FUNCTION public.start_planned_service(
  p_service_id uuid,
  p_technician_id uuid DEFAULT NULL
)
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

  -- Already started and still open: carry on with that job (and give it
  -- to the chosen technician if nobody has it yet).
  IF v_plan.ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.tickets WHERE id = v_plan.ticket_id;
    IF v_ticket.id IS NOT NULL AND v_ticket.status NOT IN ('resolved', 'closed') THEN
      IF public.current_role() = 'technician'
         AND v_ticket.assigned_technician_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Another technician has already started this service.';
      END IF;
      IF public.is_office() AND p_technician_id IS NOT NULL AND v_ticket.assigned_technician_id IS NULL THEN
        v_ticket := public.reassign_ticket(v_ticket.id, p_technician_id, 'Planned service trip');
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

  -- A technician takes it themselves; an operator either leaves it to be
  -- assigned or hands it to the technician they chose (below).
  IF public.current_role() = 'technician' THEN
    v_assign_to := auth.uid();
  END IF;

  INSERT INTO public.tickets (
    company_id, created_by, title, description, priority, job_type,
    location_name, location_lat, location_lng, site_contact_phone,
    open_for_claim, assigned_technician_id, status
  )
  VALUES (
    v_company_id,
    auth.uid(),
    v_site.name || ' - ' || v_plan.visit || ' ' || v_plan.contract_year,
    'Planned ' || lower(v_plan.visit) || ' for ' || v_site.client || ', ' || v_site.name ||
      ' (contract year ' || v_plan.contract_year || ').' ||
      CASE WHEN nullif(v_site.device_serial, '') IS NOT NULL THEN ' Device serial: ' || v_site.device_serial || '.' ELSE '' END ||
      CASE WHEN nullif(v_site.contact_name, '') IS NOT NULL THEN ' Site contact: ' || v_site.contact_name || '.' ELSE '' END,
    'medium',
    'service',
    coalesce(nullif(v_site.address, ''), v_site.name || ', ' || coalesce(v_site.place, '')),
    v_site.lat,
    v_site.lng,
    nullif(v_site.contact_phone, ''),
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

  IF v_assign_to IS NULL AND p_technician_id IS NOT NULL AND public.is_office() THEN
    v_ticket := public.reassign_ticket(v_ticket.id, p_technician_id, 'Planned service trip');
  END IF;

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.start_planned_service(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_planned_service(uuid, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. A visit to any client site
-- ---------------------------------------------------------------------
-- Uses the site's pending service when it has one. Otherwise records a
-- "Visit <date>" for the client's current contract year (the later of the
-- newest one in use for that client and the August-to-July year) and starts it.
CREATE OR REPLACE FUNCTION public.start_site_visit(
  p_site_id uuid,
  p_technician_id uuid DEFAULT NULL
)
RETURNS public.tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site public.client_sites;
  v_plan_id uuid;
  v_year text;
  v_today date := (now() AT TIME ZONE 'Asia/Colombo')::date;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only ABSL staff can start a site visit.';
  END IF;

  SELECT * INTO v_site FROM public.client_sites WHERE id = p_site_id;
  IF v_site.id IS NULL OR v_site.is_base THEN
    RAISE EXCEPTION 'That client site no longer exists.';
  END IF;

  SELECT id INTO v_plan_id
  FROM public.planned_services
  WHERE site_id = p_site_id AND status = 'pending'
  ORDER BY due_by NULLS LAST, created_at
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    SELECT p.contract_year INTO v_year
    FROM public.planned_services p
    JOIN public.client_sites s ON s.id = p.site_id
    WHERE s.client = v_site.client
    ORDER BY p.contract_year DESC
    LIMIT 1;

    -- The later of the client's newest year in use and this August-to-July
    -- year ("2026/27" sorts after "2025/26" as text).
    v_year := greatest(
      coalesce(v_year, ''),
      CASE WHEN extract(month FROM v_today) >= 8
        THEN to_char(v_today, 'YYYY') || '/' || to_char(v_today + interval '1 year', 'YY')
        ELSE to_char(v_today - interval '1 year', 'YYYY') || '/' || to_char(v_today, 'YY')
      END
    );

    INSERT INTO public.planned_services (site_id, contract_year, visit)
    VALUES (p_site_id, v_year, 'Visit ' || to_char(v_today, 'YYYY-MM-DD'))
    ON CONFLICT (site_id, contract_year, visit) DO UPDATE SET status = 'pending'
    RETURNING id INTO v_plan_id;
  END IF;

  RETURN public.start_planned_service(v_plan_id, p_technician_id);
END;
$$;

REVOKE ALL ON FUNCTION public.start_site_visit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_site_visit(uuid, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. Every Seylan location from the sheets
-- ---------------------------------------------------------------------
INSERT INTO public.client_sites (client, name, address, place, lat, lng)
SELECT 'Seylan Bank', v.name, v.address, v.place, v.lat, v.lng
FROM (VALUES
  ('Head Office - 2nd Floor - HR Department', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 6.91353, 79.85081),
  ('Head Office - 2nd Floor - Mail & Transport', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 6.91353, 79.85081),
  ('Head Office - CCH Basement', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 6.91353, 79.85081),
  ('Head Office - DRV / Mail', 'Seylan Towers, 90 Galle Road, Colombo 03', 'Kollupitiya', 6.91353, 79.85081),
  ('Colombo Fort', NULL, 'Fort, Colombo', 6.93435, 79.84482),
  ('Pettah', NULL, 'Pettah', 6.93276, 79.85491),
  ('Dam Street', NULL, 'Pettah', 6.93276, 79.85491),
  ('Old Moor Street', NULL, 'Hulftsdorp', 6.94100, 79.86400),
  ('Grandpass', NULL, 'Grandpass', 6.94347, 79.87349),
  ('Kotahena', NULL, 'Kotahena', 6.94802, 79.85982),
  ('Mutwal', NULL, 'Mutwal', 6.96700, 79.86900),
  ('Maradana', NULL, 'Maradana', 6.92843, 79.86486),
  ('Union Place', NULL, 'Slave Island', 6.92466, 79.85027),
  ('Kollupitiya', NULL, 'Kollupitiya', 6.91353, 79.85081),
  ('Bambalapitiya', NULL, 'Bambalapitiya', 6.90231, 79.85464),
  ('Wellawatte', NULL, 'Wellawatte', 6.87705, 79.86035),
  ('Havelock Town', NULL, 'Havelock Town', 6.88623, 79.86528),
  ('Cinnamon Gardens', NULL, 'Cinnamon Gardens', 6.90948, 79.86625),
  ('Borella', NULL, 'Borella', 6.91483, 79.87760),
  ('Kirulapone', NULL, 'Kirulapone', 6.88436, 79.87614),
  ('Nawala', NULL, 'Nawala', 6.88698, 79.88719),
  ('Rajagiriya', NULL, 'Rajagiriya', 6.90950, 79.89622),
  ('Battaramulla', NULL, 'Battaramulla', 6.90218, 79.91958),
  ('Thalawathugoda', NULL, 'Talawatugoda', 6.87632, 79.93536),
  ('Malabe', NULL, 'Malabe', 6.90407, 79.95462),
  ('Athurugiriya', NULL, 'Athurugiriya', 6.87798, 79.99002),
  ('Kottawa', NULL, 'Kottawa', 6.84301, 79.96553),
  ('Maharagama', NULL, 'Maharagama', 6.84728, 79.92661),
  ('Nugegoda', NULL, 'Nugegoda', 6.86997, 79.88828),
  ('Nugegoda Area Office', NULL, 'Nugegoda', 6.86997, 79.88828),
  ('Kalubowila', NULL, 'Kalubowila', 6.86646, 79.87729),
  ('Dehiwala', NULL, 'Dehiwala', 6.85128, 79.86598),
  ('Mount Lavinia', NULL, 'Mount Lavinia', 6.83354, 79.86725),
  ('Attidiya', NULL, 'Attidiya', 6.83506, 79.88562),
  ('Soysapura', NULL, 'Moratuwa', 6.77468, 79.88261),
  ('Moratumulla', NULL, 'Moratumulla', 6.78106, 79.89030),
  ('Homagama', NULL, 'Homagama', 6.84124, 80.00345),
  ('Godagama', NULL, 'Godagama', 6.85069, 80.03241),
  ('Padukka', NULL, 'Padukka', 6.84154, 80.09165),
  ('Gothatuwa', NULL, 'Gothatuwa', 6.92966, 79.90606),
  ('Kiribathgoda', NULL, 'Kiribathgoda', 6.97815, 79.92699),
  ('Wattala', NULL, 'Wattala', 6.98987, 79.89271),
  ('Kandana', NULL, 'Kandana', 7.04950, 79.89820),
  ('Ja-Ela', NULL, 'Ja-Ela', 7.07938, 79.89076),
  ('Kadawatha', NULL, 'Kadawatha', 7.00214, 79.95123),
  ('Seylan Centre (Dharmapala Mawatha)', NULL, 'Kollupitiya', 6.91353, 79.85081),
  ('Seylan Sales Centre ADM', NULL, 'Kollupitiya', 6.91353, 79.85081),
  ('Seylan Card Centre', NULL, 'Kollupitiya', 6.91353, 79.85081),
  ('Collection Centre', NULL, 'Kollupitiya', 6.91353, 79.85081),
  ('Gampaha', NULL, 'Gampaha', 7.11902, 79.91599),
  ('Ganemulla', NULL, 'Ganemulla', 7.06828, 79.96139),
  ('Weliweriya', NULL, 'Weliweriya', 7.03228, 80.02835),
  ('Yakkala', NULL, 'Yakkala', 7.08592, 80.03356),
  ('Nittambuwa', NULL, 'Nittambuwa', 7.14408, 80.09650),
  ('Veyangoda', NULL, 'Veyangoda', 7.15345, 80.06025),
  ('Mirigama', NULL, 'Mirigama', 7.24751, 80.12992),
  ('Minuwangoda', NULL, 'Minuwangoda', 7.16927, 79.94846),
  ('Raddolugama', NULL, 'Raddolugama', 7.13657, 79.89932),
  ('Katunayake', NULL, 'Katunayake', 7.15677, 79.87167),
  ('Negombo', NULL, 'Negombo', 7.20943, 79.83312),
  ('North West Area Office (Negombo)', NULL, 'Negombo', 7.20943, 79.83312),
  ('Kochchikade', NULL, 'Kochchikade (Negombo)', 7.26500, 79.85900),
  ('Marandagahamula', NULL, 'Marandagahamula', 7.22900, 79.98859),
  ('Kirindiwela', NULL, 'Kirindiwela', 7.04315, 80.13173),
  ('Ruwanwella', NULL, 'Ruwanwella', 7.04586, 80.25378),
  ('Panadura', NULL, 'Panadura', 6.71241, 79.90458),
  ('Bandaragama', NULL, 'Bandaragama', 6.71451, 79.98897),
  ('Horana', NULL, 'Horana', 6.71665, 80.06195),
  ('Ingiriya', NULL, 'Ingiriya', 6.74376, 80.17668),
  ('Wadduwa', NULL, 'Wadduwa', 6.66397, 79.93051),
  ('Kalutara', NULL, 'Kalutara', 6.57453, 80.02863),
  ('Matugama', NULL, 'Matugama', 6.52295, 80.11426),
  ('Baduraliya', NULL, 'Baduraliya', 6.51734, 80.23058),
  ('Beruwala', NULL, 'Beruwala', 6.47559, 79.98341),
  ('Aluthgama', NULL, 'Aluthgama', 6.43265, 79.99890),
  ('Galle', NULL, 'Galle', 6.03281, 80.21496),
  ('Galle Area Office', NULL, 'Galle', 6.03281, 80.21496),
  ('Karapitiya', NULL, 'Karapitiya', 6.06708, 80.22576),
  ('Hikkaduwa', NULL, 'Hikkaduwa', 6.14075, 80.10282),
  ('Ambalangoda', NULL, 'Ambalangoda', 6.23891, 80.05415),
  ('Koggala', NULL, 'Koggala', 5.99037, 80.32263),
  ('Matara', NULL, 'Matara', 5.94782, 80.54829),
  ('Matara Bazaar', NULL, 'Matara', 5.94782, 80.54829),
  ('Beliatta', NULL, 'Beliatta', 6.05800, 80.72900),
  ('Hambantota', NULL, 'Hambantota', 6.12491, 81.12426),
  ('Tissamaharama', NULL, 'Tissamaharama', 6.27707, 81.28928),
  ('Kataragama', NULL, 'Kataragama', 6.41356, 81.33244),
  ('Embilipitiya', NULL, 'Embilipitiya', 6.33406, 80.85383),
  ('Pelmadulla', NULL, 'Pelmadulla', 6.62343, 80.54315),
  ('Godakawela', NULL, 'Godakawela', 6.50461, 80.65103),
  ('Kegalle', NULL, 'Kegalle', 7.11344, 80.32174),
  ('Mawanella', NULL, 'Mawanella', 7.25234, 80.44599),
  ('Kandy', NULL, 'Kandy', 7.29312, 80.63504),
  ('Peradeniya', NULL, 'Peradeniya', 7.26421, 80.59307),
  ('Pallekele', NULL, 'Pallekele', 7.28053, 80.69607),
  ('Gampola', NULL, 'Gampola', 7.16365, 80.57027),
  ('Pussellawa', NULL, 'Pussellawa', 7.11015, 80.63377),
  ('Nuwara Eliya', NULL, 'Nuwara Eliya', 7.01240, 80.75716),
  ('Matale', NULL, 'Matale', 7.69821, 80.66091),
  ('Dambulla', NULL, 'Dambulla', 7.87420, 80.65109),
  ('Badulla', NULL, 'Badulla', 6.99004, 81.05703),
  ('Bandarawela', NULL, 'Bandarawela', 6.83048, 80.98882),
  ('Kurunegala 1', NULL, 'Kurunegala', 7.48705, 80.36491),
  ('Kurunegala 2', NULL, 'Kurunegala', 7.48705, 80.36491),
  ('Kuliyapitiya', NULL, 'Kuliyapitiya', 7.47014, 80.04403),
  ('Narammala', NULL, 'Narammala', 7.43066, 80.21433),
  ('Pannala', NULL, 'Pannala', 7.32836, 80.02411),
  ('Giriulla', NULL, 'Giriulla', 7.32995, 80.12251),
  ('Warakapola', NULL, 'Warakapola', 7.22496, 80.19654),
  ('Hettipola', NULL, 'Hettipola', 7.60557, 80.07876),
  ('Bowatta', NULL, 'Bowatta', 7.59869, 79.96196),
  ('Dummalasuriya', NULL, 'Dummalasuriya', 7.49307, 79.91166),
  ('Chilaw', NULL, 'Chilaw', 7.57626, 79.79536),
  ('Wennappuwa', NULL, 'Wennappuwa', 7.34264, 79.84131),
  ('Dankotuwa', NULL, 'Dankotuwa', 7.29749, 79.88219),
  ('Katuneriya', NULL, 'Katuneriya', 7.36548, 79.83290),
  ('Medawachchiya', NULL, 'Medawachchiya', 8.53878, 80.49300),
  ('Ranpokunagama', NULL, 'Ranpokunagama', 7.13687, 80.10994),
  ('Jaffna', NULL, 'Jaffna', 9.66509, 80.00930),
  ('Chunnakam', NULL, 'Chunnakam', 9.74593, 80.03340),
  ('Chankanai', NULL, 'Chankanai', 9.74873, 79.97029),
  ('Manipay', NULL, 'Manipay', 9.72449, 79.99603),
  ('Chavakachcheri', NULL, 'Chavakachcheri', 9.65713, 80.15846),
  ('Nelliady', NULL, 'Nelliady', 9.78010, 80.23015),
  ('Kilinochchi', NULL, 'Kilinochchi', 9.38401, 80.40872),
  ('Mannar', NULL, 'Mannar', 8.98129, 79.90439)
) AS v(name, address, place, lat, lng)
ON CONFLICT (client, name) DO NOTHING;


-- ---------------------------------------------------------------------
-- 5. Remove the service statuses taken from the old sheets
-- ---------------------------------------------------------------------
-- 0039 loaded them all in one statement, so they share one created_at.
-- Only those nobody has touched since are removed.
DELETE FROM public.planned_services p
WHERE p.created_at IN (
        SELECT created_at FROM public.planned_services GROUP BY created_at HAVING count(*) >= 100
      )
  AND p.status = 'pending'
  AND p.ticket_id IS NULL
  AND p.started_at IS NULL
  AND p.notes IS NULL
  AND p.updated_at = p.created_at
  AND p.visit = 'Service'
  AND p.contract_year IN ('2025/26', '2026/27');


-- ---------------------------------------------------------------------
-- 6. What there is now
-- ---------------------------------------------------------------------
SELECT s.client,
       count(DISTINCT s.id) AS sites,
       count(p.id) FILTER (WHERE p.status = 'pending') AS pending_services
FROM public.client_sites s
LEFT JOIN public.planned_services p ON p.site_id = s.id
GROUP BY s.client
ORDER BY s.client;
