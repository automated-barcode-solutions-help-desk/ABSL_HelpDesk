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
    friendlyError
  };
}
