/* =====================================================================
   ABSL Helpdesk — pure helpers
   =====================================================================
   Everything in here is a pure function with no DOM and no network, which
   is what makes it testable. `tests/helpers.test.mjs` loads this exact
   file, so the code the browser runs is the code the tests cover.

   Loaded as a plain script before app.js, so these are globals in the
   browser and a CommonJS module under Node.
   ===================================================================== */

const UPLOAD_LIMITS = {
  photo: {
    maxBytes: 8 * 1024 * 1024,
    types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    label: "photo"
  },
  voice: {
    maxBytes: 8 * 1024 * 1024,
    types: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a", "audio/aac"],
    label: "voice note"
  },
  video: {
    maxBytes: 50 * 1024 * 1024,
    types: ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/3gpp"],
    label: "video clip"
  },
  service_receipt: {
    maxBytes: 8 * 1024 * 1024,
    types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    label: "service call receipt photo"
  }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[char];
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePriority(priority) {
  const value = String(priority || "medium").toLowerCase();
  if (value === "high") return "High";
  if (value === "low") return "Low";
  return "Medium";
}

function statusLabel(status) {
  const map = {
    new: "New",
    in_progress: "In Progress",
    resolved: "Resolved",
    closed: "Closed"
  };
  return map[status] || "New";
}

// What kind of job this is - a customer/staff choice made once at creation,
// separate from priority (how urgent) and status (how far along).
function normalizeJobType(jobType) {
  const value = String(jobType || "").toLowerCase();
  if (value === "service" || value === "installation" || value === "other") return value;
  return "fault";
}

function jobTypeLabel(jobType) {
  const map = {
    service: "Service",
    fault: "Fault",
    installation: "Installation",
    other: "Other"
  };
  return map[normalizeJobType(jobType)];
}

const JOB_TYPE_LABELS = ["Fault", "Installation", "Service", "Other"];
const JOB_STATUS_LABELS = ["New", "Assigned", "Ongoing", "Resolved", "Closed"];

/**
 * The status a report shows. "Assigned" isn't a stored status - it's a new
 * ticket that already has a technician - so it's derived here, the one
 * place every report and export takes it from.
 */
function jobStatusLabel(status, technicianId) {
  if (status === "new") return technicianId ? "Assigned" : "New";
  if (status === "in_progress") return "Ongoing";
  if (status === "resolved") return "Resolved";
  if (status === "closed") return "Closed";
  return "New";
}

/**
 * A technician's own view of a job they hold. New until they open it after
 * it was given to them, then Assigned until work starts. A job the customer
 * has closed was finished all the same, so it counts as Resolved.
 */
const MY_JOB_STATUS_LABELS = ["New", "Assigned", "Ongoing", "Resolved"];

function myJobStatusLabel(status, opened) {
  if (status === "in_progress") return "Ongoing";
  if (status === "resolved" || status === "closed") return "Resolved";
  return opened ? "Assigned" : "New";
}

function formatProblemDescription(selectedProblems, customDescription) {
  const problems = Array.isArray(selectedProblems)
    ? selectedProblems.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  const text = String(customDescription || "").trim();

  if (problems.length === 0) return text;

  const problemsSummary = `Selected Issues: ${problems.join(", ")}`;
  if (!text) return problemsSummary;

  return `${problemsSummary}\n\nAdditional Details:\n${text}`;
}


/**
 * Which statuses a role is allowed to move a ticket to. Mirrors
 * change_ticket_status() in 0003 — the database is still the authority,
 * this only stops the UI from offering a button that will be refused.
 */
function allowedStatusTransitions(role, currentStatus) {
  const all = ["new", "in_progress", "resolved", "closed"];

  if (role === "agent" || role === "operator" || role === "admin") {
    return all.filter((status) => status !== currentStatus);
  }

  if (role === "technician") {
    return ["in_progress", "resolved"].filter((status) => status !== currentStatus);
  }

  // A customer may close their own ticket and nothing else.
  return currentStatus === "closed" ? [] : ["closed"];
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A browser reports a media type with its parameters attached — MediaRecorder
 * produces "audio/webm;codecs=opus", not "audio/webm". Compare on the base
 * type only, or a recording made in the app gets rejected by the app.
 */
function baseMimeType(type) {
  return String(type || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
}

/**
 * Client-side upload gate. Storage rules are enforced by Supabase, this
 * is here so a customer on a phone finds out before a 40 MB upload.
 * Returns { ok: true } or { ok: false, message }.
 */
function validateUpload(file, kind) {
  const limit = UPLOAD_LIMITS[kind];
  if (!limit) return { ok: false, message: "Unknown attachment type." };
  if (!file || !file.size) return { ok: true, skipped: true };

  if (file.size > limit.maxBytes) {
    return {
      ok: false,
      message: `That ${limit.label} is ${formatBytes(file.size)}. The limit is ${formatBytes(limit.maxBytes)}.`
    };
  }

  const type = baseMimeType(file.type);
  if (type && !limit.types.includes(type)) {
    return {
      ok: false,
      message: `${type} is not accepted for a ${limit.label}.`
    };
  }

  return { ok: true };
}

/** Strips anything that could confuse a storage path. */
function safeFileName(name) {
  const cleaned = String(name || "file")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._]+/, "");
  return cleaned.slice(-80) || "file";
}

/** Sri Lankan mobile/landline, with or without +94. */
function isValidPhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  return /^(\+94\d{9}|0\d{9})$/.test(digits);
}

/** Strips a displayed phone number down to what a tel: link accepts. */
function telHref(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function truncate(text, max = 120) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** "3 minutes ago" — takes `now` so it can be tested without clock tricks. */
function relativeTime(value, now = Date.now()) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  return formatDateTime(value);
}

/** Free-text search across the fields an agent would actually search by. */
function matchesQuery(ticket, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;

  return [ticket.number, ticket.title, ticket.customer, ticket.company, ticket.location]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle));
}

function filterTickets(tickets, { query = "", status = "all", priority = "all" } = {}) {
  return (tickets || []).filter((ticket) => {
    if (status !== "all" && ticket.status !== status) return false;
    if (priority !== "all" && normalizePriority(ticket.priority) !== normalizePriority(priority)) {
      return false;
    }
    return matchesQuery(ticket, query);
  });
}

/** Turns a Supabase/Postgres error into something a customer can act on. */
function friendlyError(message) {
  // Accepts a string, an Error, or a Supabase error object.
  const text = String(
    (message && typeof message === "object" && (message.message || message.error_description)) ||
      message ||
      ""
  );

  if (/conflict|already updated/i.test(text)) {
    return "Someone else updated this ticket a moment ago. Reload to see their change.";
  }
  if (/insufficient stock/i.test(text)) {
    return text.replace(/^.*Insufficient stock/i, "Not enough stock");
  }
  if (/account limit reached/i.test(text)) {
    return "Your company has used all of its accounts. Ask an ABSL admin to raise the limit.";
  }
  if (/invalid login credentials/i.test(text)) {
    return "That email and password do not match.";
  }
  if (/email not confirmed/i.test(text)) {
    return "Please open the verification email we sent before signing in.";
  }
  if (/row-level security|not allowed|permitted/i.test(text)) {
    return "You do not have permission to do that.";
  }
  // Checked before the generic "account already exists" branch below - a
  // duplicate-key error isn't always about a login. Two staff logging a
  // call-in job for a brand new company at almost the same moment (see
  // staff_log_ticket()) can both lose the race to create it and hit this
  // constraint instead of the account one.
  if (/duplicate key/i.test(text) && /companies_name/i.test(text)) {
    return "That company already exists now - just search for it again and pick it from the list.";
  }
  if (/duplicate key|already registered|user already/i.test(text)) {
    return "An account already exists for that email address.";
  }
  if (/fetch|network|failed to fetch/i.test(text)) {
    return "No connection to the server. Check your internet and try again.";
  }
  if (/violates check constraint .*title/i.test(text)) {
    return "The problem summary must be between 3 and 200 characters.";
  }

  return text || "Something went wrong.";
}

/* ---------------------------------------------------------------------
   Reports: dates, periods, and Excel-style filtering/sorting.
   Dates are compared as local "YYYY-MM-DD" keys - the calendar day the
   person using the report sees - never via UTC, which would move a job
   logged just after midnight in Colombo onto the previous day.
   --------------------------------------------------------------------- */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/** "2026-10-07" for a Date (local calendar day). */
function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A "YYYY-MM-DD" key back to a local Date at midnight (not UTC). */
function dateFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** "07 October 2026" - for report titles and the generated date. */
function formatLongDate(value) {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateFromKey(value) : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** "07 Oct 2026" - for table cells. */
function formatShortDate(value) {
  const long = formatLongDate(value);
  if (!long) return "";
  const [day, month, year] = long.split(" ");
  return `${day} ${month.slice(0, 3)} ${year}`;
}

/**
 * Turns a Date Wise Report choice into an inclusive { from, to } pair of
 * date keys. Weeks run Monday to Sunday. `now` is injectable for tests.
 */
function reportPeriod(kind, { date = "", from = "", to = "" } = {}, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (kind === "today") {
    const key = localDateKey(today);
    return { from: key, to: key };
  }

  if (kind === "week") {
    const sinceMonday = (today.getDay() + 6) % 7;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { from: localDateKey(start), to: localDateKey(end) };
  }

  if (kind === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: localDateKey(start), to: localDateKey(end) };
  }

  if (kind === "single") {
    return { from: date, to: date };
  }

  return { from, to };
}

/** "07 October 2026", "01 October 2026 to 31 October 2026", "From …", "Up to …". */
function reportPeriodLabel(from, to) {
  if (from && to) return from === to ? formatLongDate(from) : `${formatLongDate(from)} to ${formatLongDate(to)}`;
  if (from) return `From ${formatLongDate(from)}`;
  if (to) return `Up to ${formatLongDate(to)}`;
  return "";
}

/** Inclusive range check on date keys; empty bounds are open. */
function dateKeyInRange(key, from, to) {
  if (!key) return !from && !to;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

/**
 * Excel-style column filters plus a free-text search. Rows look like
 * { cells: { [columnKey]: { text, dateKey } } }; filters is
 * { [columnKey]: { type: "select" | "text" | "date", value } }. A row
 * must match every active filter AND (if given) contain the search text
 * in at least one cell.
 */
function filterReportRows(rows, filters = {}, search = "") {
  const needle = String(search || "").trim().toLowerCase();
  const active = Object.entries(filters).filter(
    ([, filter]) => filter && String(filter.value ?? "").trim() !== ""
  );

  return rows.filter((row) => {
    for (const [key, filter] of active) {
      const cell = row.cells[key] || {};
      const wanted = String(filter.value).trim().toLowerCase();
      const text = String(cell.text ?? "").toLowerCase();

      if (filter.type === "select" && text !== wanted) return false;
      if (filter.type === "text" && !text.includes(wanted)) return false;
      if (filter.type === "date" && cell.dateKey !== String(filter.value).trim()) return false;
    }

    if (!needle) return true;
    return Object.values(row.cells).some((cell) => String(cell.text ?? "").toLowerCase().includes(needle));
  });
}

/**
 * Sorts by one column. Uses the cell's `sort` value when it has one (a
 * timestamp for dates) so dates sort chronologically, otherwise a natural
 * text compare ("SC-2" before "SC-10"). Blank cells always go last.
 */
function sortReportRows(rows, key, direction = "asc") {
  if (!key) return rows.slice();
  const factor = direction === "desc" ? -1 : 1;

  return rows.slice().sort((a, b) => {
    const left = a.cells[key] || {};
    const right = b.cells[key] || {};
    const x = left.sort ?? left.text ?? "";
    const y = right.sort ?? right.text ?? "";
    const xEmpty = x === "" || x === null;
    const yEmpty = y === "" || y === null;

    if (xEmpty && yEmpty) return 0;
    if (xEmpty) return 1;
    if (yEmpty) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
}

/* ---------------------------------------------------------------------
   Trip planning (Service Plan, 0039)
   ---------------------------------------------------------------------
   Free and offline: no routing service is called. Distances are straight
   lines scaled up to roughly what Sri Lankan roads add, which is plenty to
   decide which planned services are "on the way" and in what order to do
   them. The technician then opens the ordered route in Google Maps, which
   gives the real roads and drive times.
   Points are { lat, lng } in degrees. */

// Road distance is typically ~1.3-1.4x the straight line here (more in
// the hills, less on the A9). Used for every estimate below.
const ROAD_FACTOR = 1.35;
// Average driving speed for the time estimate, km/h.
const TRIP_AVERAGE_KMH = 40;
// Google Maps directions links take at most 9 stops between start and end.
const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

function isPoint(p) {
  return Boolean(p) && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

/** Straight-line distance in km. */
function haversineKm(a, b) {
  const rad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road km between two points. */
function roadKm(a, b) {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/** Extra road km to call at `point` on the way from `start` to `destination`. */
function detourKm(start, destination, point) {
  return Math.max(0, roadKm(start, point) + roadKm(point, destination) - roadKm(start, destination));
}

/**
 * How far out of the way is reasonable for this trip: 15% of its length,
 * at least 20 km and at most 80. A day trip to Haputale allows ~25 km, a
 * run to Jaffna ~60 km (Vavuniya and Kilinochchi are on the A9, but the
 * straight line from Colombo runs up the west coast).
 */
function autoDetourKm(start, destination) {
  if (!isPoint(start) || !isPoint(destination)) return 20;
  return Math.min(80, Math.max(20, Math.round(roadKm(start, destination) * 0.15)));
}

/**
 * Which candidates are worth calling at on a trip from start to
 * destination: those costing at most maxDetourKm extra (autoDetourKm() when
 * not given). Overdue ones first,
 * then the smallest detour. Candidates without a position are skipped.
 * Each result is the candidate plus { detourKm, overdue }.
 */
function nearbyStops(start, destination, candidates, { maxDetourKm = null, today = new Date() } = {}) {
  if (!isPoint(start) || !isPoint(destination)) return [];
  const limit = Number.isFinite(maxDetourKm) && maxDetourKm > 0 ? maxDetourKm : autoDetourKm(start, destination);
  const todayKey = localDateKey(today);
  return (candidates || [])
    .filter(isPoint)
    .map((c) => ({ ...c, detourKm: detourKm(start, destination, c), overdue: Boolean(c.dueBy && c.dueBy < todayKey) }))
    .filter((c) => c.detourKm <= limit)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.detourKm - b.detourKm);
}

function pathKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += roadKm(points[i - 1], points[i]);
  return total;
}

/**
 * The quickest order to visit `stops` from `start`, finishing at `end`
 * (pass null to finish at whichever stop is best). Exact for up to 11
 * stops; beyond that a nearest-neighbour route improved by 2-opt.
 * Returns { order: [stop...], km }.
 */
function orderStops(start, stops, end = null) {
  const list = (stops || []).filter(isPoint);
  const n = list.length;
  if (n === 0) return { order: [], km: end ? roadKm(start, end) : 0 };

  const legKm = (from, to) => roadKm(from, to);
  let best;

  if (n <= 11) {
    // Held-Karp: cost[mask][last] = shortest path from start through the
    // stops in mask, ending at stop `last`.
    const size = 1 << n;
    const cost = Array.from({ length: size }, () => new Float64Array(n).fill(Infinity));
    const prev = Array.from({ length: size }, () => new Int8Array(n).fill(-1));
    for (let i = 0; i < n; i++) cost[1 << i][i] = legKm(start, list[i]);
    for (let mask = 1; mask < size; mask++) {
      for (let last = 0; last < n; last++) {
        if (!(mask & (1 << last)) || cost[mask][last] === Infinity) continue;
        for (let next = 0; next < n; next++) {
          if (mask & (1 << next)) continue;
          const nextMask = mask | (1 << next);
          const c = cost[mask][last] + legKm(list[last], list[next]);
          if (c < cost[nextMask][next]) {
            cost[nextMask][next] = c;
            prev[nextMask][next] = last;
          }
        }
      }
    }
    const full = size - 1;
    let bestLast = 0;
    let bestKm = Infinity;
    for (let last = 0; last < n; last++) {
      const c = cost[full][last] + (end ? legKm(list[last], end) : 0);
      if (c < bestKm) {
        bestKm = c;
        bestLast = last;
      }
    }
    const order = [];
    let mask = full;
    let at = bestLast;
    while (at !== -1) {
      order.unshift(list[at]);
      const before = prev[mask][at];
      mask &= ~(1 << at);
      at = before;
    }
    best = { order, km: bestKm };
  } else {
    // Nearest neighbour, then 2-opt until nothing improves.
    const remaining = [...list];
    const order = [];
    let at = start;
    while (remaining.length) {
      let pick = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (legKm(at, remaining[i]) < legKm(at, remaining[pick])) pick = i;
      }
      at = remaining.splice(pick, 1)[0];
      order.push(at);
    }
    const total = (o) => pathKm([start, ...o, ...(end ? [end] : [])]);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          if (total(candidate) + 1e-9 < total(order)) {
            order.splice(0, order.length, ...candidate);
            improved = true;
          }
        }
      }
    }
    best = { order, km: total(order) };
  }

  return best;
}

/** Hours of driving for a distance, rounded to the half hour. */
function tripHours(km) {
  return Math.max(0.5, Math.round((km / TRIP_AVERAGE_KMH) * 2) / 2);
}

/**
 * A Google Maps directions link for the stops in this order. Opens the
 * Google Maps app on a phone, with turn-by-turn navigation. Waypoints past
 * Google's limit are left out (the caller warns about that).
 */
function googleMapsTripUrl(start, stops, end) {
  const fmt = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
  const all = [...(stops || [])];
  const destination = end || all.pop() || start;
  const waypoints = all.slice(0, GOOGLE_MAPS_MAX_WAYPOINTS);
  const params = new URLSearchParams({ api: "1", origin: fmt(start), destination: fmt(destination), travelmode: "driving" });
  if (waypoints.length) params.set("waypoints", waypoints.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Finds a known town in free text such as a ticket's location ("Main
 * branch, Jaffna"). The longest matching name wins, so "Nuwara Eliya"
 * beats "Eliya" and "Havelock Town" beats "Town". Returns the place or null.
 */
function findPlaceInText(text, places) {
  const haystack = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let found = null;
  for (const place of places || []) {
    const name = String(place.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (name.length < 3) continue;
    if (haystack.includes(` ${name} `) && (!found || name.length > found.name.length)) found = place;
  }
  return found;
}

/**
 * Parses a position typed or pasted by a person: "6.9271, 79.8612", or a
 * Google Maps link containing "@6.9271,79.8612" or "?q=6.9271,79.8612".
 * Only positions in Sri Lanka are accepted. Returns { lat, lng } or null.
 */
function parseLatLng(text) {
  const match = String(text || "").match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (lat < 5.5 || lat > 10.2 || lng < 79.3 || lng > 82.2) return null;
  return { lat, lng };
}

/**
 * Splits an ordered trip into days. A day ends (overnight at its last
 * stop) when the next drive plus its stop would go past maxHoursPerDay, or
 * when it already has as many stops as one Google Maps link can carry.
 * The drive back to `end` (when given) belongs to the last day, or to a
 * day of its own when it doesn't fit.
 * Returns [{ day, from, stops, to, km, driveHours, stopHours }].
 */
function splitTripIntoDays(start, order, end = null, { maxHoursPerDay = 8, stopMinutes = 45 } = {}) {
  const stopHours = stopMinutes / 60;
  const maxStops = GOOGLE_MAPS_MAX_WAYPOINTS;
  const days = [];
  let current = { from: start, stops: [], km: 0, driveHours: 0, stopHours: 0 };
  let at = start;

  for (const stop of order || []) {
    const km = roadKm(at, stop);
    const hours = km / TRIP_AVERAGE_KMH;
    const used = current.driveHours + current.stopHours;
    if (current.stops.length && (used + hours + stopHours > maxHoursPerDay || current.stops.length >= maxStops)) {
      days.push(current);
      current = { from: at, stops: [], km: 0, driveHours: 0, stopHours: 0 };
    }
    current.stops.push(stop);
    current.km += km;
    current.driveHours += hours;
    current.stopHours += stopHours;
    at = stop;
  }

  if (end) {
    const km = roadKm(at, end);
    const hours = km / TRIP_AVERAGE_KMH;
    if (current.stops.length && current.driveHours + current.stopHours + hours > maxHoursPerDay) {
      days.push(current);
      current = { from: at, stops: [], km: 0, driveHours: 0, stopHours: 0 };
    }
    current.km += km;
    current.driveHours += hours;
  }
  if (current.stops.length || end) days.push(current);

  return days.map((d, i) => ({ ...d, day: i + 1, to: i === days.length - 1 ? end : null }));
}

/**
 * The trip as plain text, for WhatsApp or SMS: each day's stops and its
 * Google Maps link. describe(stop) gives a stop's line.
 */
function tripShareText(days, { title = "Trip", describe = (s) => s.label || s.name || "" } = {}) {
  const lines = [title];
  for (const d of days) {
    const hours = tripHours(d.km) + (d.stopHours || 0);
    lines.push("", `Day ${d.day} (about ${Math.round(d.km)} km, ${Math.round(hours * 2) / 2} h)`);
    d.stops.forEach((s, i) => lines.push(`${i + 1}. ${describe(s)}`));
    if (d.to && !d.stops.length) lines.push("Drive back");
    lines.push(`Map: ${googleMapsTripUrl(d.from, d.stops, d.to)}`);
  }
  return lines.join("\n");
}

/** The August-to-July contract year a date falls in, e.g. "2026/27". */
function currentContractYear(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
}

/** "2025-26", "2025/2026", "2025 / 26" -> "2025/26"; anything else -> "". */
function normalizeContractYear(value) {
  // The second year must follow the first, so a date range such as
  // "01.08.2025-31.07.2026" isn't read as "2025/31".
  const match = String(value || "").trim().match(/^(20\d{2})\s*[/-]\s*(?:20)?(\d{2})$/);
  if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) return "";
  return `${match[1]}/${match[2]}`;
}

/**
 * A date from a spreadsheet cell: a real date, or text such as
 * "2025.11.28", "28.11.2025", "2025-11-28" or "28/11/2025".
 * Returns "YYYY-MM-DD" or "".
 */
function parseSheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const text = String(value || "").trim();
  let m = text.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/))) [, d, mo, y] = m;
  else return "";
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Site names compared loosely: case, punctuation and a leading/trailing "Seylan" ignored. */
function normalizeSiteName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^seylan\s+|\s+seylan$/g, "")
    .trim();
}

const PLAN_IMPORT_COLUMNS = {
  client: ["client", "customer", "company"],
  name: ["site", "site name", "location", "location name", "branch", "centre", "center"],
  place: ["town", "city", "place"],
  address: ["address"],
  serial: ["device serial", "serial", "serial no", "serial number", "seriyal no"],
  contactName: ["contact name", "contact person", "contact"],
  contactPhone: ["contact phone", "phone", "telephone", "mobile"],
  contractYear: ["contract year", "year"],
  visit: ["visit"],
  status: ["status"],
  doneDate: ["date done", "service date", "date"],
  serviceCall: ["service call", "service call no", "service call number"],
  dueBy: ["due by", "due date", "due"]
};

/**
 * Reads rows from a Service Plan import sheet (objects keyed by the
 * sheet's headings, in any of the spellings above) against the sites
 * already known. Nothing is saved here: the result says what an import
 * would do, for the person to check first.
 *   sites:    { client, name, siteId (existing) or null, changes, position }
 *   services: { client, name, contractYear, visit, status, doneDate, serviceCall, dueBy }
 *   warnings: [text]
 */
function parseServicePlanImport(rows, existingSites, places, { defaultClient = "" } = {}) {
  const warnings = [];
  const sites = new Map();
  const services = new Map();
  const known = new Map((existingSites || []).map((s) => [`${s.client.toLowerCase()}|${normalizeSiteName(s.name)}`, s]));

  (rows || []).forEach((raw, index) => {
    const rowNo = index + 2; // row 1 is the heading
    const cell = {};
    for (const [key, names] of Object.entries(PLAN_IMPORT_COLUMNS)) {
      const heading = Object.keys(raw).find((h) => names.includes(String(h).toLowerCase().trim()));
      const value = heading === undefined ? "" : raw[heading];
      cell[key] = value instanceof Date ? value : String(value ?? "").trim();
    }
    const client = cell.client || defaultClient;
    const name = cell.name;
    if (!client || !name) {
      if (Object.values(cell).some((v) => v)) warnings.push(`Row ${rowNo}: no client or site name, skipped.`);
      return;
    }

    const key = `${client.toLowerCase()}|${normalizeSiteName(name)}`;
    const existing = known.get(key);
    if (!sites.has(key)) {
      const changes = {};
      if (cell.address) changes.address = cell.address;
      if (cell.place) changes.place = cell.place;
      if (cell.serial) changes.device_serial = cell.serial;
      if (cell.contactName) changes.contact_name = cell.contactName;
      if (cell.contactPhone) changes.contact_phone = cell.contactPhone;
      if (existing) {
        for (const field of Object.keys(changes)) if ((existing[field] || "") === changes[field]) delete changes[field];
      }
      let position = null;
      if (!existing || changes.place) {
        const town = (places || []).find((p) => p.name.toLowerCase() === String(cell.place || "").toLowerCase()) ||
          findPlaceInText(`${cell.place} ${name}`, places);
        if (town) position = { lat: town.lat, lng: town.lng };
        else if (!existing) warnings.push(`Row ${rowNo}: no known town for "${name}" - it will have no map position until you set one.`);
      }
      sites.set(key, {
        client: existing ? existing.client : client,
        name: existing ? existing.name : name,
        siteId: existing ? existing.id : null,
        changes,
        position
      });
    }

    const contractYear = normalizeContractYear(cell.contractYear);
    if (!cell.contractYear && !cell.status && !cell.doneDate && !cell.serviceCall) return;
    if (!contractYear) {
      warnings.push(`Row ${rowNo}: contract year "${cell.contractYear}" not understood (use 2026/27), service skipped.`);
      return;
    }
    const s = String(cell.status || "").toLowerCase();
    const status = /^(done|complete|completed|yes|finished|serviced)/.test(s) ? "done"
      : /^(skip|skipped|n\/?a|not required|cancel)/.test(s) ? "skipped"
      : cell.doneDate || cell.serviceCall ? "done"
      : "pending";
    const doneDate = cell.doneDate ? parseSheetDate(cell.doneDate) : "";
    if (cell.doneDate && !doneDate) warnings.push(`Row ${rowNo}: date "${cell.doneDate}" not understood, left empty.`);
    if (status === "done" && !cell.serviceCall) warnings.push(`Row ${rowNo}: ${name} marked done without a service call number.`);
    const dueBy = cell.dueBy ? parseSheetDate(cell.dueBy) : "";
    const visit = cell.visit || "Service";
    services.set(`${key}|${contractYear}|${visit.toLowerCase()}`, {
      key,
      client,
      name,
      contractYear,
      visit,
      status,
      doneDate,
      serviceCall: String(cell.serviceCall || ""),
      dueBy
    });
  });

  return { sites: [...sites.values()], services: [...services.values()], warnings };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    UPLOAD_LIMITS,
    baseMimeType,
    escapeHtml,
    isUuid,
    localId,
    normalizePriority,
    statusLabel,
    normalizeJobType,
    jobTypeLabel,
    JOB_TYPE_LABELS,
    JOB_STATUS_LABELS,
    jobStatusLabel,
    MY_JOB_STATUS_LABELS,
    myJobStatusLabel,
    localDateKey,
    dateFromKey,
    formatLongDate,
    formatShortDate,
    reportPeriod,
    reportPeriodLabel,
    dateKeyInRange,
    filterReportRows,
    sortReportRows,
    formatProblemDescription,
    allowedStatusTransitions,
    formatBytes,
    validateUpload,
    safeFileName,
    isValidPhone,
    telHref,
    truncate,
    formatDateTime,
    relativeTime,
    matchesQuery,
    filterTickets,
    friendlyError,
    ROAD_FACTOR,
    GOOGLE_MAPS_MAX_WAYPOINTS,
    haversineKm,
    roadKm,
    detourKm,
    autoDetourKm,
    nearbyStops,
    orderStops,
    tripHours,
    googleMapsTripUrl,
    findPlaceInText,
    parseLatLng,
    splitTripIntoDays,
    tripShareText,
    currentContractYear,
    normalizeContractYear,
    parseSheetDate,
    normalizeSiteName,
    PLAN_IMPORT_COLUMNS,
    parseServicePlanImport
  };
}
