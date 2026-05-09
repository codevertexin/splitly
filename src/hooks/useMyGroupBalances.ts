import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT } from '../lib/expenseEvents';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';

/**
 * Saldo líquido do utilizador atual por grupo (cêntimos), em lote.
 * Mesma lógica que `useGroupBalances`: despesas elegíveis + `settlements`.
 * Positivo = a receber, negativo = a pagar.
 */
export function useMyGroupBalances(session: Session | null, groupIds: string[]) {
  const sortedKey = useMemo(() => [...new Set(groupIds)].sort().join('|'), [groupIds]);

  const [balanceByGroupId, setBalanceByGroupId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!session) {
      setBalanceByGroupId({});
      setLoading(false);
      return;
    }

    const ids = sortedKey ? sortedKey.split('|').filter(Boolean) : [];
    if (ids.length === 0) {
      setBalanceByGroupId({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const uid = session.user.id;

      const { data: expenseRows, error: expensesError } = await supabase
        .from('expenses')
        .select(
          'group_id, amount_cents, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)',
        )
        .in('group_id', ids)
        .is('deleted_at', null);

      if (expensesError) throw expensesError;

      const { data: settlementRows, error: settlementsError } = await supabase
        .from('settlements')
        .select('group_id, from_user_id, to_user_id, amount_cents')
        .in('group_id', ids)
        .is('deleted_at', null);

      if (settlementsError) throw settlementsError;

      const next: Record<string, number> = {};
      for (const id of ids) next[id] = 0;

      for (const row of expenseRows || []) {
        if (!isAccountingEligibleExpenseRow(row as any)) continue;
        const gid = (row as { group_id?: string }).group_id;
        if (!gid || next[gid] === undefined) continue;

        if ((row as { paid_by_user_id?: string }).paid_by_user_id === uid) {
          next[gid] += (row as { amount_cents?: number }).amount_cents || 0;
        }
        const splits = (row as { splits?: Array<{ user_id: string; share_cents: number }> }).splits || [];
        const mySplit = splits.find((s) => s.user_id === uid);
        next[gid] -= mySplit?.share_cents || 0;
      }

      for (const s of settlementRows || []) {
        const gid = (s as { group_id?: string }).group_id;
        if (!gid || next[gid] === undefined) continue;
        const amt = (s as { amount_cents?: number }).amount_cents || 0;
        if ((s as { from_user_id?: string }).from_user_id === uid) next[gid] += amt;
        if ((s as { to_user_id?: string }).to_user_id === uid) next[gid] -= amt;
      }

      setBalanceByGroupId(next);
    } catch (e) {
      if (import.meta.env.DEV) console.error('useMyGroupBalances:', e);
      setBalanceByGroupId({});
    } finally {
      setLoading(false);
    }
  }, [session, sortedKey]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const onChanged = () => void fetchAll();
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [fetchAll]);

  return { balanceByGroupId, loading, refetch: fetchAll };
}
