import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT, expensesChangedAffectsGroup } from '../lib/expenseEvents';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';

function netCents(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** True when every member net balance in the group is 0 (view has no rows → true). */
export function useGroupAllBalancesZero(groupId: string | undefined) {
  const [allZero, setAllZero] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCheck = useCallback(async () => {
    if (!groupId) {
      setAllZero(false);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: members, error: membersError } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId)
        .eq('status', 'active');
      if (membersError) throw membersError;

      const userIds = (members || []).map((m) => m.user_id);
      if (userIds.length === 0) {
        setAllZero(true);
        return;
      }

      const { data: expenses, error: expensesError } = await supabase
        .from('expenses')
        .select('id, amount_cents, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)')
        .eq('group_id', groupId)
        .is('deleted_at', null);
      if (expensesError) throw expensesError;

      const balances = new Map<string, number>();
      for (const userId of userIds) balances.set(userId, 0);

      const eligible = (expenses || []).filter((row: any) => isAccountingEligibleExpenseRow(row));

      for (const expense of eligible) {
        const payerId = expense.paid_by_user_id;
        if (balances.has(payerId)) {
          balances.set(payerId, (balances.get(payerId) || 0) + (expense.amount_cents || 0));
        }
        for (const split of expense.splits || []) {
          if (!balances.has(split.user_id)) continue;
          balances.set(split.user_id, (balances.get(split.user_id) || 0) - (split.share_cents || 0));
        }
      }

      const { data: settlements, error: settlementsError } = await supabase
        .from('settlements')
        .select('from_user_id, to_user_id, amount_cents')
        .eq('group_id', groupId)
        .is('deleted_at', null);

      if (!settlementsError && settlements?.length) {
        for (const s of settlements) {
          const amt = s.amount_cents || 0;
          if (balances.has(s.from_user_id)) {
            balances.set(s.from_user_id, (balances.get(s.from_user_id) || 0) + amt);
          }
          if (balances.has(s.to_user_id)) {
            balances.set(s.to_user_id, (balances.get(s.to_user_id) || 0) - amt);
          }
        }
      }

      const ok = Array.from(balances.values()).every((value) => Math.abs(netCents(value)) < 1);
      setAllZero(ok);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Balance check failed';
      console.error('useGroupAllBalancesZero:', msg);
      setError(msg);
      setAllZero(false);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void fetchCheck();
  }, [fetchCheck]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{ groupId?: string }>).detail;
      if (!expensesChangedAffectsGroup(detail, groupId)) return;
      void fetchCheck();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [fetchCheck, groupId]);

  return { allBalancesZero: allZero, loading, error, refetch: fetchCheck };
}
