# Service Plan and Trip Planner

Planned services for contract clients, and trips that pick them up on the way
to a far job. Free: no paid map or routing service is used.

## What it does

**Service Plan** (operators and the CEO, menu bar)
- Every client site on a map (red overdue, blue pending, green done, grey
  nothing due) and the services due in a table, filtered by client, status,
  contract year or search. **Download Excel** saves the list.
- **Import from Excel**: an updated service sheet. **Download template** gives
  the current sites as a sheet; fill in Contract year, Visit, Status, Date
  done, Service call (and contacts, serials), import it. A preview shows the
  new sites, changed details and services before anything is saved. Any
  sheet with Client/Site (or Location) headings works; names are matched
  loosely ("Chilaw Seylan" = "Chilaw").
- **Mark sites due**: a service for every active site of a client for a
  contract year and visit (Service, 1st service, 2nd service).
- **Mark done** (done outside the helpdesk, with its service call number),
  **Skip**, **Reopen**.
- **Add site** / **Edit**: address, town, contact person and phone, device
  serial, exact map position (paste from Google Maps), Active.
- Each site shows its last service.

**Trip Planner** (technicians, operators, the CEO; also **Plan a trip** on
any open job)
- Going to a job, a town, or "client sites around the start".
- Pending services on the way: the first 8 (overdue, then least out of the
  way) are ticked, up to 20 can be. **Other client sites on the way** with
  nothing due can be ticked too.
- On trips of 100 km or more, sites near the start (the first 20% of the
  trip, up to 60 km) are left out: they're for a local run. **Include sites
  near the start** shows them.
- The stops are put in the shortest order and split into days by the
  driving day and time at each stop; each day has its own Google Maps link
  (up to 9 stops a day).
- **Share trip** (WhatsApp/SMS text with each day's stops and links) and
  **Print trip sheet** (with space for service call numbers).
- Stops show the site's address and contact, with a call link.
- **Start service** / **Start visit** at a stop logs a Service job for the
  technician; resolving it (service call number, notes, receipt photo) marks
  the service done, and it shows in Reports, receipts and the Drive backup.
- Operators: **Give these stops to** a technician → **Assign the trip**. Each
  stop becomes a job for them (and the destination job if unassigned), and
  they're emailed as for any assignment.

## How the route is worked out

In the browser (helpers.js; tests in tests/trip.test.mjs and
tests/service-plan.test.mjs):

- Distances: straight lines × 1.35 (roughly what Sri Lankan roads add); time
  at 40 km/h. Estimates; Google Maps shows the real roads.
- On the way: visiting the site adds at most the allowed extra distance.
  **Auto** = 15% of the trip, 20–80 km (≈61 km Colombo–Jaffna, ≈25 km
  Colombo–Haputale); 60 km for "around the start".
- Order: exact for up to 11 stops, 2-opt beyond (20 stops at most).
- Days: a day ends when the next drive plus its stop would pass the driving
  day, or at 9 stops.

## Data

| Client | Sites | Source |
|---|---|---|
| Seylan Bank | 206 | every location named in the Seylan service sheets (2024-25, 2025-26, 2026-27), spellings merged |
| National Youth Corps | 61 | centres and device serials from the 2026-27 costing |
| SLT-Mobitel | 47 | office list from an online search, to be confirmed |
| Central Environmental Authority | 26 | office list from an online search, to be confirmed |
| ABSL Office | 1 | where trips start |

The Seylan sheets are right about every service they record, just not kept
up to date. 0041 loaded all 340 recorded services as history (2024/25 1st and
2nd service, 2025/26, 2026/27; date and service call number where given), so
185 of the 206 sites show a last service. Every active Seylan branch and NYC
centre with no 2026/27 service yet is Pending for 2026/27, due by 31 Jul 2027
(nothing overdue). If one was done but not written down, mark it done or
import the updated sheet. (0040 had removed the earlier statuses 0039 guessed
from the "TO COMPLETE" list.)

Positions are **town-level** from OpenStreetMap (© OpenStreetMap
contributors); a stop may be a few km off until its exact position is set.

Names merged on purpose (check these):
- Head Office PMD basement and "BMD Basment" (kept as one PMD basement)
- "Galle- South" = Galle Area Office
- "Rathnapura Reganal" / "Rathnapura Area Office" = Uva Sabaragamuwa Area Office
- "Gold Market" / "Gold Center" = Colombo Gold Centre
- "Seylan Bank Centre, Darmapala Mawatha" / "Ceylan Centre" = Seylan Centre (Dharmapala Mawatha)
- Seylan Card Centre is kept separate from Head Office - Card Centre

## Recommended next steps

1. **Set the ABSL office position** (Service Plan, the notice at the top).
2. **Load the real service status**: Download template → fill in → Import
   from Excel, per client (or send the updated sheets to be converted).
3. **SLT and CEA**: untick Active for offices ABSL doesn't service.
4. **Site contacts** for the sites technicians visit most, so they can call
   ahead.
5. **Exact positions** for sites where the town position isn't good enough
   (big towns, head offices).
6. After a few real trips, compare Google Maps' times with the estimates; the
   1.35 road factor and 40 km/h can be tuned in helpers.js.
7. Later, if budget allows: Google's Routes API would give road-accurate
   times inside the app (needs a billing account).

Map tiles come from tile.openstreetmap.org (allowed in the
Content-Security-Policy in vercel.json and _headers); fine for a small team.
