import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';

/** Net balance for the current user in the group, in cents (EUR). Positive = you're owed, negative = you owe. */
export function useGroupBalances(session: Session | null, groupId: string | undefined) {
  const [myBalanceCents, setMyBalanceCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMyBalance = useCallback(async () => {
    if (!session) {
      setMyBalanceCents(0);
      setError(null);
      setLoading(false);
      return;
    }

    if (!groupId) {
      setMyBalanceCents(0);
      setError(null);
      setLoading(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: qError } = await supabase
        .from('expenses')
        .select('id, amount_cents, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)')
        .eq('group_id', groupId)
        .is('deleted_at', null);

      if (qError) throw qError;

      const eligible = (data || []).filter((row: any) => isAccountingEligibleExpenseRow(row));

      const paid = eligible.reduce((sum: number, row: any) => {
        if (row.paid_by_user_id !== session.user.id) return sum;
        return sum + (row.amount_cents || 0);
      }, 0);

      const owed = eligible.reduce((sum: number, row: any) => {
        const splits = row.splits || [];
        const mySplit = splits.find((s: any) => s.user_id === session.user.id);
        return sum + (mySplit?.share_cents || 0);
      }, 0);

      let balance = paid - owed;

      const { data: settlements, error: settlementsError } = await supabase
        .from('settlements')
        .select('from_user_id, to_user_id, amount_cents')
        .eq('group_id', groupId)
        .is('deleted_at', null);

      if (!settlementsError && settlements?.length) {
        const uid = session.user.id;
        for (const s of settlements) {
          const amt = s.amount_cents || 0;
          if (s.from_user_id === uid) balance += amt;
          if (s.to_user_id === uid) balance -= amt;
        }
      }

      setMyBalanceCents(balance);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load balance';
      console.error('useGroupBalances:', message);
      setError(message);
      setMyBalanceCents(0);
    } finally {
      setLoading(false);
    }
  }, [session, groupId]);

  useEffect(() => {
    void fetchMyBalance();
  }, [fetchMyBalance]);

  return { myBalanceCents, loading, error, refetch: fetchMyBalance };
}
