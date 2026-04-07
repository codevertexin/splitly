import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT } from '../lib/expenseEvents';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';

type ExpenseRow = {
  group_id: string;
  amount_cents: number;
  status?: string;
  event?: { status?: string } | { status?: string }[] | null;
};

/**
 * Sum of accounting-eligible expense amounts per group (same rule as balances / "confirmed" list):
 * confirmed + not linked to a draft event.
 * Used for group list "open expenses" total.
 */
export function useGroupAccountingTotals(session: Session | null, groupIds: string[]) {
  const sortedUniqueIds = useMemo(() => [...new Set(groupIds)].sort().join('|'), [groupIds]);

  const [totalsByGroupId, setTotalsByGroupId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchTotals = useCallback(async () => {
    if (!session) {
      setTotalsByGroupId({});
      setLoading(false);
      return;
    }

    const ids = sortedUniqueIds ? sortedUniqueIds.split('|').filter(Boolean) : [];
    if (ids.length === 0) {
      setTotalsByGroupId({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('expenses')
        .select('group_id, amount_cents, status, event:events(status)')
        .in('group_id', ids)
        .is('deleted_at', null);

      if (error) throw error;

      const next: Record<string, number> = {};
      for (const id of ids) next[id] = 0;

      for (const raw of (data || []) as ExpenseRow[]) {
        if (!isAccountingEligibleExpenseRow(raw)) continue;
        const gid = raw.group_id;
        if (!gid) continue;
        next[gid] = (next[gid] ?? 0) + (raw.amount_cents || 0);
      }

      setTotalsByGroupId(next);
    } catch (e) {
      if (import.meta.env.DEV) console.error('useGroupAccountingTotals:', e);
      setTotalsByGroupId({});
    } finally {
      setLoading(false);
    }
  }, [session, sortedUniqueIds]);

  useEffect(() => {
    void fetchTotals();
  }, [fetchTotals]);

  useEffect(() => {
    const onChanged = () => void fetchTotals();
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [fetchTotals]);

  return { totalsByGroupId, loading, refetch: fetchTotals };
}
