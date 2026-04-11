import type { SupabaseClient } from '@supabase/supabase-js';

/** Private bucket; paths are resolved with signed URLs in the client. */
export const EXPENSE_RECEIPTS_BUCKET = 'expense-receipts';

function extensionFromFile(file: File): string {
  const lower = file.name.toLowerCase();
  const m = lower.match(/\.(jpe?g|png|gif|webp|heic|heif)$/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  const t = file.type;
  if (t === 'image/jpeg') return 'jpg';
  if (t === 'image/png') return 'png';
  if (t === 'image/webp') return 'webp';
  if (t === 'image/gif') return 'gif';
  return 'jpg';
}

/** Stable layout for PDF/OCR: group → expense → unique file (bucket is implicit). */
export function buildExpenseReceiptObjectPath(groupId: string, expenseId: string, file: File): string {
  const ext = extensionFromFile(file);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${groupId}/${expenseId}/${id}.${ext}`;
}

export async function uploadExpenseReceiptObject(
  supabase: SupabaseClient,
  path: string,
  file: File,
): Promise<{ error?: string }> {
  const { error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) return { error: error.message };
  return {};
}

export async function removeExpenseReceiptObject(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<void> {
  if (!path) return;
  await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([path]);
}

export async function getExpenseReceiptSignedUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
  expiresInSec = 3600,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Upload then persist path (post–create-expense). Does not roll back the expense if upload fails. */
export async function persistReceiptAfterExpenseCreate(params: {
  supabase: SupabaseClient;
  accessToken: string;
  groupId: string;
  expenseId: string;
  file: File;
}): Promise<{ error?: string }> {
  const path = buildExpenseReceiptObjectPath(params.groupId, params.expenseId, params.file);
  const up = await uploadExpenseReceiptObject(params.supabase, path, params.file);
  if (up.error) return { error: up.error };
  return setExpenseReceiptPathOnServer(params.supabase, params.accessToken, params.expenseId, path);
}

export async function setExpenseReceiptPathOnServer(
  supabase: SupabaseClient,
  accessToken: string,
  expenseId: string,
  receiptPath: string | null,
): Promise<{ error?: string }> {
  const { data, error: fnError } = await supabase.functions.invoke('set-expense-receipt-path', {
    body: { expense_id: expenseId, receipt_path: receiptPath },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (fnError) {
    let msg = fnError.message;
    if (data && typeof data === 'object' && data !== null && 'error' in data) {
      const e = (data as { error?: string }).error;
      if (e) msg = e;
    }
    return { error: msg };
  }
  if (data && typeof data === 'object' && data !== null && 'error' in data && (data as { error?: string }).error) {
    return { error: String((data as { error: string }).error) };
  }
  return {};
}
