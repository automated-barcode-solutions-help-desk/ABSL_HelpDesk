/**
 * ABSL Helpdesk - automatic Google Drive backup (Google Apps Script)
 * =====================================================================
 * Runs every hour inside the helpdesk's Google account and files
 * everything into one Drive folder:
 *
 *   ABSL Helpdesk/
 *     Receipts/2026/10 - October/
 *       RCPT-... - ABSL-2026-000016 - Keells.pdf          (receipt details)
 *       RCPT-... - ABSL-2026-000016 - Keells - photo.jpg   (the photo)
 *     Job photos/2026/10 - October/ABSL-2026-000016 - Keells/
 *       2026-10-13 0942 - IMG_0001.jpg
 *     Reports/2026/
 *       Jobs report 2026-10 (October)       (Google Sheet, refreshed daily)
 *     Database backups/2026/10 - October/
 *       absl-helpdesk-backup-2026-10-13.json (every table, once a day)
 *
 * New receipts and photos arrive within the hour. The database backup
 * and the monthly reports are refreshed once a day; daily backups older
 * than KEEP_DAILY_BACKUPS days go to the Drive bin, except the one taken
 * on the 1st of each month, which is kept for good.
 *
 * Setup: GOOGLE_DRIVE_BACKUP.md. In short - paste this file into a new
 * Apps Script project in the helpdesk Google account, run setup() once,
 * copy the BACKUP_SECRET it prints into Supabase, run runBackup() once.
 *
 * Talks only to the drive-export Edge Function, with the public anon key
 * (the same one the website uses) plus BACKUP_SECRET. The service role
 * key stays inside Supabase.
 */

const SUPABASE_URL = "https://qfcieerkcrxzsorjzhjq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Zsm-bnID8HRNpV1WxkOqbQ_e54bY36B";
const ROOT_FOLDER_NAME = "ABSL Helpdesk";
const TIME_ZONE = "Asia/Colombo";
const KEEP_DAILY_BACKUPS = 35;
const BATCH = 25;
// Apps Script stops a run at 6 minutes; leave room to save progress.
const RUN_BUDGET_MS = 4.5 * 60 * 1000;

const STATUS_LABELS = {
  new: "New",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed"
};

// ---------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------

/** Run once by hand: makes the secret, the folders and the hourly timer. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("BACKUP_SECRET");
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    props.setProperty("BACKUP_SECRET", secret);
  }

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "runBackup")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("runBackup").timeBased().everyHours(1).create();

  rootFolder_();
  Logger.log("Folder ready: " + ROOT_FOLDER_NAME + " (in My Drive). Backups will run every hour.");
  Logger.log("Copy this into Supabase > Edge Functions > Secrets as BACKUP_SECRET:");
  Logger.log(secret);
}

/** The hourly job. Safe to run by hand at any time. */
function runBackup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // the previous run is still going

  const started = Date.now();
  const done = [];
  try {
    const files = syncFiles_(started);
    done.push(files.receipts + " receipt(s), " + files.photos + " photo(s)");

    if (!backupExists_(new Date())) {
      done.push(dailyBackup_());
    }

    rootFolder_().setDescription("Last backup run: " + stamp_(new Date(), "yyyy-MM-dd HH:mm") + " - " + done.join("; "));
    Logger.log(done.join("\n"));
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
// Receipts and job photos (hourly)
// ---------------------------------------------------------------------

function syncFiles_(started) {
  const props = PropertiesService.getScriptProperties();
  const count = { receipts: 0, photos: 0 };

  while (Date.now() - started < RUN_BUDGET_MS) {
    const page = callApi_({
      mode: "files",
      receiptsSince: props.getProperty("RECEIPTS_SINCE") || null,
      photosSince: props.getProperty("PHOTOS_SINCE") || null,
      limit: BATCH
    });

    for (const receipt of page.receipts) {
      if (Date.now() - started >= RUN_BUDGET_MS) return count;
      saveReceipt_(receipt);
      props.setProperty("RECEIPTS_SINCE", receipt.created_at);
      count.receipts++;
    }

    for (const photo of page.photos) {
      if (Date.now() - started >= RUN_BUDGET_MS) return count;
      savePhoto_(photo);
      props.setProperty("PHOTOS_SINCE", photo.created_at);
      count.photos++;
    }

    if (page.receipts.length < page.limit && page.photos.length < page.limit) break;
  }

  return count;
}

function saveReceipt_(r) {
  const when = new Date(r.resolved_at || r.created_at);
  const folder = folderAt_(["Receipts", stamp_(when, "yyyy"), monthName_(when)]);
  const base = safeName_([r.receipt_number, r.ticket_number, r.company_name].filter(Boolean).join(" - "));

  let photo = null;
  if (r.photo_url) {
    photo = download_(r.photo_url);
    if (photo && !fileExists_(folder, base + " - photo." + extension_(photo))) {
      folder.createFile(photo.copyBlob().setName(base + " - photo." + extension_(photo)));
    }
  }

  if (!fileExists_(folder, base + ".pdf")) {
    const html = receiptHtml_(r, photo);
    const pdf = Utilities.newBlob(html, "text/html", base + ".html").getAs("application/pdf").setName(base + ".pdf");
    folder.createFile(pdf);
  }
}

function savePhoto_(p) {
  if (!p.url) return;
  const when = new Date(p.created_at);
  const ticketFolder = safeName_([p.ticket_number || "Deleted ticket", p.company_name].filter(Boolean).join(" - "));
  const folder = folderAt_(["Job photos", stamp_(when, "yyyy"), monthName_(when), ticketFolder]);

  const photo = download_(p.url);
  if (!photo) return;
  const original = String(p.original_name || p.id).replace(/\.[^.]*$/, "");
  const name = safeName_(stamp_(when, "yyyy-MM-dd HHmm") + " - " + original) + "." + extension_(photo);
  if (!fileExists_(folder, name)) folder.createFile(photo.setName(name));
}

function receiptHtml_(r, photo) {
  const parts = Array.isArray(r.parts_used) ? r.parts_used : [];
  const row = (label, value) =>
    value ? "<tr><th>" + esc_(label) + "</th><td>" + esc_(value).replace(/\n/g, "<br>") + "</td></tr>" : "";
  const image = photo
    ? '<p><img src="data:' + photo.getContentType() + ";base64," + Utilities.base64Encode(photo.getBytes()) +
      '" style="max-width:100%;max-height:600px"></p>'
    : "";

  return (
    '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#111">' +
    "<h2>Service receipt " + esc_(r.receipt_number) + "</h2>" +
    '<table cellpadding="5" style="border-collapse:collapse">' +
    row("Ticket", r.ticket_number) +
    row("Job", r.title) +
    row("Company", r.company_name) +
    row("Customer", [r.customer_name, r.customer_email].filter(Boolean).join(" - ")) +
    row("Technician", r.technician_name) +
    row("Priority", r.priority) +
    row("Service call number", r.service_call_number) +
    row("Job raised", r.created_at_original ? stamp_(new Date(r.created_at_original), "yyyy-MM-dd HH:mm") : "") +
    row("Resolved", r.resolved_at ? stamp_(new Date(r.resolved_at), "yyyy-MM-dd HH:mm") : "") +
    row("Resolution notes", r.resolution_notes) +
    row("Parts used", parts.map((p) => (p.name || p.sku || "Part") + " x " + (p.quantity || 1)).join("\n")) +
    "</table>" +
    image +
    '<p style="color:#666">Saved from ABSL Helpdesk on ' + esc_(stamp_(new Date(), "yyyy-MM-dd HH:mm")) + "</p>" +
    "</body></html>"
  );
}

// ---------------------------------------------------------------------
// Database backup and monthly reports (daily)
// ---------------------------------------------------------------------

function dailyBackup_() {
  const now = new Date();
  const thisMonth = monthStart_(now);
  const lastMonth = monthStart_(new Date(thisMonth.getTime() - 24 * 60 * 60 * 1000));

  const result = callApi_({
    mode: "full",
    reportFrom: stamp_(lastMonth, "yyyy-MM-dd"),
    reportTo: stamp_(now, "yyyy-MM-dd")
  });

  const folder = folderAt_(["Database backups", stamp_(now, "yyyy"), monthName_(now)]);
  const name = backupName_(now);
  if (!fileExists_(folder, name)) {
    folder.createFile(Utilities.newBlob(JSON.stringify(result.backup), "application/json", name));
  }

  // Last month too, so jobs closed after the month ended are reflected.
  writeMonthReport_(lastMonth, result.report);
  writeMonthReport_(thisMonth, result.report);

  const removed = pruneBackups_(now);
  const records = Object.keys(result.backup.row_counts || {}).reduce(
    (sum, table) => sum + Number(result.backup.row_counts[table] || 0), 0);
  return "database backup (" + records + " records), reports for " + monthName_(lastMonth) + " and " +
    monthName_(thisMonth) + (removed ? ", " + removed + " old backup(s) moved to bin" : "");
}

function writeMonthReport_(monthStart, allRows) {
  const key = stamp_(monthStart, "yyyy-MM");
  const rows = allRows.filter((r) => stamp_(new Date(r.created_at), "yyyy-MM") === key);
  const name = "Jobs report " + key + " (" + stamp_(monthStart, "MMMM") + ")";
  const folder = folderAt_(["Reports", stamp_(monthStart, "yyyy")]);

  let spreadsheet;
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    spreadsheet = SpreadsheetApp.openById(existing.next().getId());
  } else {
    spreadsheet = SpreadsheetApp.create(name);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  }

  const header = [
    "Date", "Ticket", "Company", "Customer / logged by", "Caller", "Caller phone", "Job type", "Priority",
    "Status", "Technician", "Service call no.", "Installation no.", "Reference no.", "Resolved date",
    "Title", "Description", "Resolution notes", "Technician notes"
  ];
  const data = rows
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((r) => [
      stamp_(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
      r.ticket_number || "",
      r.company_name || "",
      r.customer_name || "",
      r.caller_name || "",
      r.caller_phone || "",
      r.job_type || "",
      r.priority || "",
      statusLabel_(r.status),
      r.technician_name || "Unassigned",
      r.service_call_number || "",
      r.installation_number || "",
      r.reference_number || "",
      r.resolved_at ? stamp_(new Date(r.resolved_at), "yyyy-MM-dd HH:mm") : "",
      r.title || "",
      r.description || "",
      r.resolution_notes || "",
      r.technician_notes || ""
    ]);

  const jobs = sheetNamed_(spreadsheet, "Jobs");
  jobs.clear();
  jobs.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
  // Text, not numbers or dates: Sheets would otherwise rewrite values like 0771234567.
  if (data.length) jobs.getRange(2, 1, data.length, header.length).setNumberFormat("@").setValues(data);
  jobs.setFrozenRows(1);

  const summary = sheetNamed_(spreadsheet, "Summary");
  summary.clear();
  const block = (title, counts) => [[title, "Jobs"]].concat(
    Object.keys(counts).sort().map((k) => [k, counts[k]]), [["", ""]]);
  const tally = (pick) => rows.reduce((acc, r) => {
    const k = pick(r);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const lines = [["Jobs report " + key, ""], ["Total jobs", rows.length], ["Updated", stamp_(new Date(), "yyyy-MM-dd HH:mm")], ["", ""]]
    .concat(block("By status", tally((r) => statusLabel_(r.status))))
    .concat(block("By technician", tally((r) => r.technician_name || "Unassigned")))
    .concat(block("By job type", tally((r) => r.job_type || "Not set")));
  summary.getRange(1, 1, lines.length, 2).setValues(lines);
  summary.getRange(1, 1).setFontWeight("bold");

  // A new spreadsheet starts with an empty "Sheet1".
  const blank = spreadsheet.getSheetByName("Sheet1");
  if (blank && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(blank);
}

function pruneBackups_(now) {
  const cutoff = now.getTime() - KEEP_DAILY_BACKUPS * 24 * 60 * 60 * 1000;
  const top = folderAt_(["Database backups"]);
  let removed = 0;

  const years = top.getFolders();
  while (years.hasNext()) {
    const months = years.next().getFolders();
    while (months.hasNext()) {
      const files = months.next().getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const match = /^absl-helpdesk-backup-(\d{4})-(\d{2})-(\d{2})\.json$/.exec(file.getName());
        if (!match || match[3] === "01") continue; // the 1st of each month is kept for good
        const taken = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (taken < cutoff) {
          file.setTrashed(true);
          removed++;
        }
      }
    }
  }
  return removed;
}

function backupExists_(when) {
  return fileExists_(folderAt_(["Database backups", stamp_(when, "yyyy"), monthName_(when)]), backupName_(when));
}

function backupName_(when) {
  return "absl-helpdesk-backup-" + stamp_(when, "yyyy-MM-dd") + ".json";
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function callApi_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("BACKUP_SECRET");
  if (!secret) throw new Error("Run setup() first.");

  const response = UrlFetchApp.fetch(SUPABASE_URL + "/functions/v1/drive-export", {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "x-backup-secret": secret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code === 403) throw new Error("Supabase refused the backup secret. Check BACKUP_SECRET in Supabase matches this script's.");
  if (code !== 200) throw new Error("drive-export answered " + code + ": " + text.slice(0, 300));
  const body = JSON.parse(text);
  if (!body.ok) throw new Error("drive-export: " + body.error);
  return body;
}

function download_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log("Could not download a file (" + response.getResponseCode() + ")");
    return null;
  }
  return response.getBlob();
}

let folderCache_ = {};

function rootFolder_() {
  if (folderCache_[""]) return folderCache_[""];
  const found = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
  folderCache_[""] = found.hasNext() ? found.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER_NAME);
  return folderCache_[""];
}

function folderAt_(parts) {
  let folder = rootFolder_();
  let key = "";
  for (const part of parts) {
    key += "/" + part;
    if (!folderCache_[key]) {
      const found = folder.getFoldersByName(part);
      folderCache_[key] = found.hasNext() ? found.next() : folder.createFolder(part);
    }
    folder = folderCache_[key];
  }
  return folder;
}

function fileExists_(folder, name) {
  return folder.getFilesByName(name).hasNext();
}

function sheetNamed_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function stamp_(date, pattern) {
  return Utilities.formatDate(date, TIME_ZONE, pattern);
}

function monthName_(date) {
  return stamp_(date, "MM") + " - " + stamp_(date, "MMMM");
}

function monthStart_(date) {
  const key = stamp_(date, "yyyy-MM");
  // Midday on the 1st, so the time zone can't push it into another month.
  return new Date(key + "-01T12:00:00+05:30");
}

function statusLabel_(status) {
  return STATUS_LABELS[status] || String(status || "").replace(/_/g, " ");
}

function extension_(blob) {
  const type = String(blob.getContentType() || "").toLowerCase();
  if (type.indexOf("png") >= 0) return "png";
  if (type.indexOf("webp") >= 0) return "webp";
  if (type.indexOf("heic") >= 0) return "heic";
  if (type.indexOf("heif") >= 0) return "heif";
  return "jpg";
}

function safeName_(text) {
  return String(text || "file").replace(/[\\\/:*?"<>|#%\r\n\t]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

function esc_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
