import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT } from '../lib/expenseEvents';

/**
 * Soma dos montantes das despesas em aberto (não apagadas) no batch/ciclo ativo de cada grupo.
 * Alinha com o total no separador Despesas para o ciclo contabilístico atual.
 */
export function useMyGroupActiveCycleExpenseTotals(session: Session | null, groupIds: string[]) {
  const sortedKey = useMemo(() => [...new Set(groupIds)].sort().join('|'), [groupIds]);

  const [totalByGroupId, setTotalByGroupId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!session) {
      setTotalByGroupId({});
      setLoading(false);
      return;
    }

    const ids = sortedKey ? sortedKey.split('|').filter(Boolean) : [];
    if (ids.length === 0) {
      setTotalByGroupId({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data: batches, error: batchesError } = await supabase
        .from('expense_batches')
        .select('id, group_id')
        .in('group_id', ids)
        .eq('is_active', true);

      if (batchesError) throw batchesError;

      const batchIds = (batches || []).map((b) => b.id as string);
      const next: Record<string, number> = {};
      for (const id of ids) next[id] = 0;

      if (batchIds.length === 0) {
        setTotalByGroupId(next);
        return;
      }

      const { data: expenses, error: expensesError } = await supabase
        .from('expenses')
        .select('group_id, amount_cents')
        .in('batch_id', batchIds)
        .is('deleted_at', null);

      if (expensesError) throw expensesError;

      for (const row of expenses || []) {
        const gid = row.group_id as string;
        if (next[gid] === undefined) continue;
        next[gid] += (row.amount_cents as number) || 0;
      }

      setTotalByGroupId(next);
    } catch (e) {
      if (import.meta.env.DEV) console.error('useMyGroupActiveCycleExpenseTotals:', e);
      const empty: Record<string, number> = {};
      for (const id of sortedKey.split('|').filter(Boolean)) empty[id] = 0;
      setTotalByGroupId(empty);
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

  return { activeCycleExpenseTotalByGroupId: totalByGroupId, loading, refetch: fetchAll };
}
