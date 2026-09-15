-- check_notifications.sql — read-only. Changes nothing. Run it any time.
--
-- Run this right after any action that should trigger an email (create a
-- ticket, reply, assign a technician, resolve, approve/reject a
-- registration). Shows what got queued, to whom, and with what content -
-- this is the part of the pipeline your app controls and can be fully
-- verified without a real inbox, even while a Resend sandbox restriction
-- or a bad sending domain stops the email from actually being delivered.
--
-- A `status` of anything but `sent` here is not necessarily your app's
-- fault - see the `error_message` column and diagnose.sql's own
-- notification queue health check for what to do next.

select recipient_email, subject, body, status, error_message, created_at
from public.notifications
order by created_at desc
limit 10;
