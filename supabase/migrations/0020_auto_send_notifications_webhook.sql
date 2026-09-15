-- =====================================================================
-- 0020_auto_send_notifications_webhook.sql
--
-- Every notification used to wait for the next cron tick (up to 5
-- minutes) before it was even attempted. This fires the same
-- send-notifications Edge Function immediately whenever a new
-- notification is queued, so most emails go out within seconds instead
-- of on a timer. The existing 5-minute cron (configured in the
-- Supabase dashboard - LAUNCH_CHECKLIST.md step 6) is still needed and
-- untouched: it's the retry/catch-up path for anything this instant
-- call misses (a cold function, a timed-out request). This is an
-- addition to that cron, not a replacement for it - which is also why
-- this file no longer schedules a second, competing cron job the way
-- an earlier draft of it did: running two crons against the same
-- endpoint on different schedules just doubles the load for no benefit
-- once this trigger already covers the "as soon as possible" case.
--
-- Authenticating the call:
-- send-notifications checks an x-worker-secret header against the
-- WORKER_SECRET you set with `supabase secrets set` (LAUNCH_CHECKLIST.md
-- step 6). Postgres has no access to that value on its own - it lives
-- in the Edge Function's environment, not the database - so it must be
-- stored once, separately, in Supabase Vault. It must never be hardcoded
-- into a migration file: that file is exactly the kind of thing that
-- ends up committed to git, which is the same mistake this project
-- already had to recover from once with a leaked API key.
--
-- ONE-TIME SETUP - run this yourself, with your real WORKER_SECRET
-- value, in the SQL Editor (before or after this migration, it's read
-- at call time, not creation time):
--
--   select vault.create_secret('<your WORKER_SECRET value>', 'absl_worker_secret');
--
-- Until that secret exists, the trigger below still fires safely - the
-- call just gets refused by the Edge Function's own check, exactly as
-- it would with no header at all, and the 5-minute cron keeps covering
-- everything in the meantime. Nothing breaks either way.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. Enable pg_net for asynchronous HTTP requests from Postgres.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Trigger function: calls the Edge Function immediately on insert.
CREATE OR REPLACE FUNCTION public.trigger_send_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text := 'https://qfcieerkcrxzsorjzhjq.supabase.co';
  -- Supabase's publishable key - meant to be public, already shipped to
  -- every browser via config.js. Not the same kind of value as
  -- WORKER_SECRET below, which is why only this one is safe to write
  -- directly into a migration file.
  v_anon_key text := 'sb_publishable_Zsm-bnID8HRNpV1WxkOqbQ_e54bY36B';
  v_worker_secret text;
  v_headers jsonb;
BEGIN
  -- Read-only lookup from Vault - never hardcoded, see the file header.
  -- Silently NULL (not an error) if the one-time setup above hasn't
  -- been done yet, or if the vault extension itself isn't enabled on
  -- this project.
  BEGIN
    SELECT decrypted_secret INTO v_worker_secret
    FROM vault.decrypted_secrets
    WHERE name = 'absl_worker_secret'
    LIMIT 1;
  EXCEPTION
    -- Vault schema missing entirely, no permission, or any other
    -- surprise - this lookup is best-effort and must never be the
    -- reason a notification fails to queue.
    WHEN OTHERS THEN
      v_worker_secret := NULL;
  END;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_anon_key
  );

  IF v_worker_secret IS NOT NULL AND trim(v_worker_secret) <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-worker-secret', v_worker_secret);
  END IF;

  -- Fire-and-forget: pg_net queues this asynchronously and does not
  -- block the transaction that queued the notification, same as every
  -- other net.http_post() call already in this project.
  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-notifications',
    headers := v_headers,
    body := '{}'::jsonb
  );

  RETURN NULL;
END;
$$;

-- 3. Statement-level trigger - fires once per INSERT statement, not once
--    per row, so a bulk insert doesn't wake the function up N times for
--    what claim_notifications() will process as one batch anyway.
DROP TRIGGER IF EXISTS trg_send_notifications ON public.notifications;
CREATE TRIGGER trg_send_notifications
  AFTER INSERT ON public.notifications
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_send_notifications();
