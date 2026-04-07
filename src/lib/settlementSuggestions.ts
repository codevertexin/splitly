/**
 * Pairwise settlement rows implied by confirmed expenses (same logic as dashboard "Settle up").
 * Used to record cash transfers in `settlements` that offset group balances.
 */

import { isAccountingEligibleExpenseRow } from './accountingExpenses';

export type SettlementSuggestionRow = {
  key: string;
  group_id: string;
  group_name: string;
  counterparty_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  counterparty_name: string;
  direction: 'pay' | 'receive';
};

type ExpenseLike = {
  group_id: string;
  status?: string | null;
  paid_by_user_id: string;
  event?: { status?: string | null } | null;
  splits?: Array<{ user_id: string; share_cents?: number | null }> | null;
  profiles?: { full_name?: string | null } | null;
};

/**
 * @param groupId - When set, only expenses in this group are included.
 */
export function buildSettlementSuggestionsForUser(
  expenses: ExpenseLike[],
  sessionUserId: string,
  options?: {
    groupId?: string;
    groupNameById?: Map<string, string>;
    profileNamesById?: Record<string, string>;
  },
): SettlementSuggestionRow[] {
  const { groupId, groupNameById, profileNamesById = {} } = options || {};
  const pairMap = new Map<string, SettlementSuggestionRow>();
  const groupName = (gid: string) => groupNameById?.get(gid) ?? 'Group';

  for (const expense of expenses) {
    if (groupId && expense.group_id !== groupId) continue;
    if (!isAccountingEligibleExpenseRow(expense)) continue;
    const splits = expense.splits || [];
    if (expense.paid_by_user_id === sessionUserId) {
      for (const split of splits) {
        if (split.user_id === sessionUserId) continue;
        const key = `${expense.group_id}:${split.user_id}:receive`;
        const row =
          pairMap.get(key) ||
          ({
            key,
            group_id: expense.group_id,
            group_name: groupName(expense.group_id),
            counterparty_id: split.user_id,
            from_user_id: split.user_id,
            to_user_id: sessionUserId,
            amount_cents: 0,
            counterparty_name: profileNamesById[split.user_id] || split.user_id,
            direction: 'receive' as const,
          } satisfies SettlementSuggestionRow);
        row.amount_cents += split.share_cents || 0;
        pairMap.set(key, row);
      }
    } else {
      const mySplit = splits.find((s) => s.user_id === sessionUserId);
      if (!mySplit?.share_cents) continue;
      const payerName =
        expense.profiles?.full_name || profileNamesById[expense.paid_by_user_id] || expense.paid_by_user_id;
      const key = `${expense.group_id}:${expense.paid_by_user_id}:pay`;
      const row =
        pairMap.get(key) ||
        ({
          key,
          group_id: expense.group_id,
          group_name: groupName(expense.group_id),
          counterparty_id: expense.paid_by_user_id,
          from_user_id: sessionUserId,
          to_user_id: expense.paid_by_user_id,
          amount_cents: 0,
          counterparty_name: payerName,
          direction: 'pay' as const,
        } satisfies SettlementSuggestionRow);
      row.amount_cents += mySplit.share_cents;
      pairMap.set(key, row);
    }
  }

  return Array.from(pairMap.values())
    .filter((row) => row.amount_cents > 0)
    .sort((a, b) => b.amount_cents - a.amount_cents);
}
