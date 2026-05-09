import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatCurrencyCents } from '../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';
import { EXPENSES_CHANGED_EVENT } from '../lib/expenseEvents';

export interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  occurredAt: string;
  amount: string;
  type: 'debt' | 'credit';
  avatarSeed: string;
  avatarUrl: string | null;
}

export interface MyBalanceHighlight {
  amount: string;
  type: 'debt' | 'credit' | 'neutral';
  subtitle: string;
  occurredAt: string | null;
  toReceiveAmount: string;
  toPayAmount: string;
  avatarUrl: string | null;
  avatarSeed: string;
}

export interface SettlementSuggestion {
  icon: string;
  labelKey: 'groceries' | 'gas' | 'dinner';
}

export function useDashboardData(session: Session) {
  const locale =
    session.user.user_metadata?.language === 'pt-BR'
      ? 'pt-BR'
      : session.user.user_metadata?.language === 'es'
      ? 'es-ES'
      : 'pt-PT';

  const [activities, setActivities] = useState<ActivityItem[]>([]);

  const [myBalanceHighlight, setMyBalanceHighlight] =
    useState<MyBalanceHighlight>({
      amount: formatCurrencyCents(0, { locale }),
      type: 'neutral',
      subtitle: 'activityFeed.balanceNeutral',
      occurredAt: null,
      toReceiveAmount: formatCurrencyCents(0, { locale }),
      toPayAmount: formatCurrencyCents(0, { locale }),
      avatarUrl: null,
      avatarSeed: session.user.email || session.user.id,
    });

  const [suggestions] = useState<SettlementSuggestion[]>([
    { icon: '🥗', labelKey: 'groceries' },
    { icon: '⛽', labelKey: 'gas' },
    { icon: '🍔', labelKey: 'dinner' },
  ]);

  useEffect(() => {
    let mounted = true;

    const fetchRecentActivity = async () => {
      try {
        // 1. Buscar grupos do user
        const { data: memberData, error: memberError } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', session.user.id)
          .eq('status', 'active');

        if (memberError) throw memberError;

        const groupIds = (memberData || []).map((m) => m.group_id);
        if (!groupIds.length) return;

        // 2. Perfis
        const { data: groupMembers } = await supabase
          .from('group_members')
          .select('user_id, profile:profiles(full_name, avatar_url)')
          .in('group_id', groupIds)
          .eq('status', 'active');

        const profileByUserId = new Map<string, any>();
        for (const row of groupMembers || []) {
          const profile = Array.isArray(row.profile)
            ? row.profile[0]
            : row.profile;

          profileByUserId.set(row.user_id, {
            full_name: profile?.full_name ?? null,
            avatar_url: profile?.avatar_url ?? null,
          });
        }

        // 3. Expenses
        const { data: rows } = await supabase
          .from('expenses')
          .select(
            'id, amount_cents, incurred_at, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)'
          )
          .in('group_id', groupIds)
          .is('deleted_at', null)
          .order('incurred_at', { ascending: false });

        // 4. Settlements
        const { data: settlementRows } = await supabase
          .from('settlements')
          .select(
            'id, group_id, from_user_id, to_user_id, amount_cents, settled_at'
          )
          .in('group_id', groupIds)
          .is('deleted_at', null);

        // Ledger
        const ledgerByUser = new Map<
          string,
          { netCents: number; latestAt: string }
        >();

        // ---- EXPENSES ----
        for (const row of rows || []) {
          if (!isAccountingEligibleExpenseRow(row)) continue;

          const splits = row.splits || [];
          const incurredAt = row.incurred_at;

          if (row.paid_by_user_id === session.user.id) {
            for (const split of splits) {
              if (split.user_id === session.user.id) continue;

              const prev = ledgerByUser.get(split.user_id) || {
                netCents: 0,
                latestAt: incurredAt,
              };

              prev.netCents += split.share_cents;
              prev.latestAt = incurredAt;

              ledgerByUser.set(split.user_id, prev);
            }
          } else {
            const mySplit = splits.find(
              (s: any) => s.user_id === session.user.id
            );
            if (!mySplit) continue;

            const prev = ledgerByUser.get(row.paid_by_user_id) || {
              netCents: 0,
              latestAt: incurredAt,
            };

            prev.netCents -= mySplit.share_cents;
            prev.latestAt = incurredAt;

            ledgerByUser.set(row.paid_by_user_id, prev);
          }
        }

        // ---- SETTLEMENTS (CORRETO) ----
        for (const row of settlementRows || []) {
          const amt = row.amount_cents || 0;
          const ts = row.settled_at;

          if (row.from_user_id === session.user.id) {
            const prev = ledgerByUser.get(row.to_user_id) || {
              netCents: 0,
              latestAt: ts,
            };

            ledgerByUser.set(row.to_user_id, {
              netCents: prev.netCents + amt, // pagaste → melhora saldo
              latestAt: ts,
            });
          } else if (row.to_user_id === session.user.id) {
            const prev = ledgerByUser.get(row.from_user_id) || {
              netCents: 0,
              latestAt: ts,
            };

            ledgerByUser.set(row.from_user_id, {
              netCents: prev.netCents - amt, // recebeste → reduz crédito
              latestAt: ts,
            });
          }
        }

        // ---- MAPPING ----
        const mapped: ActivityItem[] = Array.from(ledgerByUser.entries())
          .filter(([, v]) => v.netCents !== 0)
          .map(([userId, v]) => {
            const profile = profileByUserId.get(userId);

            return {
              id: userId,
              title: profile?.full_name || userId,
              subtitle:
                v.netCents > 0
                  ? 'activityFeed.theyOweYou'
                  : 'activityFeed.youOweThem',
              occurredAt: v.latestAt,
              amount: formatCurrencyCents(Math.abs(v.netCents), { locale }),
              type: v.netCents > 0 ? 'credit' : 'debt',
              avatarSeed: profile?.full_name || userId,
              avatarUrl: profile?.avatar_url || null,
            };
          });

        const totalNet = Array.from(ledgerByUser.values()).reduce(
          (sum, v) => sum + v.netCents,
          0
        );

        const toReceive = Array.from(ledgerByUser.values()).reduce(
          (sum, v) => sum + (v.netCents > 0 ? v.netCents : 0),
          0
        );

        const toPay = Math.abs(
          Array.from(ledgerByUser.values()).reduce(
            (sum, v) => sum + (v.netCents < 0 ? v.netCents : 0),
            0
          )
        );

        if (mounted) {
          setActivities(mapped);

          setMyBalanceHighlight({
            amount: formatCurrencyCents(Math.abs(totalNet), { locale }),
            type:
              totalNet > 0
                ? 'credit'
                : totalNet < 0
                ? 'debt'
                : 'neutral',
            subtitle:
              totalNet > 0
                ? 'activityFeed.balancePositive'
                : totalNet < 0
                ? 'activityFeed.balanceNegative'
                : 'activityFeed.balanceNeutral',
            occurredAt: null,
            toReceiveAmount: formatCurrencyCents(toReceive, { locale }),
            toPayAmount: formatCurrencyCents(toPay, { locale }),
            avatarUrl: null,
            avatarSeed: session.user.email || session.user.id,
          });
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchRecentActivity();

    const refresh = () => fetchRecentActivity();

    window.addEventListener(EXPENSES_CHANGED_EVENT, refresh);
    window.addEventListener(
      'group-settlement-confirmed',
      refresh as EventListener
    );

    return () => {
      mounted = false;
      window.removeEventListener(EXPENSES_CHANGED_EVENT, refresh);
      window.removeEventListener(
        'group-settlement-confirmed',
        refresh as EventListener
      );
    };
  }, [session.user.id, session.user.email, locale]);

  return {
    activities,
    myBalanceHighlight,
    suggestions,
  };
}