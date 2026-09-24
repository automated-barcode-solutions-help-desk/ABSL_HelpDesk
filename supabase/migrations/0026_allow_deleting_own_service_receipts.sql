-- =====================================================================
-- 0026_allow_deleting_own_service_receipts.sql
--
-- Allows the user who uploaded an attachment (or an admin) to delete
-- any attachment they uploaded across all buckets (photos, voice notes,
-- videos, and service receipts).
--
-- Idempotent: safe to re-run.
-- =====================================================================

DROP POLICY IF EXISTS "Uploader or admin deletes attachment" ON public.ticket_attachments;
CREATE POLICY "Uploader or admin deletes attachment"
ON public.ticket_attachments FOR DELETE
TO authenticated
USING (
  uploaded_by = auth.uid() OR public.is_admin()
);

DROP POLICY IF EXISTS "Uploader or admin deletes ticket file" ON storage.objects;
CREATE POLICY "Uploader or admin deletes ticket file"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id IN ('ticket-photos', 'ticket-voice-notes', 'ticket-videos', 'ticket-service-receipts')
  AND (owner = auth.uid() OR public.is_admin())
);
