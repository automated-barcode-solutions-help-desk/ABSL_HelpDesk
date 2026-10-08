/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const portalUrl = Deno.env.get("PORTAL_URL") || "https://helpdesk.automatedbarcode.net";

// Two ways to send, chosen by which secrets are set:
//   * Your own mail server - SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally
//     SMTP_PORT, SMTP_FROM). Used whenever those three are set.
//   * Resend - RESEND_API_KEY and FROM_EMAIL. Used otherwise.
// Switching back to Resend is just removing the SMTP secrets.
const smtpHost = Deno.env.get("SMTP_HOST") || "";
const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
const smtpUser = Deno.env.get("SMTP_USER") || "";
const smtpPass = Deno.env.get("SMTP_PASS") || "";
// The From address must be the mailbox the worker signs in as:
// automatedbarcode.net's DMARC policy rejects mail whose From doesn't match
// the server that sent and signed it.
const smtpFrom = Deno.env.get("SMTP_FROM") || `ABSL Helpdesk <${smtpUser}>`;
const useSmtp = Boolean(smtpHost && smtpUser && smtpPass);

const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const fromEmail = Deno.env.get("FROM_EMAIL") || "ABSL Helpdesk <no-reply@mail.automatedbarcode.net>";

// Optional shared secret. When set, the cron job must send it as
//   x-worker-secret: <value>
// so that nothing else can drive the mail queue.
const workerSecret = Deno.env.get("WORKER_SECRET");

const admin = createClient(supabaseUrl, serviceRoleKey);

const BATCH_SIZE = 20;
const RETRY_BASE_MINUTES = 5;

interface Notification {
  id: string;
  recipient_email: string | null;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  created_at: string;
}

interface AdminAlert {
  id: string;
  title: string;
  body: string;
  alert_type: string;
  acknowledged: boolean;
  created_at: string;
}

// The notification body is never hand-written markup - it's a technician's
// resolution notes, a rejection reason, a caller's name, straight from a
// database column a user typed into. Interpolating that raw into an HTML
// email would let a literal "<" in someone's own text break the layout, or
// worse, render as a tag/link the sender never intended. escapeHtml() is
// the exact same reasoning app.js already applies everywhere it puts user
// content into the DOM.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[char];
  });
}

// ===== SMTP client (begin) =====
// A small SMTP client: one message per connection, implicit TLS (port 465 -
// Supabase Edge Functions can't open 25 or 587), sign-in with AUTH PLAIN or
// LOGIN, a plain-text + HTML message in UTF-8. No third-party library, so
// nothing to break when the edge runtime changes. Errors name the step that
// failed and the server's reply - never the password.

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string; // "Name <address>" or "address"
  timeoutMs?: number;
}

interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const utf8 = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, "$&\r\n");
}

// Header values come from the database (ticket titles, names). No line break
// may survive into a header, or it could add headers of its own.
function oneLine(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function addressOf(mailbox: string): string {
  const match = /<([^<>]+)>/.exec(mailbox);
  return oneLine(match ? match[1] : mailbox);
}

// RFC 2047: anything beyond plain ASCII travels as UTF-8 "encoded words",
// each short enough to keep header lines within the limit.
function encodeHeader(value: string): string {
  const clean = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const chars = Array.from(clean);
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 15) {
    words.push(`=?UTF-8?B?${toBase64(utf8.encode(chars.slice(i, i + 15).join("")))}?=`);
  }
  return words.join("\r\n ");
}

function formatMailbox(mailbox: string): string {
  const address = addressOf(mailbox);
  const name = mailbox.includes("<") ? oneLine(mailbox.slice(0, mailbox.indexOf("<"))).replace(/^"|"$/g, "") : "";
  return name ? `${encodeHeader(name)} <${address}>` : `<${address}>`;
}

function buildMessage(from: string, email: OutgoingEmail): string {
  const domain = addressOf(from).split("@")[1] || "localhost";
  const boundary = `absl-${crypto.randomUUID()}`;
  const message = [
    `From: ${formatMailbox(from)}`,
    `To: <${addressOf(email.to)}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(toBase64(utf8.encode(email.text))),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(toBase64(utf8.encode(email.html))),
    `--${boundary}--`,
    ""
  ].join("\r\n");
  // A line that starts with "." would end the message early (RFC 5321 4.5.2).
  return message.replace(/^\./gm, "..");
}

class SmtpSession {
  private reader: ReadableStreamDefaultReader<string>;
  private buffered = "";

  constructor(private conn: Deno.TlsConn) {
    this.reader = conn.readable.pipeThrough(new TextDecoderStream()).getReader();
  }

  private async readLine(): Promise<string> {
    while (!this.buffered.includes("\r\n")) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("the mail server closed the connection");
      this.buffered += value;
    }
    const end = this.buffered.indexOf("\r\n");
    const line = this.buffered.slice(0, end);
    this.buffered = this.buffered.slice(end + 2);
    return line;
  }

  // One reply, which may span several "250-..." lines.
  async reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      if (!/^\d{3}([ -]|$)/.test(line)) {
        throw new Error(`unexpected reply from the mail server: ${line.slice(0, 200)}`);
      }
      lines.push(line);
      if (line[3] !== "-") return { code: Number(line.slice(0, 3)), text: lines.join(" / ") };
    }
  }

  async write(data: string): Promise<void> {
    const bytes = utf8.encode(data);
    let written = 0;
    while (written < bytes.length) written += await this.conn.write(bytes.subarray(written));
  }

  // `step` is what an error names - never the line itself, which for a
  // sign-in carries the password.
  async command(line: string, expect: number[], step = line.split(" ")[0]): Promise<{ code: number; text: string }> {
    await this.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!expect.includes(reply.code)) {
      throw new Error(`${step} refused by the mail server: ${reply.text.slice(0, 300)}`);
    }
    return reply;
  }

  async close(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // already closed
    }
    try {
      this.conn.close();
    } catch {
      // already closed
    }
  }
}

async function smtpConversation(session: SmtpSession, config: SmtpConfig, email: OutgoingEmail) {
  const greeting = await session.reply();
  if (greeting.code !== 220) throw new Error(`unexpected mail server greeting: ${greeting.text.slice(0, 300)}`);

  const sender = addressOf(config.from);
  const ehlo = await session.command(`EHLO ${sender.split("@")[1] || "localhost"}`, [250]);
  const methods = (/AUTH[ =]([^/]*)/i.exec(ehlo.text)?.[1] || "").toUpperCase();

  if (methods.includes("PLAIN") || !methods.includes("LOGIN")) {
    await session.command(
      `AUTH PLAIN ${toBase64(utf8.encode(`\0${config.user}\0${config.pass}`))}`,
      [235],
      "Sign-in"
    );
  } else {
    await session.command("AUTH LOGIN", [334], "Sign-in");
    await session.command(toBase64(utf8.encode(config.user)), [334], "Sign-in (user name)");
    await session.command(toBase64(utf8.encode(config.pass)), [235], "Sign-in (password)");
  }

  await session.command(`MAIL FROM:<${sender}>`, [250], "Sender");
  await session.command(`RCPT TO:<${addressOf(email.to)}>`, [250, 251], "Recipient");
  await session.command("DATA", [354]);
  await session.command(`${buildMessage(config.from, email)}\r\n.`, [250], "Message");
  try {
    await session.command("QUIT", [221]);
  } catch {
    // The message is already accepted.
  }
}

async function smtpSend(config: SmtpConfig, email: OutgoingEmail): Promise<void> {
  const conn = await Deno.connectTls({ hostname: config.host, port: config.port });
  const session = new SmtpSession(conn);
  const seconds = Math.round((config.timeoutMs ?? 30000) / 1000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the mail server did not answer within ${seconds}s`)), config.timeoutMs ?? 30000);
  });
  try {
    await Promise.race([smtpConversation(session, config, email), timeout]);
  } finally {
    clearTimeout(timer);
    await session.close();
  }
}
// ===== SMTP client (end) =====

function emailContent(text: string): { html: string; fullText: string } {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #1e293b; margin: 0; font-size: 20px;">ABSL Helpdesk Notification</h2>
        <span style="color: #64748b; font-size: 13px;">Automated Barcode Solutions Pvt Ltd</span>
      </div>
      <div style="color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-line; margin-bottom: 24px;">
        ${escapeHtml(text)}
      </div>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; text-align: center;">
        <a href="${portalUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-weight: bold; font-size: 14px;">
          Open ABSL Helpdesk Portal
        </a>
        <p style="margin-top: 14px; font-size: 12px; color: #94a3b8;">
          Visit: <a href="${portalUrl}" style="color: #2563eb;">${portalUrl}</a>
        </p>
      </div>
    </div>
  `;

  return { html, fullText: `${text}\n\n---\nAccess the portal: ${portalUrl}` };
}

async function sendEmail(to: string, subject: string, text: string) {
  const { html, fullText } = emailContent(text);

  if (useSmtp) {
    if (smtpPort === 25 || smtpPort === 587) {
      throw new Error(`SMTP_PORT ${smtpPort} is blocked for Supabase Edge Functions - use 465.`);
    }
    await smtpSend(
      { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: smtpFrom },
      { to, subject, text: fullText, html }
    );
    return;
  }

  if (!resendApiKey) {
    throw new Error("No email sender is set up: add SMTP_HOST, SMTP_USER and SMTP_PASS (or RESEND_API_KEY) to this function's secrets.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject,
      text: fullText,
      html
    })
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}

Deno.serve(async (request) => {
  if (workerSecret && request.headers.get("x-worker-secret") !== workerSecret) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    // claim_notifications() locks the batch with FOR UPDATE SKIP LOCKED and
    // parks next_attempt_at, so two overlapping cron runs can never pick up
    // the same row and send a customer the same email twice.
    const { data: notifications, error } = await admin.rpc("claim_notifications", {
      p_limit: BATCH_SIZE
    });

    if (error) {
      console.error("claim_notifications failed", error);
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const results: Array<{ id: string; status: string }> = [];

    for (const notification of (notifications as Notification[]) ?? []) {
      if (!notification.recipient_email) {
        await admin
          .from("notifications")
          .update({
            status: "dead_letter",
            attempts: notification.attempts + 1,
            error_message: "No recipient email on record",
            locked_at: null
          })
          .eq("id", notification.id);

        results.push({ id: notification.id, status: "dead_letter" });
        continue;
      }

      try {
        await sendEmail(notification.recipient_email, notification.subject, notification.body);

        await admin
          .from("notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: notification.attempts + 1,
            error_message: null,
            locked_at: null
          })
          .eq("id", notification.id);

        await admin.from("notification_attempts").insert({
          notification_id: notification.id,
          success: true
        });

        results.push({ id: notification.id, status: "sent" });
      } catch (sendError) {
        const attempts = notification.attempts + 1;
        const deadLetter = attempts >= notification.max_attempts;
        // Exponential backoff: 5, 10, 20, 40 minutes.
        const delayMinutes = RETRY_BASE_MINUTES * Math.pow(2, attempts - 1);
        const nextAttempt = new Date(Date.now() + delayMinutes * 60 * 1000);

        await admin
          .from("notifications")
          .update({
            status: deadLetter ? "dead_letter" : "retry",
            attempts,
            next_attempt_at: nextAttempt.toISOString(),
            error_message: String(sendError).slice(0, 1000),
            locked_at: null
          })
          .eq("id", notification.id);

        await admin.from("notification_attempts").insert({
          notification_id: notification.id,
          success: false,
          error_message: String(sendError).slice(0, 1000)
        });

        results.push({
          id: notification.id,
          status: deadLetter ? "dead_letter" : "retry"
        });
      }
    }

    // --- Dead-letter digest to admins (Diagram 19) ---------------------
    // Alerts stay visible in the admin console until a human acknowledges
    // them; digest_sent_at only records that the email went out, so the
    // worker never silently clears an unread alert.
    const adminDigest = { alertsProcessed: 0, adminNotified: 0 };

    const { data: alerts, error: alertsError } = await admin
      .from("admin_alerts")
      .select("*")
      .eq("alert_type", "dead_letter")
      .eq("acknowledged", false)
      .is("digest_sent_at", null);

    if (alertsError) {
      console.error("admin_alerts lookup failed", alertsError);
    } else if (alerts && alerts.length > 0) {
      const { data: adminProfiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, email")
        .eq("role", "admin")
        .eq("approval_status", "approved");

      if (profilesError) {
        console.error("admin profile lookup failed", profilesError);
      } else if (adminProfiles && adminProfiles.length > 0) {
        const alertList = (alerts as AdminAlert[]).map((a) => `- ${a.title}`).join("\n");
        const body = `The following failed notification alerts require your attention:\n\n${alertList}`;

        let emailsSent = 0;
        for (const adminProfile of adminProfiles) {
          if (!adminProfile.email) continue;
          try {
            await sendEmail(adminProfile.email, "ABSL Helpdesk: Failed Notification Alert", body);
            emailsSent++;
          } catch (e) {
            console.error("Failed to send admin digest to", adminProfile.email, e);
          }
        }

        if (emailsSent > 0) {
          await admin
            .from("admin_alerts")
            .update({ digest_sent_at: new Date().toISOString() })
            .in(
              "id",
              alerts.map((a) => a.id)
            );

          adminDigest.alertsProcessed = alerts.length;
          adminDigest.adminNotified = emailsSent;
        }
      }
    }

    return Response.json({ ok: true, processed: results.length, results, adminDigest, sender: useSmtp ? "smtp" : "resend" });
  } catch (err) {
    console.error("send-notifications crashed", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
