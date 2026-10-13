// Supabase Edge Function: drive-export
//
// Feeds the Google Drive backup (scripts/google-drive-backup.gs), which
// runs every hour in the helpdesk's Google account and files everything
// into Drive folders. The service role key never leaves Supabase: the
// script only holds BACKUP_SECRET, and this function hands it exactly
// what it needs.
//
// POST, with headers
//   Authorization: Bearer <anon key>   (the gateway wants a JWT)
//   x-backup-secret: <BACKUP_SECRET>
// and a JSON body, one of:
//   { "mode": "files", "receiptsSince": iso, "photosSince": iso, "limit": n }
//       New receipts and job photos since the given times, oldest first,
//       each with a one-hour download link for its photo.
//   { "mode": "full", "reportFrom": "YYYY-MM-DD", "reportTo": "YYYY-MM-DD" }
//       The full JSON backup (admin_backup, 0037/0038) and the jobs
//       report rows (report_jobs) for those dates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const backupSecret = Deno.env.get("BACKUP_SECRET") || "";
const admin = createClient(supabaseUrl, serviceRoleKey);

const LINK_SECONDS = 60 * 60;
const MAX_LIMIT = 50;
const EPOCH = "1970-01-01T00:00:00Z";

type Receipt = Record<string, unknown> & {
  created_at: string;
  receipt_photo_bucket: string | null;
  receipt_photo_path: string | null;
};

type Attachment = {
  id: string;
  ticket_id: string;
  bucket_name: string;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

// Constant-time compare, so the secret can't be guessed a character at a time.
function sameSecret(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Passed on exactly as given (once it is known to be a time): a round trip
// through Date would drop the microseconds Postgres stores, and the same
// row would then come back as "newer" on every call.
function isoOr(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  const ok = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(text);
  return ok ? text : fallback;
}

function dateOrNull(value: unknown): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
}

async function signedLink(bucket: string | null, path: string | null): Promise<string | null> {
  if (!bucket || !path) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, LINK_SECONDS);
  if (error) {
    console.error("signed link failed", bucket, path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

async function newFiles(body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), MAX_LIMIT);
  const receiptsSince = isoOr(body.receiptsSince, EPOCH);
  const photosSince = isoOr(body.photosSince, EPOCH);

  const { data: receiptRows, error: receiptError } = await admin
    .from("ticket_receipts")
    .select("*")
    .gt("created_at", receiptsSince)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (receiptError) throw receiptError;

  const receipts = [];
  for (const receipt of (receiptRows as Receipt[]) ?? []) {
    receipts.push({
      ...receipt,
      photo_url: await signedLink(receipt.receipt_photo_bucket, receipt.receipt_photo_path)
    });
  }

  const { data: photoRows, error: photoError } = await admin
    .from("ticket_attachments")
    .select("id, ticket_id, bucket_name, file_path, original_name, mime_type, file_size, created_at")
    .eq("file_type", "photo")
    .gt("created_at", photosSince)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (photoError) throw photoError;

  // Ticket number and company for each photo's folder name.
  const attachments = (photoRows as Attachment[]) ?? [];
  const ticketIds = [...new Set(attachments.map((a) => a.ticket_id))];
  const tickets = new Map<string, { ticket_number: string; company_id: string | null }>();
  const companies = new Map<string, string>();
  if (ticketIds.length) {
    const { data: ticketRows, error } = await admin
      .from("tickets")
      .select("id, ticket_number, company_id")
      .in("id", ticketIds);
    if (error) throw error;
    for (const t of ticketRows ?? []) tickets.set(t.id, t);

    const companyIds = [...new Set((ticketRows ?? []).map((t) => t.company_id).filter(Boolean))];
    if (companyIds.length) {
      const { data: companyRows, error: companyError } = await admin
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      if (companyError) throw companyError;
      for (const c of companyRows ?? []) companies.set(c.id, c.name);
    }
  }

  const photos = [];
  for (const a of attachments) {
    const ticket = tickets.get(a.ticket_id);
    photos.push({
      id: a.id,
      created_at: a.created_at,
      ticket_number: ticket?.ticket_number ?? null,
      company_name: ticket?.company_id ? companies.get(ticket.company_id) ?? null : null,
      original_name: a.original_name,
      mime_type: a.mime_type,
      file_size: a.file_size,
      url: await signedLink(a.bucket_name, a.file_path)
    });
  }

  return { receipts, photos, limit };
}

async function fullExport(body: Record<string, unknown>) {
  const { data: backup, error: backupError } = await admin.rpc("admin_backup");
  if (backupError) throw backupError;

  const { data: report, error: reportError } = await admin.rpc("report_jobs", {
    p_date_from: dateOrNull(body.reportFrom),
    p_date_to: dateOrNull(body.reportTo)
  });
  if (reportError) throw reportError;

  return { backup, report: report ?? [] };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Use POST" }, { status: 405 });
  }
  if (!sameSecret(request.headers.get("x-backup-secret") || "", backupSecret)) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.mode === "files") return Response.json({ ok: true, ...(await newFiles(body)) });
    if (body.mode === "full") return Response.json({ ok: true, ...(await fullExport(body)) });
    return Response.json({ ok: false, error: "mode must be files or full" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    console.error("drive-export failed", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
