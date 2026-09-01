-- =====================================================================
-- diagnose.sql — read-only. Changes nothing. Run it any time.
--
-- Answers two questions:
--   1. Which migrations have actually taken effect?
--   2. Is there existing data that would stop 0004 from applying?
-- =====================================================================


-- 1. Which migrations are in place -------------------------------------
SELECT
  'migration status' AS check,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')                  AS policies,
  (SELECT count(*) FROM pg_trigger  WHERE tgname = 'on_auth_user_created')        AS m0002_signup_trigger,
  (SELECT count(*) FROM pg_trigger  WHERE tgname = 'guard_profile_privileges')    AS m0003_guard,
  (SELECT count(*) FROM pg_proc     WHERE proname = 'admin_review_registration')  AS m0003_review_rpc,
  (SELECT count(*) FROM pg_proc     WHERE proname = 'reassign_ticket')            AS m0004_reassign,
  (SELECT count(*) FROM pg_proc     WHERE proname = 'request_callback')           AS m0004_callback,
  (SELECT count(*) FROM pg_views    WHERE viewname = 'staff_directory')           AS m0004_staff_view,
  (SELECT count(*) FROM pg_proc     WHERE proname = 'ticket_detail')              AS m0004_detail_rpc,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'ticket_receipts') AS m0005_receipts_table,
  (SELECT count(*) FROM pg_proc     WHERE proname = 'generate_ticket_receipt')    AS m0005_receipt_trigger_fn,
  (SELECT pg_get_functiondef('public.queue_comment_notification'::regproc) LIKE '%assigned_technician_id%') AS m0006_reply_notify_fixed;
-- Expect: policies 30+, every other column 1, and m0006_reply_notify_fixed = true.
-- That last one has no separate object to count — 0006 only CREATE OR REPLACEs
-- an existing function — so the live function's own source is the only proof.
-- Expect: policies 30+, and 1 in every other column.
-- A 0 in an m0004_ column means 0004 has not applied.


-- 2. Rows that would block 0004's constraints ---------------------------
-- Every count must be 0. Anything above 0 is data written before the rule
-- existed; 0004 now repairs these automatically, so this is only here to
-- show you what it will touch.
SELECT
  'blocking rows' AS check,
  (SELECT count(*) FROM public.tickets
     WHERE priority IS NULL OR priority NOT IN ('high','medium','low'))      AS bad_priority,
  (SELECT count(*) FROM public.tickets
     WHERE title IS NULL OR char_length(trim(title)) < 3)                    AS title_too_short,
  (SELECT count(*) FROM public.tickets
     WHERE char_length(title) > 200)                                        AS title_too_long,
  (SELECT count(*) FROM public.tickets
     WHERE description IS NULL OR trim(description) = '')                    AS empty_description,
  (SELECT count(*) FROM public.tickets
     WHERE char_length(description) > 5000)                                  AS description_too_long,
  (SELECT count(*) FROM public.ticket_comments
     WHERE body IS NULL OR trim(body) = '')                                  AS empty_comment,
  (SELECT count(*) FROM public.tickets
     WHERE (location_lat IS NOT NULL AND location_lat NOT BETWEEN -90 AND 90)
        OR (location_lng IS NOT NULL AND location_lng NOT BETWEEN -180 AND 180)) AS bad_coordinates;


-- 3. Accounts and roles -------------------------------------------------
SELECT
  u.email,
  p.role,
  p.approval_status,
  (u.email_confirmed_at IS NOT NULL) AS email_verified,
  p.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY p.created_at DESC NULLS FIRST
LIMIT 25;
-- A row with a NULL role has no profile: the signup trigger from 0002 was
-- missing when that account was created. Delete the user and re-register.


-- 4. Notification queue health -----------------------------------------
SELECT status, count(*) AS count, max(attempts) AS max_attempts
FROM public.notifications
GROUP BY status
ORDER BY status;
-- Anything sitting in 'dead_letter' means the worker gave up. Usually the
-- sending domain is not verified in Resend.
