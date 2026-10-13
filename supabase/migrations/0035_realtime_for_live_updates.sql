-- =====================================================================
-- 0035_realtime_for_live_updates.sql
--
-- The app listens for changes on tickets, ticket_comments and
-- admin_alerts so dashboards, job lists and My Job Reports refresh by
-- themselves. Supabase only sends those changes for tables in its
-- supabase_realtime publication, and these were never added - so pages
-- only updated on a manual refresh.
--
-- Adds each table if it is missing. Row security still applies to live
-- updates: every user only receives changes to rows they can already see.
--
-- Idempotent: safe to re-run.
-- =====================================================================

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No supabase_realtime publication - turn on Realtime for this project first.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['tickets', 'ticket_comments', 'admin_alerts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
