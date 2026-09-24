-- =====================================================================
-- 0023_add_operator_role.sql
--
-- New role: operator. Sits between agent and technician in the workflow -
-- the person who triages what's unassigned, logs phone-in jobs, releases
-- jobs to the technician pool, and keeps an eye on system alerts, without
-- the full admin powers of managing companies, approving registrations,
-- or promoting accounts.
--
-- This file does ONLY the enum addition. Postgres will not let a new enum
-- value be used in the same transaction that adds it - paste and run this
-- file FIRST, on its own, and wait for it to say Success before running
-- 0024_operator_role_permissions.sql, which does everything else. Running
-- them pasted together as one script will fail with something like
-- "unsafe use of new value of enum type user_role".
--
-- Idempotent: safe to re-run.
-- =====================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'operator';
