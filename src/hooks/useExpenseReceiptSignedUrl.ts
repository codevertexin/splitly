import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getExpenseReceiptSignedUrl } from '../lib/expenseReceiptStorage';

/** Resolves `expenses.receipt_path` to a short-lived signed URL for `<img src>`. */
export function useExpenseReceiptSignedUrl(receiptPath: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!receiptPath) {
      setUrl(null);
      return;
    }
    void (async () => {
      const signed = await getExpenseReceiptSignedUrl(supabase, receiptPath);
      if (!cancelled) setUrl(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [receiptPath]);

  return url;
}
