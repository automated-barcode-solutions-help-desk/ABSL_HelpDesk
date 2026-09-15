-- =====================================================================
-- 0019_audit_fixes_round3.sql
--
-- Two real defects found in a full QA pass over everything built this
-- session, neither one caught until now:
--
--   1. A resolve's receipt photo has to exist in the database before
--      change_ticket_status() will even attempt the resolution - it
--      checks for the row first. If that attempt then failed (a version
--      conflict declined via "Keep their change", or any other error),
--      the photo was left behind on a ticket that was never actually
--      resolved - silently satisfying a *later*, unrelated resolve's
--      evidence requirement with stale, unconnected proof. The uploader
--      could not clean it up themselves either: 0013 deliberately makes a
--      service_receipt attachment undeletable once real evidence needs
--      protecting, with no exception for "this one never actually backed
--      anything." discard_orphaned_receipt_attachment() is that
--      exception - narrow, self-service, and only usable while the
--      ticket genuinely is not resolved/closed yet.
--
--   2. Two staff members logging a call-in job for the exact same brand
--      new company at close to the same moment could each create their
--      own row for it - report_search() and every other lookup match
--      company names case-insensitively, but the UNIQUE constraint on
--      companies.name is case-sensitive, so "Cargills Food City" and
--      "cargills food city" were never recognised as the same company at
--      the database level. A case-insensitive unique index closes this
--      for both staff_log_ticket() and the original signup trigger,
--      which has the identical lookup-then-create shape.
--
-- Idempotent: safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. discard_orphaned_receipt_attachment()
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.discard_orphaned_receipt_attachment(p_attachment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attachment public.ticket_attachments;
  v_ticket public.tickets;
BEGIN
  SELECT * INTO v_attachment FROM public.ticket_attachments WHERE id = p_attachment_id;

  -- Already gone (or never existed) - nothing to undo.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_attachment.file_type <> 'service_receipt' THEN
    RAISE EXCEPTION 'Not a service call receipt attachment.';
  END IF;

  -- Only the person who just uploaded it can discard it - this is
  -- self-service cleanup of your own abandoned attempt, not a general
  -- delete path for anyone's receipt photo.
  IF v_attachment.uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only discard a receipt photo you uploaded yourself.';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_attachment.ticket_id;

  -- The moment a ticket is genuinely resolved (or closed), its receipt
  -- photo goes back to being permanently protected, same as always - this
  -- function only ever un-does an upload that never actually backed a
  -- real resolution.
  IF v_ticket.id IS NOT NULL AND v_ticket.status IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'This ticket has already been resolved - its receipt photo cannot be removed.';
  END IF;

  DELETE FROM public.ticket_attachments WHERE id = p_attachment_id;
END;
$$;


-- ---------------------------------------------------------------------
-- 2. Case-insensitive company names.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_lower_key ON public.companies (lower(name));
