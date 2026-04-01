import type { GroupExpenseRow } from '../hooks/useGroupExpenses';

/**
 * Same rule as useGroupBalances: confirmed expense and event not in draft
 * (missing event counts as eligible, matching `ev?.status !== 'draft'`).
 */
export function isAccountingEligibleExpense(e: Pick<GroupExpenseRow, 'status' | 'event'>): boolean {
  const st = e.event?.status;
  return st !== 'draft' && e.status === 'confirmed';
}

/** Raw row from Supabase where `event` may be a single object or an array. */
export function isAccountingEligibleExpenseRow(row: {
  status?: string;
  event?: { status?: string } | { status?: string }[] | null;
}): boolean {
  const ev = Array.isArray(row.event) ? row.event[0] : row.event;
  const st = ev?.status;
  return st !== 'draft' && row.status === 'confirmed';
}
