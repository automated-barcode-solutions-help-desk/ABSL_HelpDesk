/**
 * Unit tests for the pure helpers the app depends on.
 *
 *   node --test tests/
 *
 * These load helpers.js itself — the same file the browser loads — so a
 * passing run says something about the shipped code, not about a copy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const h = require("../helpers.js");

test("escapeHtml neutralises every HTML-significant character", () => {
  assert.equal(
    h.escapeHtml('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
  );
  assert.equal(h.escapeHtml("O'Brien & Sons"), "O&#039;Brien &amp; Sons");
  assert.equal(h.escapeHtml(null), "");
  assert.equal(h.escapeHtml(undefined), "");
  assert.equal(h.escapeHtml(0), "0");
});

test("escapeHtml blocks an attribute-breakout payload", () => {
  const payload = '" onload="steal()';
  assert.ok(!h.escapeHtml(payload).includes('"'));
});

test("isUuid accepts real ids and rejects look-alikes", () => {
  assert.ok(h.isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
  assert.ok(!h.isUuid("TCK-1234-abcd"));
  assert.ok(!h.isUuid(""));
  assert.ok(!h.isUuid(null));
  assert.ok(!h.isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c330"));
});

test("normalizePriority is case-insensitive and defaults to Medium", () => {
  assert.equal(h.normalizePriority("HIGH"), "High");
  assert.equal(h.normalizePriority("low"), "Low");
  assert.equal(h.normalizePriority("nonsense"), "Medium");
  assert.equal(h.normalizePriority(undefined), "Medium");
});

test("statusLabel covers every enum value in the database", () => {
  assert.equal(h.statusLabel("new"), "New");
  assert.equal(h.statusLabel("in_progress"), "In Progress");
  assert.equal(h.statusLabel("resolved"), "Resolved");
  assert.equal(h.statusLabel("closed"), "Closed");
});

test("jobTypeLabel covers every allowed value and defaults to Fault", () => {
  assert.equal(h.jobTypeLabel("service"), "Service");
  assert.equal(h.jobTypeLabel("fault"), "Fault");
  assert.equal(h.jobTypeLabel("installation"), "Installation");
  assert.equal(h.jobTypeLabel("other"), "Other");
  assert.equal(h.jobTypeLabel("nonsense"), "Fault");
  assert.equal(h.jobTypeLabel(undefined), "Fault");
});

test("myJobStatusLabel: New until opened, then Assigned, Ongoing, Resolved", () => {
  assert.equal(h.myJobStatusLabel("new", false), "New");
  assert.equal(h.myJobStatusLabel("new", true), "Assigned");
  assert.equal(h.myJobStatusLabel("in_progress", false), "Ongoing");
  assert.equal(h.myJobStatusLabel("in_progress", true), "Ongoing");
  assert.equal(h.myJobStatusLabel("resolved", true), "Resolved");
  // A job the customer closed was still finished by the technician.
  assert.equal(h.myJobStatusLabel("closed", true), "Resolved");
  assert.deepEqual(h.MY_JOB_STATUS_LABELS, ["New", "Assigned", "Ongoing", "Resolved"]);
});

test("jobStatusLabel derives Assigned from a new ticket with a technician", () => {
  assert.equal(h.jobStatusLabel("new", null), "New");
  assert.equal(h.jobStatusLabel("new", "tech-id"), "Assigned");
  assert.equal(h.jobStatusLabel("in_progress", "tech-id"), "Ongoing");
  assert.equal(h.jobStatusLabel("resolved", "tech-id"), "Resolved");
  assert.equal(h.jobStatusLabel("closed", null), "Closed");
});

test("formatLongDate reads date keys as local days, not UTC", () => {
  assert.equal(h.formatLongDate("2026-10-07"), "07 October 2026");
  assert.equal(h.formatLongDate(new Date(2026, 0, 1, 0, 5)), "01 January 2026");
  assert.equal(h.formatShortDate("2026-10-07"), "07 Oct 2026");
  assert.equal(h.formatLongDate("not a date"), "");
  assert.equal(h.localDateKey(new Date(2026, 9, 7, 23, 59)), "2026-10-07");
});

test("reportPeriod: today, Monday-to-Sunday weeks, whole months, single and custom", () => {
  const wednesday = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026
  assert.deepEqual(h.reportPeriod("today", {}, wednesday), { from: "2026-10-07", to: "2026-10-07" });
  assert.deepEqual(h.reportPeriod("week", {}, wednesday), { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(h.reportPeriod("week", {}, new Date(2026, 9, 11)), { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(h.reportPeriod("month", {}, wednesday), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(h.reportPeriod("month", {}, new Date(2028, 1, 10)), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(h.reportPeriod("single", { date: "2026-10-03" }, wednesday), { from: "2026-10-03", to: "2026-10-03" });
  assert.deepEqual(h.reportPeriod("custom", { from: "2026-10-01", to: "2026-10-31" }, wednesday), { from: "2026-10-01", to: "2026-10-31" });
});

test("reportPeriodLabel matches the report title format", () => {
  assert.equal(h.reportPeriodLabel("2026-10-07", "2026-10-07"), "07 October 2026");
  assert.equal(h.reportPeriodLabel("2026-10-01", "2026-10-31"), "01 October 2026 to 31 October 2026");
  assert.equal(h.reportPeriodLabel("2026-10-01", ""), "From 01 October 2026");
  assert.equal(h.reportPeriodLabel("", "2026-10-31"), "Up to 31 October 2026");
});

test("dateKeyInRange is inclusive and treats empty bounds as open", () => {
  assert.ok(h.dateKeyInRange("2026-10-01", "2026-10-01", "2026-10-31"));
  assert.ok(h.dateKeyInRange("2026-10-31", "2026-10-01", "2026-10-31"));
  assert.ok(!h.dateKeyInRange("2026-11-01", "2026-10-01", "2026-10-31"));
  assert.ok(h.dateKeyInRange("2020-01-01", "", ""));
  assert.ok(!h.dateKeyInRange("", "2026-10-01", ""));
});

function reportRow(cells) {
  return { cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, typeof v === "object" ? v : { text: v }])) };
}

test("filterReportRows combines column filters (AND) with search", () => {
  const rows = [
    reportRow({ technician: "Nimal Perera", jobType: "Fault", status: "Resolved", sc: "SC-2026-0042", date: { text: "01 Oct 2026", dateKey: "2026-10-01" } }),
    reportRow({ technician: "Nimal Perera", jobType: "Service", status: "Resolved", sc: "SC-2026-0050", date: { text: "02 Oct 2026", dateKey: "2026-10-02" } }),
    reportRow({ technician: "Kamal Silva", jobType: "Fault", status: "Ongoing", sc: "", date: { text: "02 Oct 2026", dateKey: "2026-10-02" } })
  ];

  const nimalFaults = h.filterReportRows(rows, {
    technician: { type: "select", value: "Nimal Perera" },
    jobType: { type: "select", value: "fault" }
  });
  assert.equal(nimalFaults.length, 1);
  assert.equal(nimalFaults[0].cells.sc.text, "SC-2026-0042");

  assert.equal(h.filterReportRows(rows, { sc: { type: "text", value: "2026-00" } }).length, 2);
  assert.equal(h.filterReportRows(rows, { date: { type: "date", value: "2026-10-02" } }).length, 2);
  assert.equal(h.filterReportRows(rows, {}, "kamal").length, 1);
  assert.equal(h.filterReportRows(rows, { technician: { type: "select", value: "Nimal Perera" } }, "kamal").length, 0);
  assert.equal(h.filterReportRows(rows, { technician: { type: "select", value: "" } }).length, 3);
});

test("sortReportRows: chronological dates, natural text, blanks last", () => {
  const rows = [
    reportRow({ date: { text: "b", sort: 200 }, sc: "SC-10" }),
    reportRow({ date: { text: "", sort: "" }, sc: "" }),
    reportRow({ date: { text: "a", sort: 100 }, sc: "SC-2" })
  ];

  assert.deepEqual(h.sortReportRows(rows, "date", "asc").map((r) => r.cells.date.sort), [100, 200, ""]);
  assert.deepEqual(h.sortReportRows(rows, "date", "desc").map((r) => r.cells.date.sort), [200, 100, ""]);
  assert.deepEqual(h.sortReportRows(rows, "sc", "asc").map((r) => r.cells.sc.text), ["SC-2", "SC-10", ""]);
  assert.equal(h.sortReportRows(rows, "", "asc")[0], rows[0]);
});

test("a customer may only close their own ticket", () => {
  assert.deepEqual(h.allowedStatusTransitions("customer", "new"), ["closed"]);
  assert.deepEqual(h.allowedStatusTransitions("customer", "closed"), []);
});

test("an agent may move a ticket anywhere except where it already is", () => {
  const next = h.allowedStatusTransitions("agent", "in_progress");
  assert.ok(!next.includes("in_progress"));
  assert.deepEqual(next, ["new", "resolved", "closed"]);
});

test("a technician may progress and resolve, never close", () => {
  assert.deepEqual(h.allowedStatusTransitions("technician", "new"), ["in_progress", "resolved"]);
  assert.ok(!h.allowedStatusTransitions("technician", "resolved").includes("closed"));
});

test("validateUpload rejects an oversized photo", () => {
  const result = h.validateUpload({ size: 20 * 1024 * 1024, type: "image/jpeg" }, "photo");
  assert.equal(result.ok, false);
  assert.match(result.message, /limit is/);
});

test("validateUpload rejects an executable pretending to be a photo", () => {
  const result = h.validateUpload({ size: 1024, type: "application/x-msdownload" }, "photo");
  assert.equal(result.ok, false);
});

test("validateUpload accepts a normal phone video and rejects an oversized one", () => {
  assert.equal(h.validateUpload({ size: 20 * 1024 * 1024, type: "video/mp4" }, "video").ok, true);
  const result = h.validateUpload({ size: 80 * 1024 * 1024, type: "video/mp4" }, "video");
  assert.equal(result.ok, false);
  assert.match(result.message, /limit is/);
});

test("validateUpload accepts an iPhone .mov video clip", () => {
  assert.equal(h.validateUpload({ size: 15 * 1024 * 1024, type: "video/quicktime" }, "video").ok, true);
});

test("validateUpload accepts a normal phone photo and a webm voice note", () => {
  assert.equal(h.validateUpload({ size: 2 * 1024 * 1024, type: "image/jpeg" }, "photo").ok, true);
  assert.equal(h.validateUpload({ size: 300 * 1024, type: "audio/webm" }, "voice").ok, true);
});

test("validateUpload accepts a service call receipt photo and rejects a PDF", () => {
  assert.equal(h.validateUpload({ size: 1.5 * 1024 * 1024, type: "image/jpeg" }, "service_receipt").ok, true);
  assert.equal(h.validateUpload({ size: 500 * 1024, type: "application/pdf" }, "service_receipt").ok, false);
});

// Regression: MediaRecorder reports the codec as a parameter on the media
// type, so a recording made inside the app was being rejected by the app.
test("validateUpload accepts what MediaRecorder actually produces", () => {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm; codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "AUDIO/WEBM;CODECS=OPUS"
  ]) {
    assert.equal(h.validateUpload({ size: 200 * 1024, type }, "voice").ok, true, type);
  }
});

test("baseMimeType strips parameters and normalises case", () => {
  assert.equal(h.baseMimeType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(h.baseMimeType("IMAGE/JPEG"), "image/jpeg");
  assert.equal(h.baseMimeType(" image/png ; x=1"), "image/png");
  assert.equal(h.baseMimeType(""), "");
  assert.equal(h.baseMimeType(undefined), "");
});

test("stripping parameters does not let a disallowed type through", () => {
  assert.equal(h.validateUpload({ size: 1024, type: "video/mp4;codecs=avc1" }, "voice").ok, false);
});

test("validateUpload treats an empty file input as nothing to do", () => {
  const result = h.validateUpload({ size: 0, type: "" }, "photo");
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("safeFileName strips path traversal and exotic characters", () => {
  assert.ok(!h.safeFileName("../../etc/passwd").includes("/"));
  assert.ok(!h.safeFileName("../../etc/passwd").includes(".."));
  assert.equal(h.safeFileName("my photo (1).jpg"), "my_photo_1_.jpg");
  assert.equal(h.safeFileName(""), "file");
});

test("safeFileName keeps names short enough for a storage key", () => {
  assert.ok(h.safeFileName("a".repeat(300) + ".jpg").length <= 80);
});

test("formatBytes reads the way a person would say it", () => {
  assert.equal(h.formatBytes(512), "512 B");
  assert.equal(h.formatBytes(2048), "2 KB");
  assert.equal(h.formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(h.formatBytes(-1), "");
});

test("isValidPhone accepts local and international Sri Lankan numbers", () => {
  assert.ok(h.isValidPhone("0771234567"));
  assert.ok(h.isValidPhone("+94771234567"));
  assert.ok(h.isValidPhone("077 123 4567"));
  assert.ok(!h.isValidPhone("12345"));
  assert.ok(!h.isValidPhone(""));
});

test("relativeTime describes recent events in words", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  assert.equal(h.relativeTime("2026-08-22T11:59:40Z", now), "just now");
  assert.equal(h.relativeTime("2026-08-22T11:30:00Z", now), "30 minutes ago");
  assert.equal(h.relativeTime("2026-08-22T09:00:00Z", now), "3 hours ago");
  assert.equal(h.relativeTime("2026-08-20T12:00:00Z", now), "2 days ago");
  assert.equal(h.relativeTime("", now), "");
});

test("relativeTime says 'minute' not 'minutes' for one", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  assert.equal(h.relativeTime("2026-08-22T11:59:00Z", now), "1 minute ago");
});

const sampleTickets = [
  { number: "ABSL-2026-000001", title: "Scanner not reading", status: "new", priority: "high", company: "Cargills", location: "Colombo" },
  { number: "ABSL-2026-000002", title: "Printer jam", status: "closed", priority: "low", company: "Keells", location: "Kandy" },
  { number: "ABSL-2026-000003", title: "Label misprint", status: "new", priority: "medium", company: "Cargills", location: "Galle" }
];

test("search matches ticket number, title, company and location", () => {
  assert.equal(h.filterTickets(sampleTickets, { query: "000002" }).length, 1);
  assert.equal(h.filterTickets(sampleTickets, { query: "scanner" }).length, 1);
  assert.equal(h.filterTickets(sampleTickets, { query: "cargills" }).length, 2);
  assert.equal(h.filterTickets(sampleTickets, { query: "kandy" }).length, 1);
});

test("search is case-insensitive and ignores surrounding spaces", () => {
  assert.equal(h.filterTickets(sampleTickets, { query: "  PRINTER  " }).length, 1);
});

test("filters combine", () => {
  assert.equal(h.filterTickets(sampleTickets, { status: "new" }).length, 2);
  assert.equal(h.filterTickets(sampleTickets, { status: "new", priority: "high" }).length, 1);
  assert.equal(h.filterTickets(sampleTickets, {}).length, 3);
});

test("friendlyError rewrites the errors a customer can actually hit", () => {
  assert.match(h.friendlyError("Conflict: ticket was already updated by another user"), /Reload/);
  assert.match(h.friendlyError("Invalid login credentials"), /do not match/);
  assert.match(h.friendlyError("Email not confirmed"), /verification email/);
  assert.match(h.friendlyError("new row violates row-level security policy"), /permission/);
  assert.match(h.friendlyError("Company account limit reached."), /raise the limit/);
  assert.match(h.friendlyError("TypeError: Failed to fetch"), /connection/);
  assert.match(
    h.friendlyError('duplicate key value violates unique constraint "companies_name_lower_key"'),
    /company already exists/
  );
  assert.match(h.friendlyError("duplicate key value violates unique constraint \"users_email_key\""), /account already exists/);
});

test("friendlyError passes an unknown message through rather than hiding it", () => {
  assert.equal(h.friendlyError("some new database error"), "some new database error");
  assert.equal(h.friendlyError(""), "Something went wrong.");
  assert.equal(h.friendlyError(null), "Something went wrong.");
});

test("friendlyError unwraps Error objects and Supabase error shapes", () => {
  assert.match(h.friendlyError(new Error("Invalid login credentials")), /do not match/);
  assert.match(h.friendlyError({ message: "Email not confirmed" }), /verification email/);
  assert.equal(h.friendlyError({ message: "plain" }), "plain");
});

test("truncate keeps short strings untouched", () => {
  assert.equal(h.truncate("short", 10), "short");
  assert.equal(h.truncate("a".repeat(20), 10).length, 10);
});

test("formatProblemDescription formats selected common problems and custom details", () => {
  assert.equal(
    h.formatProblemDescription(["Sensor is not working", "Power issue"], "Machine turns off randomly"),
    "Selected Issues: Sensor is not working, Power issue\n\nAdditional Details:\nMachine turns off randomly"
  );
  assert.equal(
    h.formatProblemDescription(["Display issue"], ""),
    "Selected Issues: Display issue"
  );
  assert.equal(
    h.formatProblemDescription([], "Keypad stuck on enter"),
    "Keypad stuck on enter"
  );
});

