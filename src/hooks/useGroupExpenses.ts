import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { EXPENSES_CHANGED_EVENT, expensesChangedAffectsGroup, notifyExpensesChanged } from '../lib/expenseEvents';
import { filterAccountingEligibleExpenses } from '../lib/accountingExpenses';
import { buildCreateExpenseV2Payload, type ExpenseSplitMethod } from '../lib/expenseV2Payload';
import type { Expense } from '../dbAliases';

export type GroupExpenseRow = {
  id: string;
  group_id: string;
  event_id: string | null;
  title: string;
  description: string | null;
  amount_cents: number;
  currency: string;
  incurred_at: string;
  paid_by_user_id: string;
  created_by: string;
  split_method: 'equal' | 'manual' | 'percentage';
  status: 'draft' | 'confirmed';
  participant_ids?: string[] | null;
  deleted_at?: string | null;

  receipt_path?: string | null;
  receipt_filename?: string | null;
  receipt_mime_type?: string | null;
  receipt_size_bytes?: number | null;

  batch_id?: string | null;
  batch?: {
    id: string;
    title: string;
    description: string | null;
    is_active: boolean;
    closed_at: string | null;
    created_at?: string | null;
  } | null;

  profiles?: {
    full_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;

  event?: {
    id: string;
    title: string | null;
    status: string;
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;

  splits?: Array<{
    user_id: string;
    share_cents: number;
    percentage?: number | null;
  }>;
};

export type CreateExpenseInput = {
  title: string;
  description?: string | null;
  amount_cents: number;
  paid_by_user_id: string;
  participant_ids: string[];
  receipt_path?: string | null;
  receipt_filename?: string | null;
  receipt_mime_type?: string | null;
  receipt_size_bytes?: number | null;
  split_method: 'equal' | 'manual' | 'percentage' | 'settlement_aware';
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
        .select(`
          id,
          group_id,
          event_id,
          batch_id,
          title,
          description,
          amount_cents,
          currency,
          split_method,
          status,
          incurred_at,
          paid_by_user_id,
          created_by,
          affects_balances,
          receipt_path,
          receipt_filename,
          receipt_mime_type,
          receipt_size_bytes,
          created_at,
          updated_at,
          deleted_at,
          profiles!expenses_paid_by_user_id_fkey (
            full_name,
            username,
            avatar_url
          ),
          event:events (
            id,
            title,
            status,
            starts_at,
            ends_at
          ),
          batch:expense_batches!expenses_batch_id_fkey (
            id,
            title,
            description,
            is_active,
            closed_at,
            created_at
          ),
          splits:expense_splits (
            id,
            user_id,
            share_cents,
            percentage
          )
        `)
        .eq('group_id', groupId)
        .is('deleted_at', null)
        .order('incurred_at', { ascending: false });

      if (qError) throw qError;

      const rows: GroupExpenseRow[] = (data || []).map((row: any) => {
        const prof = row.profiles;
        const profile = Array.isArray(prof) ? prof[0] : prof;
        const ev = row.event;
        const event = Array.isArray(ev) ? ev[0] : ev;
        const b = row.batch;
        const batch = Array.isArray(b) ? b[0] : b;

        return {
          ...row,
          affects_balances: row.affects_balances ?? null,
          profiles: profile ?? null,
          event: event ?? null,
          batch: batch ?? null,
          splits: row.splits ?? [],
        } as GroupExpenseRow;
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
      const body = buildCreateExpenseV2Payload({
        groupId,
        eventId: null, // ligar ao contexto de evento quando este hook for reutilizado aí
        title: input.title,
        description: input.description,
        amountCents: input.amount_cents,
        paidByUserId: input.paid_by_user_id,
        participantIds: input.participant_ids,
        splitMethod: input.split_method as ExpenseSplitMethod,
        splits: input.splits,
        status: input.status,
        receiptPath: input.receipt_path ?? null,
        receiptFilename: input.receipt_filename,
        receiptMimeType: input.receipt_mime_type,
        receiptSizeBytes: input.receipt_size_bytes,
      });
      
      const { data, error: fnError } = await supabase.functions.invoke('create-expense-v2', {
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

      const createdPayload = data as { expense?: { id: string } } | null;
      const expenseId = createdPayload?.expense?.id;

      if (
        import.meta.env.DEV &&
        input.split_method === 'manual' &&
        input.splits?.length
      ) {
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
      return { success: true as const, expenseId };
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
      split_method: 'equal' | 'manual' | 'percentage' | 'settlement_aware';
      participant_ids: string[];
      splits?: Array<{ user_id: string; share_cents?: number; percentage?: number }>;
      status: 'draft' | 'confirmed';
      /** Omit to leave unchanged; `null` clears stored receipt path after storage deletes. */
      receipt_path?: string | null;
      receipt_filename?: string | null;
      receipt_mime_type?: string | null;
      receipt_size_bytes?: number | null;
    }
  ) => {
    if (!session || !groupId) {
      return { success: false as const, error: 'Missing session or group' };
    }
  
    setActionLoading(true);
  
    try {
      const body: Record<string, unknown> = {
        expense_id: expenseId,
        title: input.title,
        description: input.description,
        amount_cents: input.amount_cents,
        requested_split_method: input.split_method,
        participant_ids: input.participant_ids,
        splits: input.splits,
        status_intent: input.status,
      };
      if (Object.prototype.hasOwnProperty.call(input, 'receipt_path')) {
        body.receipt_path = input.receipt_path ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'receipt_filename')) {
        body.receipt_filename = input.receipt_filename ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'receipt_mime_type')) {
        body.receipt_mime_type = input.receipt_mime_type ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'receipt_size_bytes')) {
        body.receipt_size_bytes = input.receipt_size_bytes ?? null;
      }

      const { data, error: fnError } = await supabase.functions.invoke('update-expense-v2', {
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
  
      if (fnError) {
        throw fnError;
      }
  
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
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
