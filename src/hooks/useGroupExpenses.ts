import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT, expensesChangedAffectsGroup, notifyExpensesChanged } from '../lib/expenseEvents';
import { filterAccountingEligibleExpenses } from '../lib/accountingExpenses';
import { Expense } from '../types';

export type GroupExpenseRow = Expense & {
  profiles?: { full_name: string | null; avatar_url: string | null; username: string | null } | null;
  event?: {
    id: string;
    title: string;
    status: string;
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;
  splits?: Array<{ user_id: string; share_cents: number; percentage: number | null }> | null;
};

export type CreateExpenseInput = {
  title: string;
  amount_cents: number;
  paid_by_user_id: string;
  participant_ids: string[];
  split_method: 'equal' | 'manual' | 'percentage';
  splits?: Array<{ user_id: string; share_cents?: number; percentage?: number }>;
  /** Defaults to confirmed when omitted (matches create-expense edge function). */
  status?: 'draft' | 'confirmed';
};

export function useGroupExpenses(session: Session | null, groupId: string | undefined) {
  const [expenses, setExpenses] = useState<GroupExpenseRow[]>([]);
  const [allExpenses, setAllExpenses] = useState<GroupExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchExpenses = useCallback(async () => {
    if (!session) {
      setExpenses([]);
      setAllExpenses([]);
      setLoading(false);
      return;
    }

    if (!groupId) {
      setExpenses([]);
      setAllExpenses([]);
      setLoading(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: qError } = await supabase
        .from('expenses')
        .select(
          '*, profiles!expenses_paid_by_user_id_fkey(full_name, avatar_url, username), event:events(id, title, status, starts_at, ends_at), splits:expense_splits(user_id, share_cents, percentage)',
        )
        .eq('group_id', groupId)
        .is('deleted_at', null)
        .order('incurred_at', { ascending: false });

      if (qError) throw qError;

      const rows: GroupExpenseRow[] = (data || []).map((row: any) => {
        const prof = row.profiles;
        const profile = Array.isArray(prof) ? prof[0] : prof;
        const ev = row.event;
        const event = Array.isArray(ev) ? ev[0] : ev;
        return { ...row, profiles: profile ?? null, event: event ?? null, splits: row.splits ?? [] } as GroupExpenseRow;
      });
      setAllExpenses(rows);
      /** Accounting-only subset (balances, pairwise, “confirmed” list in group UI). Full list: `allExpenses`. */
      setExpenses(filterAccountingEligibleExpenses(rows));
    } catch (err: any) {
      console.error('useGroupExpenses fetch:', err.message);
      setError(err.message);
      setExpenses([]);
      setAllExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [session, groupId]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{ groupId?: string }>).detail;
      if (!expensesChangedAffectsGroup(detail, groupId)) return;
      void fetchExpenses();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [fetchExpenses, groupId]);

  const createExpense = async (input: CreateExpenseInput) => {
    if (!session || !groupId) {
      return { success: false as const, error: 'Missing session or group' };
    }

    setActionLoading(true);
    try {
      const body = {
        group_id: groupId,
        title: input.title.trim(),
        amount_cents: input.amount_cents,
        currency: 'EUR',
        paid_by_user_id: input.paid_by_user_id,
        participant_ids: input.participant_ids,
        split_method: input.split_method,
        splits: input.splits,
        status: input.status ?? 'confirmed',
      };
      if (import.meta.env.DEV) {
        console.log('[create-expense] payload', body);
      }

      const { data, error: fnError } = await supabase.functions.invoke('create-expense', {
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (import.meta.env.DEV) {
        console.log('[create-expense] response', data);
      }

      if (fnError) {
        let msg = fnError.message;
        if (data && typeof data === 'object' && data !== null && 'error' in data) {
          const e = (data as { error?: string }).error;
          if (e) msg = e;
        }
        throw new Error(msg);
      }
      if (data && typeof data === 'object' && data !== null && 'error' in data && (data as { error?: string }).error) {
        throw new Error(String((data as { error: string }).error));
      }

      if (
        import.meta.env.DEV &&
        input.split_method === 'manual' &&
        input.splits?.length
      ) {
        const created = data as { expense?: { id: string } } | null;
        const expenseId = created?.expense?.id;
        if (expenseId) {
          const splitsIn = input.splits.filter(
            (s): s is { user_id: string; share_cents: number } =>
              typeof s.share_cents === 'number',
          );
          const { data: persistedRow, error: persistErr } = await supabase
            .from('expenses')
            .select('split_method, splits:expense_splits(user_id, share_cents)')
            .eq('id', expenseId)
            .single();
          if (!persistErr && persistedRow) {
            const persistedMap = Object.fromEntries(
              (persistedRow.splits as Array<{ user_id: string; share_cents: number }>).map((s) => [
                s.user_id,
                s.share_cents,
              ]),
            );
            const expectedMap = Object.fromEntries(splitsIn.map((s) => [s.user_id, s.share_cents]));
            const keys = new Set([...Object.keys(persistedMap), ...Object.keys(expectedMap)]);
            let match = persistedRow.split_method === 'manual';
            for (const k of keys) {
              if ((persistedMap[k] ?? -1) !== (expectedMap[k] ?? -2)) match = false;
            }
            console.log('[create-expense] persisted vs preview splits', {
              split_method: persistedRow.split_method,
              persistedMap,
              expectedMap,
              match,
            });
          }
        }
      }

      await fetchExpenses();
      notifyExpensesChanged({ groupId });
      return { success: true as const };
    } catch (err: any) {
      const msg = err.message || 'Failed to create expense';
      return { success: false as const, error: msg };
    } finally {
      setActionLoading(false);
    }
  };

  const updateExpense = async (
    expenseId: string,
    input: {
      title: string;
      amount_cents: number;
      description: string | null;
      split_method: 'equal' | 'manual' | 'percentage';
      participant_ids: string[];
      splits?: Array<{ user_id: string; share_cents?: number; percentage?: number }>;
      status: 'draft' | 'confirmed';
    }
  ) => {
    if (!session || !groupId) {
      return { success: false as const, error: 'Missing session or group' };
    }

    setActionLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('update-expense', {
        body: {
          expense_id: expenseId,
          title: input.title,
          description: input.description,
          amount_cents: input.amount_cents,
          split_method: input.split_method,
          participant_ids: input.participant_ids,
          splits: input.splits,
          status: input.status,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (fnError) {
        let msg = fnError.message;
        if (data && typeof data === 'object' && data !== null && 'error' in data) {
          const e = (data as { error?: string }).error;
          if (e) msg = e;
        }
        throw new Error(msg);
      }
      if (data && typeof data === 'object' && data !== null && 'error' in data && (data as { error?: string }).error) {
        throw new Error(String((data as { error: string }).error));
      }

      await fetchExpenses();
      notifyExpensesChanged({ groupId });
      return { success: true as const };
    } catch (err: any) {
      return { success: false as const, error: err.message || 'Failed to update expense' };
    } finally {
      setActionLoading(false);
    }
  };

  return {
    expenses,
    allExpenses,
    loading,
    error,
    actionLoading,
    refetch: fetchExpenses,
    createExpense,
    updateExpense,
  };
}
