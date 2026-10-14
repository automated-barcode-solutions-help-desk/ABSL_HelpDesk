/**
 * Service Plan helpers (helpers.js): splitting a trip into days, the
 * share text, contract years, dates from sheets, and reading an import.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const h = require("../helpers.js");

const P = {
  colombo: { lat: 6.939, lng: 79.854, name: "Colombo" },
  anuradhapura: { lat: 8.335, lng: 80.411, name: "Anuradhapura" },
  vavuniya: { lat: 8.759, lng: 80.5, name: "Vavuniya" },
  kilinochchi: { lat: 9.384, lng: 80.409, name: "Kilinochchi" },
  jaffna: { lat: 9.665, lng: 80.009, name: "Jaffna" },
  mannar: { lat: 8.981, lng: 79.904, name: "Mannar" },
  kandy: { lat: 7.293, lng: 80.635, name: "Kandy" }
};

test("splitTripIntoDays: a Jaffna round trip takes more than one day", () => {
  const order = [P.anuradhapura, P.vavuniya, P.kilinochchi, P.jaffna, P.mannar];
  const days = h.splitTripIntoDays(P.colombo, order, P.colombo, { maxHoursPerDay: 8, stopMinutes: 45 });
  assert.ok(days.length >= 2, `${days.length} days`);
  assert.deepEqual(days.flatMap((d) => d.stops), order, "every stop once, in order");
  assert.equal(days[0].from, P.colombo);
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    assert.equal(days[i].from, prev.stops[prev.stops.length - 1] || prev.from, "a day starts where the last one stopped");
  }
  assert.equal(days[days.length - 1].to, P.colombo, "the last day ends at home");
  days.forEach((d) => assert.ok(d.driveHours + d.stopHours <= 8 || d.stops.length <= 1, `day ${d.day} within its hours`));
  const total = days.reduce((sum, d) => sum + d.km, 0);
  const direct = h.orderStops(P.colombo, order, P.colombo);
  assert.ok(Math.abs(total - direct.km) < 1e-6 || total > 0);
});

test("splitTripIntoDays: a short trip is one day", () => {
  const days = h.splitTripIntoDays(P.colombo, [P.kandy], P.colombo, { maxHoursPerDay: 8, stopMinutes: 45 });
  assert.equal(days.length, 1);
  assert.equal(days[0].stops.length, 1);
  assert.equal(days[0].to, P.colombo);
});

test("splitTripIntoDays never puts more stops in a day than one Google Maps link takes", () => {
  const near = Array.from({ length: 20 }, (_, i) => ({ lat: 6.94 + i * 0.002, lng: 79.86 }));
  const days = h.splitTripIntoDays(P.colombo, near, null, { maxHoursPerDay: 24, stopMinutes: 1 });
  assert.ok(days.every((d) => d.stops.length <= h.GOOGLE_MAPS_MAX_WAYPOINTS));
  assert.equal(days.flatMap((d) => d.stops).length, 20);
});

test("tripShareText lists each day with its stops and a map link", () => {
  const days = h.splitTripIntoDays(P.colombo, [P.vavuniya, P.jaffna], P.colombo, { maxHoursPerDay: 8 });
  const text = h.tripShareText(days, { title: "Trip to Jaffna", describe: (s) => s.name });
  assert.ok(text.startsWith("Trip to Jaffna"));
  assert.match(text, /Day 1 \(about \d+ km/);
  assert.match(text, /1\. Vavuniya/);
  assert.equal((text.match(/Map: https:\/\/www\.google\.com\/maps\/dir\//g) || []).length, days.length);
});

test("currentContractYear runs August to July", () => {
  assert.equal(h.currentContractYear(new Date(2026, 7, 1)), "2026/27");
  assert.equal(h.currentContractYear(new Date(2026, 9, 14)), "2026/27");
  assert.equal(h.currentContractYear(new Date(2027, 6, 31)), "2026/27");
  assert.equal(h.currentContractYear(new Date(2026, 0, 5)), "2025/26");
});

test("normalizeContractYear accepts the usual ways of writing it", () => {
  assert.equal(h.normalizeContractYear("2025/26"), "2025/26");
  assert.equal(h.normalizeContractYear("2025-26"), "2025/26");
  assert.equal(h.normalizeContractYear("2025/2026"), "2025/26");
  assert.equal(h.normalizeContractYear("FROM 01.08.2025-31.07.2026"), "");
  assert.equal(h.normalizeContractYear(""), "");
});

test("parseSheetDate reads the formats in ABSL's sheets", () => {
  assert.equal(h.parseSheetDate("2025.11.28"), "2025-11-28");
  assert.equal(h.parseSheetDate("02.09.2024"), "2024-09-02");
  assert.equal(h.parseSheetDate("2025-04-09"), "2025-04-09");
  assert.equal(h.parseSheetDate("28/11/2025"), "2025-11-28");
  assert.equal(h.parseSheetDate(new Date(Date.UTC(2026, 8, 8))), "2026-09-08");
  assert.equal(h.parseSheetDate("2025.02.30"), "");
  assert.equal(h.parseSheetDate("soon"), "");
});

test("normalizeSiteName ignores case, punctuation and 'Seylan'", () => {
  assert.equal(h.normalizeSiteName("Chilaw Seylan"), "chilaw");
  assert.equal(h.normalizeSiteName("  Ja-ela "), "ja ela");
  assert.equal(h.normalizeSiteName("Seylan Card Centre"), "card centre");
});

const places = [P.colombo, P.jaffna, P.vavuniya, { name: "Chilaw", lat: 7.576, lng: 79.795 }, { name: "Matara", lat: 5.948, lng: 80.548 }];
const existing = [
  { id: "s1", client: "Seylan Bank", name: "Chilaw", place: "Chilaw", contact_phone: "" },
  { id: "s2", client: "Seylan Bank", name: "Ja-Ela", place: "Ja-Ela" }
];

test("parseServicePlanImport matches existing sites loosely and adds new ones", () => {
  const result = h.parseServicePlanImport(
    [
      { Client: "Seylan Bank", Site: "Chilaw Seylan", "Contact phone": "0322222222" },
      { client: "Seylan Bank", site: "JA ELA" },
      { CLIENT: "Seylan Bank", Location: "Matara Bazaar", Town: "Matara" },
      { Client: "Seylan Bank", Site: "Nowhere Branch" }
    ],
    existing,
    places
  );
  const byName = Object.fromEntries(result.sites.map((s) => [s.name, s]));
  assert.equal(byName.Chilaw.siteId, "s1");
  assert.deepEqual(byName.Chilaw.changes, { contact_phone: "0322222222" });
  assert.equal(byName["Ja-Ela"].siteId, "s2");
  assert.deepEqual(byName["Ja-Ela"].changes, {});
  assert.equal(byName["Matara Bazaar"].siteId, null);
  assert.deepEqual(byName["Matara Bazaar"].position, { lat: 5.948, lng: 80.548 });
  assert.equal(byName["Nowhere Branch"].position, null);
  assert.ok(result.warnings.some((w) => /Nowhere Branch/.test(w)));
  assert.equal(result.services.length, 0, "no contract year, no service");
});

test("parseServicePlanImport reads services: done, skipped, pending", () => {
  const result = h.parseServicePlanImport(
    [
      { Client: "Seylan Bank", Site: "Chilaw", "Contract year": "2026-27", Status: "Done", "Date done": "2026.09.08", "Service call": "10764" },
      { Client: "Seylan Bank", Site: "Ja-Ela", "Contract year": "2026/27", Status: "Skip" },
      { Client: "Seylan Bank", Site: "Jaffna", Town: "Jaffna", "Contract year": "2026/2027", "Due by": "31.07.2027" },
      { Client: "Seylan Bank", Site: "Vavuniya", Town: "Vavuniya", "Contract year": "2026/27", "Service call": "10800" },
      { Client: "Seylan Bank", Site: "Matara", Town: "Matara", "Contract year": "next year" }
    ],
    existing,
    places
  );
  const by = Object.fromEntries(result.services.map((s) => [s.name, s]));
  assert.deepEqual(
    [by.Chilaw.status, by.Chilaw.contractYear, by.Chilaw.doneDate, by.Chilaw.serviceCall],
    ["done", "2026/27", "2026-09-08", "10764"]
  );
  assert.equal(by["Ja-Ela"].status, "skipped");
  assert.equal(by.Jaffna.status, "pending");
  assert.equal(by.Jaffna.dueBy, "2027-07-31");
  assert.equal(by.Vavuniya.status, "done", "a service call number means it was done");
  assert.equal(by.Matara, undefined);
  assert.ok(result.warnings.some((w) => /next year/.test(w)));
});

test("parseServicePlanImport fills in the client when the sheet has none", () => {
  const result = h.parseServicePlanImport([{ Location: "Chilaw" }], existing, places, { defaultClient: "Seylan Bank" });
  assert.equal(result.sites[0].siteId, "s1");
  const none = h.parseServicePlanImport([{ Location: "Chilaw" }], existing, places);
  assert.equal(none.sites.length, 0);
  assert.ok(none.warnings[0].includes("no client"));
});
