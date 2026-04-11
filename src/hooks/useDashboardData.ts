import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatCurrencyCents } from '../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../lib/accountingExpenses';
import { EXPENSES_CHANGED_EVENT } from '../lib/expenseEvents';

export interface ActivityItem {
  id: string;
  title: string; // participant name
  subtitle: string; // relation label
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
  const [summary, setSummary] = useState({
    totalExpenses: formatCurrencyCents(0, { locale }),
    yourBalance: formatCurrencyCents(0, { locale }),
    oweTo: { name: '', amount: formatCurrencyCents(0, { locale }) },
  });

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [myBalanceHighlight, setMyBalanceHighlight] = useState<MyBalanceHighlight>({
    amount: formatCurrencyCents(0, { locale }),
    type: 'neutral',
    subtitle: 'activityFeed.balanceNeutral',
    occurredAt: null,
    toReceiveAmount: formatCurrencyCents(0, { locale }),
    toPayAmount: formatCurrencyCents(0, { locale }),
    avatarUrl: null,
    avatarSeed: session.user.email || session.user.id,
  });

  const [suggestions, setSuggestions] = useState<SettlementSuggestion[]>([
    { icon: '🥗', labelKey: 'groceries' },
    { icon: '⛽', labelKey: 'gas' },
    { icon: '🍔', labelKey: 'dinner' },
  ]);

  useEffect(() => {
    let mounted = true;

    const fetchRecentActivity = async () => {
      try {
        const { data: memberData, error: memberError } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', session.user.id)
          .eq('status', 'active');
        if (memberError) throw memberError;

        const groupIds = (memberData || []).map((m) => m.group_id);
        if (!groupIds.length) {
          if (mounted) {
            setActivities([]);
            setMyBalanceHighlight({
              amount: formatCurrencyCents(0, { locale }),
              type: 'neutral',
              subtitle: 'activityFeed.balanceNeutral',
              occurredAt: null,
              toReceiveAmount: formatCurrencyCents(0, { locale }),
              toPayAmount: formatCurrencyCents(0, { locale }),
              avatarUrl: null,
              avatarSeed: session.user.email || session.user.id,
            });
          }
          return;
        }

        const { data: groupMembers, error: groupMembersError } = await supabase
          .from('group_members')
          .select('user_id, profile:profiles(full_name, avatar_url)')
          .in('group_id', groupIds)
          .eq('status', 'active');
        if (groupMembersError) throw groupMembersError;

        const profileByUserId = new Map<string, { full_name: string | null; avatar_url: string | null }>();
        for (const row of groupMembers || []) {
          const rawProfile = row.profile as unknown;
          const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
          profileByUserId.set(row.user_id, {
            full_name: (profile as { full_name?: string | null } | null)?.full_name ?? null,
            avatar_url: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
          });
        }

        const { data: rows, error: expensesError } = await supabase
          .from('expenses')
          .select('id, amount_cents, incurred_at, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)')
          .in('group_id', groupIds)
          .is('deleted_at', null)
          .order('incurred_at', { ascending: false })
          .limit(250);
        if (expensesError) throw expensesError;

        const { data: settlementRows, error: settlementsError } = await supabase
  .from('settlements')
  .select('id, group_id, from_user_id, to_user_id, amount_cents, settled_at')
  .in('group_id', groupIds)
  .is('deleted_at', null)
  .order('settled_at', { ascending: false })
  .limit(250);

if (settlementsError) throw settlementsError;

        type Ledger = { netCents: number; latestAt: string };
        const ledgerByUser = new Map<string, Ledger>();

        for (const row of rows || []) {
          if (!isAccountingEligibleExpenseRow(row as { status?: string; event?: unknown })) continue;

          const rawSplits = row.splits as unknown;
          const splits = (Array.isArray(rawSplits) ? rawSplits : []) as Array<{ user_id: string; share_cents: number }>;
          const incurredAt = row.incurred_at;

          if (row.paid_by_user_id === session.user.id) {
            for (const split of splits) {
              if (split.user_id === session.user.id) continue;
              const prev = ledgerByUser.get(split.user_id) || { netCents: 0, latestAt: incurredAt };
              prev.netCents += split.share_cents || 0;
              if (new Date(incurredAt).getTime() > new Date(prev.latestAt).getTime()) prev.latestAt = incurredAt;
              ledgerByUser.set(split.user_id, prev);
            }
          } else {
            const mySplit = splits.find((s) => s.user_id === session.user.id);
            if (!mySplit || !mySplit.share_cents) continue;
            const counterpartyId = row.paid_by_user_id;
            const prev = ledgerByUser.get(counterpartyId) || { netCents: 0, latestAt: incurredAt };
            prev.netCents -= mySplit.share_cents;
            if (new Date(incurredAt).getTime() > new Date(prev.latestAt).getTime()) prev.latestAt = incurredAt;
            ledgerByUser.set(counterpartyId, prev);
          }
        }

        for (const row of settlementRows || []) {
          const settledAt = row.settled_at || new Date().toISOString();
          const amt = row.amount_cents || 0;
        
          if (row.from_user_id === session.user.id) {
            const current = ledgerByUser.get(row.to_user_id) || { netCents: 0, latestAt: settledAt };
            ledgerByUser.set(row.to_user_id, {
              netCents: current.netCents + amt,
              latestAt: settledAt > current.latestAt ? settledAt : current.latestAt,
            });
          } else if (row.to_user_id === session.user.id) {
            const current = ledgerByUser.get(row.from_user_id) || { netCents: 0, latestAt: settledAt };
            ledgerByUser.set(row.from_user_id, {
              netCents: current.netCents - amt,
              latestAt: settledAt > current.latestAt ? settledAt : current.latestAt,
            });
          }
        }

        const mapped: ActivityItem[] = Array.from(ledgerByUser.entries())
          .filter(([, item]) => item.netCents !== 0)
          .sort((a, b) => Math.abs(b[1].netCents) - Math.abs(a[1].netCents))
          .slice(0, 5)
          .map(([userId, item]) => {
            const profile = profileByUserId.get(userId);
            const absAmount = Math.abs(item.netCents);
            const type = item.netCents > 0 ? 'credit' : 'debt';
            return {
              id: `balance-${userId}`,
              title: profile?.full_name || userId,
              subtitle: type === 'credit' ? 'activityFeed.theyOweYou' : 'activityFeed.youOweThem',
              occurredAt: item.latestAt,
              amount: formatCurrencyCents(absAmount, { locale }),
              type,
              avatarSeed: profile?.full_name || userId,
              avatarUrl: profile?.avatar_url || null,
            };
          });

        const totalNetCents = Array.from(ledgerByUser.values()).reduce((sum, row) => sum + row.netCents, 0);
        const totalToReceiveCents = Array.from(ledgerByUser.values()).reduce(
          (sum, row) => sum + (row.netCents > 0 ? row.netCents : 0),
          0,
        );
        const totalToPayCents = Math.abs(
          Array.from(ledgerByUser.values()).reduce((sum, row) => sum + (row.netCents < 0 ? row.netCents : 0), 0),
        );
        const latestAt = Array.from(ledgerByUser.values())
          .map((v) => v.latestAt)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
        const absTotal = Math.abs(totalNetCents);
        const myType: MyBalanceHighlight['type'] = totalNetCents > 0 ? 'credit' : totalNetCents < 0 ? 'debt' : 'neutral';
        const mySubtitle =
          myType === 'credit'
            ? 'activityFeed.balancePositive'
            : myType === 'debt'
              ? 'activityFeed.balanceNegative'
              : 'activityFeed.balanceNeutral';
        const myProfile = profileByUserId.get(session.user.id);

        if (mounted) {
          setActivities(mapped);
          setMyBalanceHighlight({
            amount: formatCurrencyCents(absTotal, { locale }),
            type: myType,
            subtitle: mySubtitle,
            occurredAt: latestAt,
            toReceiveAmount: formatCurrencyCents(totalToReceiveCents, { locale }),
            toPayAmount: formatCurrencyCents(totalToPayCents, { locale }),
            avatarUrl: myProfile?.avatar_url || null,
            avatarSeed: myProfile?.full_name || session.user.email || session.user.id,
          });
        }
      } catch (err) {
        console.error('useDashboardData fetchRecentActivity:', err);
        if (mounted) {
          setActivities([]);
          setMyBalanceHighlight({
            amount: formatCurrencyCents(0, { locale }),
            type: 'neutral',
            subtitle: 'activityFeed.balanceNeutral',
            occurredAt: null,
            toReceiveAmount: formatCurrencyCents(0, { locale }),
            toPayAmount: formatCurrencyCents(0, { locale }),
            avatarUrl: null,
            avatarSeed: session.user.email || session.user.id,
          });
        }
      }
    };

    void fetchRecentActivity();

    const onDataChanged = () => {
      void fetchRecentActivity();
    };
    
    window.addEventListener(EXPENSES_CHANGED_EVENT, onDataChanged);
    window.addEventListener('group-settlement-confirmed', onDataChanged as EventListener);
    
    return () => {
      mounted = false;
      window.removeEventListener(EXPENSES_CHANGED_EVENT, onDataChanged);
      window.removeEventListener('group-settlement-confirmed', onDataChanged as EventListener);
    };
  }, [session.user.id, session.user.email, locale]);

  return {
    summary,
    activities,
    myBalanceHighlight,
    suggestions,
  };
}
