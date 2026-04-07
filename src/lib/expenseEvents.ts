/** Dispatched after group expenses are created/updated so dashboard / lists refetch. */
export const EXPENSES_CHANGED_EVENT = 'splitly-expenses-changed';

export type ExpensesChangedDetail = { groupId?: string };

export function notifyExpensesChanged(detail?: ExpensesChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT, { detail: detail ?? {} }));
}

/** Whether a listener scoped to `groupId` should refetch (broadcast vs targeted). */
export function expensesChangedAffectsGroup(detail: ExpensesChangedDetail | undefined, groupId: string | undefined): boolean {
  if (!groupId) return false;
  const gid = detail?.groupId;
  if (gid === undefined || gid === '') return true;
  return gid === groupId;
}
