/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
const fromEmail = Deno.env.get("FROM_EMAIL") || "ABSL Helpdesk <no-reply@mail.automatedbarcode.net>";
const portalUrl = Deno.env.get("PORTAL_URL") || "http://helpdesk.automatedbarcode.net";

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

async function sendEmail(to: string, subject: string, text: string) {
  const formattedHtml = `
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

  const fullText = `${text}\n\n---\nAccess the portal: ${portalUrl}`;

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
      html: formattedHtml
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

    return Response.json({ ok: true, processed: results.length, results, adminDigest });
  } catch (err) {
    console.error("send-notifications crashed", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
