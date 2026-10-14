# Service Plan and Trip Planner

Planned services for contract clients, and trips that pick them up on the way
to a far job. Free: no paid map or routing service is used.

## What it does

- **Service Plan** (operators and the CEO, menu bar): every client site and
  the service due there for a contract year, on a map and in a table. Mark a
  service done (service call number) or skipped, add or edit sites, mark all
  of a client's sites due for a new year, download to Excel.
- **Trip Planner** (technicians, operators, the CEO; also **Plan a trip** on
  any open job): choose where you're going. Pending services within the
  allowed extra distance are suggested (overdue first), the stops are put in
  the shortest order, shown on a map, and **Open route in Google Maps** hands
  the ordered route to the Google Maps app for navigation (up to 9 stops).
- **Start service** at a stop logs a normal Service ticket for that site,
  assigned to the technician. Resolving it (service call number, notes,
  receipt photo) marks the planned service done, and it appears in Reports,
  receipts and the Google Drive backup like any job.

## How the route is worked out

In the browser (helpers.js, tested in tests/trip.test.mjs):

- Distances are straight lines × 1.35 (roughly what Sri Lankan roads add);
  time at 40 km/h. Both are estimates; Google Maps shows the real roads.
- A site is "on the way" when visiting it adds at most the allowed extra
  distance. **Auto** allows 15% of the trip, between 20 and 80 km (about 61 km
  for Colombo–Jaffna, 25 km for Colombo–Haputale).
- The order is exact (every possibility checked) for up to 11 stops.

## Data

Migration 0039 created the tables and loaded:

| Client | Sites | Due |
|---|---|---|
| Seylan Bank | 80 | 2025/26, by 31 Jul 2026 (the "TO COMPLETE FOR 2025/26" list) |
| National Youth Corps | 61 | 2026/27 (centres and device serials from the 2026-27 costing) |
| SLT-Mobitel | 47 | nothing yet |
| Central Environmental Authority | 26 | nothing yet |
| ABSL Office | 1 | where trips start |

Positions are **town-level** from OpenStreetMap (© OpenStreetMap
contributors), so a stop may be a few km off. The SLT and CEA lists came from
an online search and should be checked against the offices ABSL actually
services.

## Keeping it right

1. **Set the ABSL office position** once: Service Plan → the yellow notice →
   paste the office's position from Google Maps (press and hold on the
   building, copy the two numbers).
2. **SLT and CEA**: once the real list is confirmed, deactivate the offices
   ABSL doesn't service (Edit → untick Active), then **Mark sites due** for
   the year.
3. **Each new contract year**: **Mark sites due** per client (e.g. Seylan
   2026/27).
4. Set exact positions for sites where the town position isn't good enough.

Map tiles come from tile.openstreetmap.org (allowed in the
Content-Security-Policy in vercel.json and _headers). Its usage policy is
fine for a small team; heavy use would need another tile provider.
