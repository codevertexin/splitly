import { useState, useEffect, useRef, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT, notifyExpensesChanged } from '../lib/expenseEvents';
import { Expense } from '../types';

export type ExpenseListRow = Expense & {
  profiles?: { full_name: string | null; avatar_url: string | null } | null;
  event?: { id: string; title: string; status: string } | null;
  splits?: Array<{ user_id: string; share_cents: number; percentage: number | null }> | null;
};

export function useExpenses(session: Session) {
  const [expenses, setExpenses] = useState<ExpenseListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fetchingRef = useRef(false);
  /** If another change fires while a fetch is in flight, run one more fetch after it completes (avoids stale list). */
  const pendingRefetchRef = useRef(false);

  const fetchExpenses = useCallback(async () => {
    if (fetchingRef.current) {
      pendingRefetchRef.current = true;
      return;
    }

    try {
      fetchingRef.current = true;
      setLoading(true);
      setError(null);

      const { data: memberData, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', session.user.id);

      if (memberError) throw memberError;

      if (memberData && memberData.length > 0) {
        const groupIds = memberData.map((m) => m.group_id);
        const { data, error: expensesError } = await supabase
          .from('expenses')
          .select('*, profiles!expenses_paid_by_user_id_fkey(*), event:events(id, title, status), splits:expense_splits(user_id, share_cents, percentage)')
          .in('group_id', groupIds)
          .order('incurred_at', { ascending: false });

        if (expensesError) throw expensesError;
        const rows: ExpenseListRow[] = (data || []).map((row: any) => {
          const prof = row.profiles;
          const profile = Array.isArray(prof) ? prof[0] : prof;
          const ev = row.event;
          const event = Array.isArray(ev) ? ev[0] : ev;
          return { ...row, profiles: profile ?? null, event: event ?? null, splits: row.splits ?? [] } as ExpenseListRow;
        });
        setExpenses(rows);
      } else {
        setExpenses([]);
      }
    } catch (err: any) {
      console.error('Error fetching expenses:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        void fetchExpenses();
      }
    }
  }, [session.user.id]);

  useEffect(() => {
    void fetchExpenses();
  }, [fetchExpenses]);

  useEffect(() => {
    const onChanged = () => {
      void fetchExpenses();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [fetchExpenses]);

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
      notifyExpensesChanged();
      return { success: true as const };
    } catch (err: any) {
      return { success: false as const, error: err.message || 'Failed to update expense' };
    } finally {
      setActionLoading(false);
    }
  };

  return {
    expenses,
    loading,
    error,
    actionLoading,
    fetchExpenses,
    updateExpense,
  };
}
