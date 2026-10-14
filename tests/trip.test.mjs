/**
 * Trip planning (helpers.js): which planned services are on the way, the
 * order to do them in, and the Google Maps link. Real Sri Lankan towns.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const h = require("../helpers.js");

const P = {
  colombo: { lat: 6.939, lng: 79.854, name: "Colombo" },
  kandy: { lat: 7.293, lng: 80.635, name: "Kandy" },
  jaffna: { lat: 9.665, lng: 80.009, name: "Jaffna" },
  vavuniya: { lat: 8.759, lng: 80.5, name: "Vavuniya" },
  kilinochchi: { lat: 9.384, lng: 80.409, name: "Kilinochchi" },
  mannar: { lat: 8.981, lng: 79.904, name: "Mannar" },
  anuradhapura: { lat: 8.335, lng: 80.411, name: "Anuradhapura" },
  galle: { lat: 6.033, lng: 80.215, name: "Galle" },
  batticaloa: { lat: 7.838, lng: 81.557, name: "Batticaloa" },
  haputale: { lat: 6.768, lng: 80.96, name: "Haputale" },
  bandarawela: { lat: 6.83, lng: 80.989, name: "Bandarawela" },
  balangoda: { lat: 6.65, lng: 80.699, name: "Balangoda" },
  nuwaraEliya: { lat: 7.012, lng: 80.757, name: "Nuwara Eliya" }
};

test("haversineKm matches known straight-line distances", () => {
  assert.ok(Math.abs(h.haversineKm(P.colombo, P.kandy) - 94) < 3);
  assert.ok(Math.abs(h.haversineKm(P.colombo, P.jaffna) - 303) < 5);
  assert.equal(h.haversineKm(P.galle, P.galle), 0);
});

test("detourKm is zero on the straight line and grows off it", () => {
  const midway = { lat: (P.colombo.lat + P.kandy.lat) / 2, lng: (P.colombo.lng + P.kandy.lng) / 2 };
  assert.ok(h.detourKm(P.colombo, P.kandy, midway) < 0.5);
  assert.ok(h.detourKm(P.colombo, P.kandy, P.galle) > 150);
});

test("autoDetourKm scales with the trip, within 20-80 km", () => {
  assert.equal(h.autoDetourKm(P.colombo, P.jaffna), 61);
  assert.equal(h.autoDetourKm(P.colombo, P.haputale), 25);
  assert.equal(h.autoDetourKm(P.colombo, { lat: 6.95, lng: 79.86 }), 20);
});

test("nearbyStops: a Jaffna trip picks up the north, not the south or east", () => {
  const candidates = [P.vavuniya, P.kilinochchi, P.mannar, P.anuradhapura, P.galle, P.batticaloa, P.kandy];
  const names = h.nearbyStops(P.colombo, P.jaffna, candidates).map((s) => s.name).sort();
  assert.deepEqual(names, ["Anuradhapura", "Kilinochchi", "Mannar", "Vavuniya"]);
});

test("nearbyStops: a Haputale trip picks up the hill country around it", () => {
  const candidates = [P.bandarawela, P.balangoda, P.nuwaraEliya, P.kandy, P.jaffna, P.galle];
  const names = h.nearbyStops(P.colombo, P.haputale, candidates).map((s) => s.name).sort();
  // Nuwara Eliya is on the Hatton road up to Haputale.
  assert.deepEqual(names, ["Balangoda", "Bandarawela", "Nuwara Eliya"]);
  // A wider limit, chosen by hand, takes in Kandy too.
  const wider = h.nearbyStops(P.colombo, P.haputale, candidates, { maxDetourKm: 60 }).map((s) => s.name);
  assert.ok(wider.includes("Kandy") && !wider.includes("Galle"));
});

test("nearbyStops puts overdue services first, then the nearest", () => {
  const today = new Date(2026, 9, 14);
  const stops = h.nearbyStops(
    P.colombo,
    P.jaffna,
    [
      { ...P.mannar, dueBy: "2027-07-31" },
      { ...P.vavuniya, dueBy: "2026-07-31" },
      { ...P.anuradhapura }
    ],
    { today }
  );
  assert.deepEqual(stops.map((s) => s.name), ["Vavuniya", "Mannar", "Anuradhapura"]);
  assert.equal(stops[0].overdue, true);
  assert.equal(stops[1].overdue, false);
});

test("nearbyStops skips places without a position", () => {
  assert.deepEqual(h.nearbyStops(P.colombo, P.jaffna, [{ name: "Nowhere" }, { lat: null, lng: 80 }]), []);
});

// Every order of the stops, for checking orderStops() finds the best one.
function bruteForce(start, stops, end) {
  let best = Infinity;
  const permute = (done, rest) => {
    if (!rest.length) {
      const pts = [start, ...done, ...(end ? [end] : [])];
      let km = 0;
      for (let i = 1; i < pts.length; i++) km += h.roadKm(pts[i - 1], pts[i]);
      best = Math.min(best, km);
      return;
    }
    rest.forEach((s, i) => permute([...done, s], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  permute([], stops);
  return best;
}

test("orderStops finds the shortest order (checked against every order)", () => {
  const towns = [P.vavuniya, P.galle, P.kandy, P.mannar, P.haputale, P.batticaloa, P.jaffna];
  for (const end of [null, P.colombo]) {
    const { order, km } = h.orderStops(P.colombo, towns, end);
    assert.equal(order.length, towns.length);
    assert.deepEqual(new Set(order), new Set(towns));
    assert.ok(Math.abs(km - bruteForce(P.colombo, towns, end)) < 1e-6, `end=${end && end.name}`);
  }
});

test("orderStops: Colombo to Jaffna and back calls at each northern town once, in a sensible loop", () => {
  const { order } = h.orderStops(P.colombo, [P.jaffna, P.kilinochchi, P.vavuniya, P.anuradhapura, P.mannar], P.colombo);
  const names = order.map((s) => s.name);
  // Out one side, back the other: Jaffna sits between Kilinochchi and Mannar.
  const j = names.indexOf("Jaffna");
  assert.ok(["Kilinochchi", "Mannar"].includes(names[j - 1]) && ["Kilinochchi", "Mannar"].includes(names[j + 1]), names.join(" > "));
});

test("orderStops handles more stops than the exact method (2-opt) and nothing", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ lat: 6.2 + (i % 7) * 0.45, lng: 79.9 + Math.floor(i / 7) * 0.9, name: "T" + i }));
  const { order, km } = h.orderStops(P.colombo, many, P.colombo);
  assert.equal(order.length, 14);
  assert.equal(new Set(order).size, 14);
  assert.ok(km > 0 && Number.isFinite(km));
  assert.deepEqual(h.orderStops(P.colombo, [], null), { order: [], km: 0 });
});

test("tripHours rounds to the half hour at 40 km/h", () => {
  assert.equal(h.tripHours(400), 10);
  assert.equal(h.tripHours(410), 10.5);
  assert.equal(h.tripHours(170), 4.5);
  assert.equal(h.tripHours(3), 0.5);
});

test("googleMapsTripUrl lists the stops in order, ending back at the start", () => {
  const url = new URL(h.googleMapsTripUrl(P.colombo, [P.vavuniya, P.jaffna], P.colombo));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("origin"), "6.939000,79.854000");
  assert.equal(url.searchParams.get("destination"), "6.939000,79.854000");
  assert.equal(url.searchParams.get("waypoints"), "8.759000,80.500000|9.665000,80.009000");
  assert.equal(url.searchParams.get("travelmode"), "driving");
});

test("googleMapsTripUrl without a return ends at the last stop and caps waypoints at 9", () => {
  const stops = Array.from({ length: 12 }, (_, i) => ({ lat: 7 + i * 0.1, lng: 80 }));
  const url = new URL(h.googleMapsTripUrl(P.colombo, stops, null));
  assert.equal(url.searchParams.get("destination"), "8.100000,80.000000");
  assert.equal(url.searchParams.get("waypoints").split("|").length, h.GOOGLE_MAPS_MAX_WAYPOINTS);
});

test("findPlaceInText finds the longest town name in a ticket's location", () => {
  const places = [P.colombo, P.jaffna, P.nuwaraEliya, { name: "Eliya", lat: 7, lng: 80 }, P.galle];
  assert.equal(h.findPlaceInText("Main branch, NUWARA ELIYA", places).name, "Nuwara Eliya");
  assert.equal(h.findPlaceInText("Stanley Road, Jaffna.", places).name, "Jaffna");
  assert.equal(h.findPlaceInText("Gallery Road", places), null);
  assert.equal(h.findPlaceInText("", places), null);
});

test("parseLatLng reads typed positions and Google Maps links, only in Sri Lanka", () => {
  assert.deepEqual(h.parseLatLng("6.9271, 79.8612"), { lat: 6.9271, lng: 79.8612 });
  assert.deepEqual(h.parseLatLng("https://www.google.com/maps/@6.9271,79.8612,17z"), { lat: 6.9271, lng: 79.8612 });
  assert.deepEqual(h.parseLatLng("https://maps.google.com/?q=9.6650,80.0090"), { lat: 9.665, lng: 80.009 });
  assert.equal(h.parseLatLng("51.5072, -0.1276"), null);
  assert.equal(h.parseLatLng("Colombo"), null);
});
