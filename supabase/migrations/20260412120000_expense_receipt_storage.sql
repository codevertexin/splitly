-- Persisted receipt image path (object key within bucket `expense-receipts`, not a public URL).
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS receipt_path text NULL;

COMMENT ON COLUMN public.expenses.receipt_path IS
  'Storage object path within bucket expense-receipts: {group_id}/{expense_id}/{uuid}.{ext}';

-- Private bucket for expense receipt images only (signed URLs in the app).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'expense-receipts',
  'expense-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']::text[]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'expense-receipts');

-- Path layout: {group_id}/{expense_id}/{filename}
DROP POLICY IF EXISTS "expense_receipts_select_group_member" ON storage.objects;
CREATE POLICY "expense_receipts_select_group_member"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.is_group_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "expense_receipts_insert_group_member" ON storage.objects;
CREATE POLICY "expense_receipts_insert_group_member"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND public.is_group_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "expense_receipts_update_group_member" ON storage.objects;
CREATE POLICY "expense_receipts_update_group_member"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.is_group_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "expense_receipts_delete_group_member" ON storage.objects;
CREATE POLICY "expense_receipts_delete_group_member"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.is_group_member((storage.foldername(name))[1]::uuid)
  );
