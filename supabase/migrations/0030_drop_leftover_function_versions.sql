-- =====================================================================
-- 0030_drop_leftover_function_versions.sql
--
-- Older versions of three functions were still in the live database
-- alongside the current ones - at least report_search's 4- and
-- 7-argument versions, which 0016 and 0018 drop. They came back because
-- an older migration was re-run after the newer one that removed them.
--
-- The app never reaches them (it always passes every argument of the
-- current version, and the API refuses calls that match more than one
-- version), but they carry old rules, so they go. Each line below is a
-- DROP an earlier migration already made; any that is already gone is
-- skipped.
--
-- Current versions are untouched:
--   change_ticket_status(uuid, ticket_status, integer, text, text)   0011
--   report_search(text, text, date, date, text, text, uuid, text)    0018
--   staff_log_ticket(text x9, boolean, boolean)                      0029
--
-- Idempotent: safe to re-run.
-- =====================================================================

DROP FUNCTION IF EXISTS public.change_ticket_status(uuid, public.ticket_status, integer);
DROP FUNCTION IF EXISTS public.change_ticket_status(uuid, public.ticket_status, integer, text);

DROP FUNCTION IF EXISTS public.report_search(text, text, date, date);
DROP FUNCTION IF EXISTS public.report_search(text, text, date, date, text, text, uuid);

DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.staff_log_ticket(text, text, text, text, text, text, text, text, text, boolean);
