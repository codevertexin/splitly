import type { GroupExpenseRow } from '../hooks/useGroupExpenses';

/**
 * V2 / transitional financial eligibility rule:
 *
 * Preferred rule:
 * - if `affects_balances === true` => eligible
 * - if `affects_balances === false` => not eligible
 *
 * Fallback (temporary V1 compatibility):
 * - `status === 'confirmed'`
 * - if linked to an event, event must not be `draft`
 *
 * This keeps old screens/data working while V2 propagates through all reads.
 */
export function isAccountingEligibleExpense(
  e: Pick<GroupExpenseRow, 'status' | 'event'> & { affects_balances?: boolean | null }
): boolean {
  if (e.affects_balances === true) return true;
  if (e.affects_balances === false) return false;

  const st = e.event?.status;
  return st !== 'draft' && e.status === 'confirmed';
}

/** Raw row from Supabase where `event` may be a single object or an array. */
export function isAccountingEligibleExpenseRow(row: {
  status?: string;
  affects_balances?: boolean | null;
  event?: { status?: string } | { status?: string }[] | null;
}): boolean {
  if (row.affects_balances === true) return true;
  if (row.affects_balances === false) return false;

  const ev = Array.isArray(row.event) ? row.event[0] : row.event;
  const st = ev?.status;
  return st !== 'draft' && row.status === 'confirmed';
}

/** Same rule as the two predicates above; use for array filtering to keep one code path. */
export function filterAccountingEligibleExpenses<
  T extends Parameters<typeof isAccountingEligibleExpenseRow>[0]
>(
  rows: T[],
): T[] {
  return rows.filter((r) => isAccountingEligibleExpenseRow(r));
}