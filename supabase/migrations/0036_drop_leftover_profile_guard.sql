-- =====================================================================
-- 0036_drop_leftover_profile_guard.sql
--
-- The live database had a second guard on profiles that no migration
-- creates: prevent_profile_privilege_escalation(), added by hand early
-- on. guard_profile_privileges() (0033) already does its job and more:
--   * it covers every update, not only a user editing their own row;
--   * it is safe for pending and signed-out users, where the old check
--     compared current_role() <> 'admin' and so let NULL roles through;
--   * it lets an approved admin, or an operator inside
--     admin_review_registration(), make the changes they are allowed to.
-- Keeping both means two rules to keep in step, so the old one goes.
--
-- Idempotent: safe to re-run.
-- =====================================================================

DROP TRIGGER IF EXISTS prevent_profile_privilege_escalation ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_profile_privilege_escalation();
