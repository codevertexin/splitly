import type { GroupExpenseRow } from '../hooks/useGroupExpenses';

/**
 * V1 financial eligibility (balances, settlements, activity, pairwise, settlement suggestions):
 * - `expense.status === 'confirmed'`
 * - if the expense is linked to an event, that event must not be `draft` (open/closed count; no event / ungrouped counts)
 * - draft expenses never count; confirming a draft removes it from “draft” and, once confirmed + eligible event, it enters aggregates (refetch via existing hooks / `notifyExpensesChanged`).
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

/** Same rule as the two predicates above; use for array filtering to keep one code path. */
export function filterAccountingEligibleExpenses<T extends Parameters<typeof isAccountingEligibleExpenseRow>[0]>(
  rows: T[],
): T[] {
  return rows.filter((r) => isAccountingEligibleExpenseRow(r));
}

