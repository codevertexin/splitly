import React, { useCallback, useMemo, useState } from 'react';
import {
  Share2,
  Plus,
  ChevronRight,
  Scale,
  ArrowDownCircle,
  ArrowUpCircle,
  X,
  Copy,
  Check,
  CirclePlus,
  Users,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Session } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useGroups } from '../../hooks/useGroups';
import { useExpenses } from '../../hooks/useExpenses';
import { useEvents } from '../../hooks/useEvents';
import { useGroupMembers } from '../../hooks/useGroupMembers';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { CreateExpenseForm } from '../expenses/components/CreateExpenseForm';
import { formatCurrencyCents, formatDateOnly } from '../../lib/dateTime';

interface DashboardPageProps {
  session: Session;
}

export function DashboardPage({ session }: DashboardPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { activities } = useDashboardData(session);
  const { groups } = useGroups(session);
  const { expenses } = useExpenses(session);
  const firstName = session.user.email?.split('@')[0] ?? '';
  const [inviteAppFeedback, setInviteAppFeedback] = useState<string | null>(null);
  const [copiedInviteAppLink, setCopiedInviteAppLink] = useState(false);
  const [inviteCardDismissed, setInviteCardDismissed] = useState(false);
  const [inviteExpanded, setInviteExpanded] = useState(false);
  const [showSettleHelp, setShowSettleHelp] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settlingLoading, setSettlingLoading] = useState(false);
  const [settlingError, setSettlingError] = useState<string | null>(null);
  const [profileNamesById, setProfileNamesById] = useState<Record<string, string>>({});
  const [settleViewMode, setSettleViewMode] = useState<'person' | 'group'>('person');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});
  const [createExpenseOpen, setCreateExpenseOpen] = useState(false);
  const [selectedSuggestionTitle, setSelectedSuggestionTitle] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [associateTo, setAssociateTo] = useState<'group' | 'event'>('group');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const defaultGroupId = useMemo(() => {
    if (!groups.length) return null;
    const lastGroupId = localStorage.getItem('splitly_last_group_id');
    if (lastGroupId && groups.some((group) => group.id === lastGroupId)) {
      return lastGroupId;
    }
    return groups[0].id;
  }, [groups]);

  const {
    events,
    loading: eventsLoading,
    error: eventsError,
  } = useEvents(session, selectedGroupId || undefined);
  const {
    members: selectedGroupMembers,
    loading: membersLoading,
    error: membersError,
  } = useGroupMembers(session, selectedGroupId || undefined);

  const openEvents = useMemo(
    () =>
      events
        .filter((event) => event.status === 'open')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events]
  );

  const groupBalances = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.status !== 'confirmed') continue;
      if (expense.event?.status === 'draft') continue;
      const current = map.get(expense.group_id) || 0;
      if (expense.paid_by_user_id === session.user.id) {
        let delta = 0;
        for (const split of expense.splits || []) {
          if (split.user_id === session.user.id) continue;
          delta += split.share_cents || 0;
        }
        map.set(expense.group_id, current + delta);
      } else {
        const mySplit = (expense.splits || []).find((s) => s.user_id === session.user.id);
        map.set(expense.group_id, current - (mySplit?.share_cents || 0));
      }
    }
    return map;
  }, [expenses, session.user.id]);

  const totalToReceiveCents = useMemo(
    () => Array.from(groupBalances.values()).reduce((sum, value) => sum + (value > 0 ? value : 0), 0),
    [groupBalances]
  );
  const totalToPayCents = useMemo(
    () => Math.abs(Array.from(groupBalances.values()).reduce((sum, value) => sum + (value < 0 ? value : 0), 0)),
    [groupBalances]
  );
  const netBalanceCents = totalToReceiveCents - totalToPayCents;
  const groupsOwingYouCount = useMemo(
    () => Array.from(groupBalances.values()).filter((value) => value > 0).length,
    [groupBalances]
  );
  const groupsYouOweCount = useMemo(
    () => Array.from(groupBalances.values()).filter((value) => value < 0).length,
    [groupBalances]
  );
  const creditors = useMemo(
    () => activities.filter((item) => item.type === 'credit'),
    [activities]
  );

  const groupsNeedingSettlementCount = useMemo(
    () => groups.filter((g) => (groupBalances.get(g.id) || 0) !== 0).length,
    [groups, groupBalances]
  );

  type SettlementSuggestionRow = {
    key: string;
    group_id: string;
    group_name: string;
    counterparty_id: string;
    from_user_id: string;
    to_user_id: string;
    amount_cents: number;
    counterparty_name: string;
    direction: 'pay' | 'receive';
  };

  const involvedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const expense of expenses) {
      ids.add(expense.paid_by_user_id);
      for (const split of expense.splits || []) ids.add(split.user_id);
    }
    return Array.from(ids);
  }, [expenses]);

  React.useEffect(() => {
    let cancelled = false;
    const loadNames = async () => {
      if (involvedUserIds.length === 0) {
        setProfileNamesById({});
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', involvedUserIds);
      if (cancelled || error) return;
      const byId: Record<string, string> = {};
      for (const row of data || []) {
        if (row.full_name?.trim()) byId[row.id] = row.full_name.trim();
      }
      setProfileNamesById(byId);
    };
    void loadNames();
    return () => {
      cancelled = true;
    };
  }, [involvedUserIds]);

  const settlementSuggestions = useMemo<SettlementSuggestionRow[]>(() => {
    const pairMap = new Map<string, SettlementSuggestionRow>();
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    for (const expense of expenses) {
      if (expense.status !== 'confirmed') continue;
      if (expense.event?.status === 'draft') continue;
      const splits = expense.splits || [];
      if (expense.paid_by_user_id === session.user.id) {
        for (const split of splits) {
          if (split.user_id === session.user.id) continue;
          const key = `${expense.group_id}:${split.user_id}:receive`;
          const row = pairMap.get(key) || {
            key,
            group_id: expense.group_id,
            group_name: groupName.get(expense.group_id) || 'Group',
            counterparty_id: split.user_id,
            from_user_id: split.user_id,
            to_user_id: session.user.id,
            amount_cents: 0,
            counterparty_name: profileNamesById[split.user_id] || split.user_id,
            direction: 'receive' as const,
          };
          row.amount_cents += split.share_cents || 0;
          pairMap.set(key, row);
        }
      } else {
        const mySplit = splits.find((s) => s.user_id === session.user.id);
        if (!mySplit?.share_cents) continue;
        const payerName = expense.profiles?.full_name || profileNamesById[expense.paid_by_user_id] || expense.paid_by_user_id;
        const key = `${expense.group_id}:${expense.paid_by_user_id}:pay`;
        const row = pairMap.get(key) || {
          key,
          group_id: expense.group_id,
          group_name: groupName.get(expense.group_id) || 'Group',
          counterparty_id: expense.paid_by_user_id,
          from_user_id: session.user.id,
          to_user_id: expense.paid_by_user_id,
          amount_cents: 0,
          counterparty_name: payerName,
          direction: 'pay' as const,
        };
        row.amount_cents += mySplit.share_cents;
        pairMap.set(key, row);
      }
    }
    return Array.from(pairMap.values())
      .filter((row) => row.amount_cents > 0)
      .sort((a, b) => b.amount_cents - a.amount_cents);
  }, [expenses, groups, profileNamesById, session.user.id]);

  const [selectedSettlementKeys, setSelectedSettlementKeys] = useState<string[]>([]);
  const [editedAmountsByKey, setEditedAmountsByKey] = useState<Record<string, number>>({});

  const parseMoneyToCents = (value: string): number | null => {
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    if (!normalized) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
  };

  const groupedSettlementSuggestions = useMemo(() => {
    const byPerson = new Map<
      string,
      {
        personKey: string;
        counterparty_id: string;
        counterparty_name: string;
        direction: 'pay' | 'receive';
        rows: SettlementSuggestionRow[];
      }
    >();
    for (const row of settlementSuggestions) {
      const personKey = `${row.direction}:${row.counterparty_id}`;
      const existing = byPerson.get(personKey);
      if (existing) {
        existing.rows.push(row);
      } else {
        byPerson.set(personKey, {
          personKey,
          counterparty_id: row.counterparty_id,
          counterparty_name: row.counterparty_name,
          direction: row.direction,
          rows: [row],
        });
      }
    }
    return Array.from(byPerson.values()).map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => b.amount_cents - a.amount_cents),
    }));
  }, [settlementSuggestions]);

  const groupedByGroupSuggestions = useMemo(() => {
    const byGroup = new Map<
      string,
      {
        group_id: string;
        group_name: string;
        rows: SettlementSuggestionRow[];
      }
    >();
    for (const row of settlementSuggestions) {
      const existing = byGroup.get(row.group_id);
      if (existing) {
        existing.rows.push(row);
      } else {
        byGroup.set(row.group_id, {
          group_id: row.group_id,
          group_name: row.group_name,
          rows: [row],
        });
      }
    }
    return Array.from(byGroup.values()).map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => b.amount_cents - a.amount_cents),
    }));
  }, [settlementSuggestions]);

  const personTotalByKey = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const group of groupedSettlementSuggestions) {
      totals[group.personKey] = group.rows.reduce(
        (sum, row) => sum + Math.max(0, editedAmountsByKey[row.key] ?? row.amount_cents),
        0,
      );
    }
    return totals;
  }, [editedAmountsByKey, groupedSettlementSuggestions]);

  const groupTotalById = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const group of groupedByGroupSuggestions) {
      totals[group.group_id] = group.rows.reduce(
        (sum, row) => sum + Math.max(0, editedAmountsByKey[row.key] ?? row.amount_cents),
        0,
      );
    }
    return totals;
  }, [editedAmountsByKey, groupedByGroupSuggestions]);

  React.useEffect(() => {
    if (!showSettleModal) return;
    setSelectedSettlementKeys(settlementSuggestions.map((row) => row.key));
    setEditedAmountsByKey(
      settlementSuggestions.reduce<Record<string, number>>((acc, row) => {
        acc[row.key] = row.amount_cents;
        return acc;
      }, {}),
    );
    setSettleViewMode('person');
    setExpandedGroupIds(
      settlementSuggestions.reduce<Record<string, boolean>>((acc, row) => {
        acc[row.group_id] = true;
        return acc;
      }, {}),
    );
    setSettlingError(null);
  }, [showSettleModal, settlementSuggestions]);

  const updatePersonTotal = useCallback(
    (personKey: string, totalCents: number) => {
      const group = groupedSettlementSuggestions.find((g) => g.personKey === personKey);
      if (!group || group.rows.length === 0) return;
      const originalTotal = group.rows.reduce((sum, row) => sum + row.amount_cents, 0);
      if (originalTotal <= 0) return;

      const capped = Math.max(0, totalCents);
      const provisional = group.rows.map((row) => {
        const exact = (capped * row.amount_cents) / originalTotal;
        const floor = Math.floor(exact);
        return { key: row.key, floor, frac: exact - floor };
      });
      let remainder = capped - provisional.reduce((sum, p) => sum + p.floor, 0);
      provisional.sort((a, b) => b.frac - a.frac);
      const next: Record<string, number> = {};
      for (const item of provisional) next[item.key] = item.floor;
      for (let i = 0; i < provisional.length && remainder > 0; i += 1) {
        next[provisional[i].key] += 1;
        remainder -= 1;
      }
      setEditedAmountsByKey((prev) => ({ ...prev, ...next }));
    },
    [groupedSettlementSuggestions],
  );

  const updateGroupTotal = useCallback(
    (groupId: string, totalCents: number) => {
      const group = groupedByGroupSuggestions.find((g) => g.group_id === groupId);
      if (!group || group.rows.length === 0) return;
      const originalTotal = group.rows.reduce((sum, row) => sum + row.amount_cents, 0);
      if (originalTotal <= 0) return;

      const capped = Math.max(0, totalCents);
      const provisional = group.rows.map((row) => {
        const exact = (capped * row.amount_cents) / originalTotal;
        const floor = Math.floor(exact);
        return { key: row.key, floor, frac: exact - floor };
      });
      let remainder = capped - provisional.reduce((sum, p) => sum + p.floor, 0);
      provisional.sort((a, b) => b.frac - a.frac);
      const next: Record<string, number> = {};
      for (const item of provisional) next[item.key] = item.floor;
      for (let i = 0; i < provisional.length && remainder > 0; i += 1) {
        next[provisional[i].key] += 1;
        remainder -= 1;
      }
      setEditedAmountsByKey((prev) => ({ ...prev, ...next }));
    },
    [groupedByGroupSuggestions],
  );

  const handleConfirmSettlements = useCallback(async () => {
    const selected = settlementSuggestions
      .filter((row) => selectedSettlementKeys.includes(row.key))
      .map((row) => ({ ...row, amount_cents: Math.max(0, editedAmountsByKey[row.key] ?? row.amount_cents) }))
      .filter((row) => row.amount_cents > 0);
    if (selected.length === 0) {
      setSettlingError(t('dashboard.settleModalSelectAtLeastOne'));
      return;
    }
    setSettlingLoading(true);
    setSettlingError(null);
    try {
      const now = new Date().toISOString();
      const payload = selected.map((row) => ({
        group_id: row.group_id,
        event_id: null,
        from_user_id: row.from_user_id,
        to_user_id: row.to_user_id,
        amount_cents: row.amount_cents,
        currency: 'EUR',
        settled_at: now,
        note: 'Dashboard settle up',
        created_by: session.user.id,
      }));
      const { error } = await supabase.from('settlements').insert(payload);
      if (error) throw error;
      setShowSettleModal(false);
      navigate('/expenses');
    } catch (err: unknown) {
      setSettlingError(err instanceof Error ? err.message : t('dashboard.settleModalSaveError'));
    } finally {
      setSettlingLoading(false);
    }
  }, [editedAmountsByKey, navigate, selectedSettlementKeys, session.user.id, settlementSuggestions, t]);

  /** Convida pessoas a registarem-se na app (partilha ou cópia do URL), não convites de grupo. */
  const handleInviteFriends = useCallback(async () => {
    const url = `${window.location.origin}/?ref=${encodeURIComponent(session.user.id)}`;
    const title = t('dashboard.inviteAppShareTitle');
    const text = `${t('dashboard.inviteAppShareText')} ${url}`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setInviteAppFeedback(t('dashboard.inviteAppLinkCopied'));
      window.setTimeout(() => setInviteAppFeedback(null), 2500);
    } catch {
      setInviteAppFeedback(t('dashboard.inviteAppCopyFailed'));
      window.setTimeout(() => setInviteAppFeedback(null), 4000);
    }
  }, [t, session.user.id]);

  const inviteAppLink = useMemo(
    () => `${window.location.origin}/?ref=${encodeURIComponent(session.user.id)}`,
    [session.user.id]
  );

  const handleCopyInviteAppLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteAppLink);
      setCopiedInviteAppLink(true);
      setInviteAppFeedback(t('dashboard.inviteAppLinkCopied'));
      window.setTimeout(() => setCopiedInviteAppLink(false), 2000);
      window.setTimeout(() => setInviteAppFeedback(null), 2500);
    } catch {
      setInviteAppFeedback(t('dashboard.inviteAppCopyFailed'));
      window.setTimeout(() => setInviteAppFeedback(null), 4000);
    }
  }, [inviteAppLink, t]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div>
        <h2 className="text-3xl font-bold text-slate-900">{t('dashboard.welcome', { name: firstName })}</h2>
        <p className="text-slate-500 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 sm:p-7 border-slate-200/80 shadow-md shadow-slate-200/40">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-900">{t('dashboard.yourBalanceTitle')}</h3>
              <button
                type="button"
                onClick={() => navigate('/expenses')}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                {t('activityFeed.details')}
              </button>
            </div>

            <div className="rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-white to-slate-50/80 px-5 py-6 sm:px-7 sm:py-8 mb-4 ring-1 ring-slate-100">
              <p className="text-xs sm:text-sm font-semibold text-slate-600 tracking-tight">
                {t('dashboard.netBalanceLabel')}
              </p>
              <p
                className={`mt-2 text-4xl sm:text-5xl font-extrabold tracking-tight tabular-nums ${
                  netBalanceCents > 0
                    ? 'text-emerald-700'
                    : netBalanceCents < 0
                      ? 'text-red-700'
                      : 'text-slate-800'
                }`}
              >
                {netBalanceCents > 0 ? '+' : netBalanceCents < 0 ? '−' : ''}
                {formatCurrencyCents(Math.abs(netBalanceCents))}
              </p>
              {netBalanceCents > 0 && (
                <p className="mt-2 text-xs font-medium text-emerald-800/80">{t('dashboard.netBalanceHintPositive')}</p>
              )}
              {netBalanceCents < 0 && (
                <p className="mt-2 text-xs font-medium text-red-800/80">{t('dashboard.netBalanceHintNegative')}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-2xl border border-emerald-100/90 bg-emerald-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-800/90">{t('activityFeed.toReceiveLabel')}</p>
                <p className="text-lg sm:text-xl font-bold text-emerald-800 tabular-nums mt-1">{formatCurrencyCents(totalToReceiveCents)}</p>
              </div>
              <div className="rounded-2xl border border-red-100/90 bg-red-50/70 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider font-bold text-red-800/90">{t('activityFeed.toPayLabel')}</p>
                <p className="text-lg sm:text-xl font-bold text-red-800 tabular-nums mt-1">{formatCurrencyCents(totalToPayCents)}</p>
              </div>
            </div>

            <div className="space-y-1 text-sm text-slate-600">
              {totalToReceiveCents > 0 && (
                <p>
                  {groupsOwingYouCount === 1
                    ? t('dashboard.owedSummaryOne', {
                        amount: formatCurrencyCents(totalToReceiveCents),
                        count: groupsOwingYouCount,
                      })
                    : t('dashboard.owedSummaryOther', {
                        amount: formatCurrencyCents(totalToReceiveCents),
                        count: groupsOwingYouCount,
                      })}
                </p>
              )}
              {totalToPayCents > 0 && (
                <p>
                  {groupsYouOweCount === 1
                    ? t('dashboard.oweSummaryOne', {
                        amount: formatCurrencyCents(totalToPayCents),
                        count: groupsYouOweCount,
                      })
                    : t('dashboard.oweSummaryOther', {
                        amount: formatCurrencyCents(totalToPayCents),
                        count: groupsYouOweCount,
                      })}
                </p>
              )}
            </div>

            {(creditors.length > 0 || groupsNeedingSettlementCount > 0) && (
              <div className="mt-2 space-y-1 border-t border-slate-100/90 pt-2.5 text-xs font-medium text-slate-500">
                {creditors.length === 1 && <p>{t('dashboard.insightFromPeopleOne')}</p>}
                {creditors.length > 1 && (
                  <p>{t('dashboard.insightFromPeopleMany', { count: creditors.length })}</p>
                )}
                {groupsNeedingSettlementCount === 1 && (
                  <p>{t('dashboard.insightGroupsSettlementOne')}</p>
                )}
                {groupsNeedingSettlementCount > 1 && (
                  <p>{t('dashboard.insightGroupsSettlementMany', { count: groupsNeedingSettlementCount })}</p>
                )}
              </div>
            )}

            <Button
              type="button"
              className="w-full mt-3 py-4 text-lg font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-xl shadow-emerald-950/30 ring-2 ring-emerald-800/20 border border-emerald-900/10"
              onClick={() => setShowSettleModal(true)}
            >
              <Scale className="w-5 h-5 mr-2 shrink-0" />
              {t('dashboard.settleUpNow')}
            </Button>
            <button
              type="button"
              onClick={() => setShowSettleHelp(true)}
              className="mt-3 text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-800"
            >
              {t('groupDetail.howSettlementsWork')}
            </button>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">{t('dashboard.whoOwesYou')}</h3>
            {creditors.length === 0 ? (
              <p className="text-sm font-medium text-slate-600 text-center py-6 px-2 rounded-2xl bg-slate-50 border border-slate-100">
                {t('dashboard.whoOwesYouEmpty')}
              </p>
            ) : (
              <div className="space-y-3">
                {creditors.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {t('activityFeed.theyOweYou')} · {formatDateOnly(item.occurredAt, i18n.language)}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-emerald-700 shrink-0 tabular-nums">{item.amount}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {!inviteCardDismissed && (
            <Card className="border border-slate-200/80 bg-white/90 p-2 shadow-sm">
              {!inviteExpanded ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setInviteExpanded(true)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-2 pr-1 text-left text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Share2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{t('dashboard.inviteTitleShort')}</span>
                    <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onClick={() => setInviteCardDismissed(true)}
                    aria-label={t('dashboard.dismissInvite')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-2 px-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setInviteExpanded(false)}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    >
                      <span className="text-xs font-bold text-slate-800">{t('dashboard.inviteTitleShort')}</span>
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setInviteCardDismissed(true)}
                      aria-label={t('dashboard.dismissInvite')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 px-1 text-[11px] leading-snug text-slate-500">{t('dashboard.inviteBodyShort')}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="bg-white text-xs" onClick={() => void handleInviteFriends()}>
                      <Share2 className="mr-1.5 h-3.5 w-3.5" />
                      {t('dashboard.inviteFriends')}
                    </Button>
                    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-slate-200 bg-slate-50/80 px-1.5 py-1 sm:min-w-[10rem]">
                      <input
                        type="text"
                        readOnly
                        value={inviteAppLink}
                        className="min-w-0 flex-1 border-none bg-transparent text-[10px] text-slate-600 focus:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyInviteAppLink()}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        aria-label={t('inviteModal.copyLink')}
                      >
                        {copiedInviteAppLink ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                    {inviteAppFeedback && <p className="w-full text-[10px] text-slate-500">{inviteAppFeedback}</p>}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="text-lg font-bold text-slate-900 mb-4">{t('dashboard.quickActions')}</h3>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (!defaultGroupId) {
                    navigate('/groups');
                    return;
                  }
                  setSelectedGroupId(defaultGroupId);
                  setAssociateTo('group');
                  setSelectedEventId('');
                  setSelectedSuggestionTitle('');
                  setCreateExpenseOpen(true);
                }}
                className="group w-full rounded-2xl bg-blue-600 px-4 py-5 text-left text-white shadow-xl shadow-blue-600/35 ring-2 ring-blue-500/30 transition-all hover:bg-blue-700 hover:shadow-blue-700/40"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
                    <CirclePlus className="h-7 w-7" />
                  </span>
                  <span>
                    <span className="block text-lg font-bold leading-tight">{t('dashboard.quickActionAddExpense')}</span>
                    <span className="mt-0.5 block text-xs font-medium text-blue-100/95">{t('dashboard.quickActionAddExpenseHint')}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/groups')}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <Users className="w-4 h-4 inline mr-2.5 text-slate-500" />
                {t('dashboard.quickActionCreateGroup')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/events')}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <Calendar className="w-4 h-4 inline mr-2.5 text-slate-500" />
                {t('dashboard.quickActionCreateEvent')}
              </button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-900">{t('dashboard.myGroups')}</h3>
              <button 
                onClick={() => navigate('/groups')}
                className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {groups.slice(0, 3).map((group) => {
                const balance = groupBalances.get(group.id) || 0;
                const amount = formatCurrencyCents(Math.abs(balance));
                const statusLabel =
                  balance > 0 ? t('dashboard.groupStatusReceive') : balance < 0 ? t('dashboard.groupStatusPay') : t('dashboard.groupStatusNeutral');
                const amountClass = balance > 0 ? 'text-emerald-700' : balance < 0 ? 'text-red-700' : 'text-slate-600';
                const rowBg =
                  balance > 0 ? 'bg-emerald-50/80 border-emerald-100' : balance < 0 ? 'bg-red-50/80 border-red-100' : 'bg-slate-50 border-slate-100';
                const accent = balance > 0 ? 'border-l-emerald-500' : balance < 0 ? 'border-l-red-500' : 'border-l-slate-300';
                const icon =
                  balance > 0 ? (
                    <ArrowDownCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : balance < 0 ? (
                    <ArrowUpCircle className="w-4 h-4 text-red-600 shrink-0" />
                  ) : null;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => navigate(`/groups/${group.id}`)}
                    className={`w-full text-left rounded-2xl border border-l-4 pl-3 pr-4 py-3.5 ${accent} ${rowBg} hover:ring-1 hover:ring-blue-200/60 transition-all`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{group.name}</p>
                        <p
                          className={`text-xs font-semibold mt-1 ${
                            balance > 0 ? 'text-emerald-800/90' : balance < 0 ? 'text-red-800/90' : 'text-slate-500'
                          }`}
                        >
                          {statusLabel}
                        </p>
                      </div>
                      <div className={`text-sm font-extrabold tabular-nums inline-flex items-center gap-1 shrink-0 ${amountClass}`}>
                        {icon}
                        {balance === 0 ? amount : `${balance > 0 ? '+' : '−'}${amount}`}
                      </div>
                    </div>
                  </button>
                );
              })}
              <button 
                onClick={() => navigate('/groups')}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-all mt-2"
              >
                {t('dashboard.viewAllGroups')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </Card>

        </div>
      </div>

      {defaultGroupId && (
        <Modal
          isOpen={createExpenseOpen}
          onClose={() => setCreateExpenseOpen(false)}
          title={t('dashboard.quickExpenseModalTitle')}
          size="lg"
        >
          <div className="space-y-4 mb-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('dashboard.quickExpenseGroupLabel')}</label>
              <select
                value={selectedGroupId}
                onChange={(e) => {
                  setSelectedGroupId(e.target.value);
                  setSelectedEventId('');
                }}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('dashboard.quickExpenseAssociationType')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAssociateTo('group')}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    associateTo === 'group'
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t('dashboard.quickExpenseGroupOnly')}
                </button>
                <button
                  type="button"
                  onClick={() => setAssociateTo('event')}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    associateTo === 'event'
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t('dashboard.quickExpenseExistingEvent')}
                </button>
              </div>
            </div>

            {associateTo === 'event' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('dashboard.quickExpenseSelectEvent')}</label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  disabled={eventsLoading || openEvents.length === 0}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                >
                  <option value="">
                    {eventsLoading ? t('dashboard.quickExpenseLoadingEvents') : t('dashboard.quickExpenseSelectEventPlaceholder')}
                  </option>
                  {openEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </select>
                {eventsError && (
                  <p className="mt-2 text-xs text-red-600">
                    Nao foi possivel carregar os eventos deste grupo.
                  </p>
                )}
                {!eventsLoading && !eventsError && openEvents.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {t('dashboard.quickExpenseNoOpenEvents')}
                  </p>
                )}
              </div>
            )}
          </div>

          <CreateExpenseForm
            groupId={selectedGroupId}
            eventId={associateTo === 'event' ? selectedEventId : undefined}
            initialTitle={selectedSuggestionTitle}
            participants={selectedGroupMembers}
            participantsLoading={membersLoading}
            participantsError={membersError}
            submitDisabled={
              membersLoading ||
              !!membersError ||
              (associateTo === 'event' && (!selectedEventId || eventsLoading || openEvents.length === 0))
            }
            submitDisabledMessage={
              membersLoading
                ? t('groupExpense.tooltipLoadingMembers')
                : membersError
                  ? t('groupExpense.tooltipMembersError')
                  : associateTo === 'event' && openEvents.length === 0
                    ? t('dashboard.quickExpenseNoOpenEventsDisabled')
                    : t('dashboard.quickExpenseSelectEventDisabled')
            }
            session={session}
            onSuccess={() => {
              setCreateExpenseOpen(false);
              navigate('/expenses');
            }}
            onCancel={() => setCreateExpenseOpen(false)}
          />
        </Modal>
      )}

      <Modal
        isOpen={showSettleModal}
        onClose={() => setShowSettleModal(false)}
        title={t('dashboard.settleModalTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('dashboard.settleModalSubtitle')}</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-1.5">
            <button
              type="button"
              onClick={() => setSettleViewMode('person')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                settleViewMode === 'person'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50'
              }`}
            >
              {t('dashboard.settleByPerson')}
            </button>
            <button
              type="button"
              onClick={() => setSettleViewMode('group')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                settleViewMode === 'group'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {t('dashboard.settleByGroup')}
            </button>
          </div>
          {settlementSuggestions.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              {t('dashboard.settleModalEmpty')}
            </p>
          ) : (
            <div className="space-y-2 max-h-[20rem] overflow-y-auto pr-1">
              {settleViewMode === 'person' &&
                groupedSettlementSuggestions.map((group) => {
                  const allSelected = group.rows.every((row) => selectedSettlementKeys.includes(row.key));
                  const groupTotal = personTotalByKey[group.personKey] ?? 0;
                  return (
                    <div key={group.personKey} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={allSelected}
                          onChange={() => {
                            setSelectedSettlementKeys((prev) => {
                              const withoutGroup = prev.filter((k) => !group.rows.some((r) => r.key === k));
                              if (allSelected) return withoutGroup;
                              return [...withoutGroup, ...group.rows.map((r) => r.key)];
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">
                            {group.direction === 'pay'
                              ? t('dashboard.settleModalPayLine', {
                                  amount: formatCurrencyCents(groupTotal),
                                  name: group.counterparty_name,
                                })
                              : t('dashboard.settleModalReceiveLine', {
                                  amount: formatCurrencyCents(groupTotal),
                                  name: group.counterparty_name,
                                })}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={(groupTotal / 100).toFixed(2)}
                              onChange={(e) => {
                                const cents = parseMoneyToCents(e.target.value);
                                if (cents == null) {
                                  return;
                                }
                                updatePersonTotal(group.personKey, cents);
                              }}
                              className="w-28 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-right"
                            />
                            <span className="text-xs text-slate-500">EUR</span>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {group.rows.map((row) => {
                              const selected = selectedSettlementKeys.includes(row.key);
                              const amount = Math.max(0, editedAmountsByKey[row.key] ?? row.amount_cents);
                              return (
                                <label
                                  key={row.key}
                                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                                    selected ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-slate-50'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={selected}
                                    onChange={() =>
                                      setSelectedSettlementKeys((prev) =>
                                        prev.includes(row.key) ? prev.filter((k) => k !== row.key) : [...prev, row.key],
                                      )
                                    }
                                  />
                                  <span className="min-w-0 flex-1 text-xs text-slate-700">{row.group_name}</span>
                                  <input
                                    type="text"
                                    value={(amount / 100).toFixed(2)}
                                    onChange={(e) => {
                                      const cents = parseMoneyToCents(e.target.value);
                                      if (cents == null) return;
                                      setEditedAmountsByKey((prev) => ({ ...prev, [row.key]: cents }));
                                    }}
                                    className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-right"
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              {settleViewMode === 'group' &&
                groupedByGroupSuggestions.map((group) => {
                  const isExpanded = expandedGroupIds[group.group_id] ?? true;
                  const allSelected = group.rows.every((row) => selectedSettlementKeys.includes(row.key));
                  const groupTotal = groupTotalById[group.group_id] ?? 0;
                  return (
                    <div key={group.group_id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={allSelected}
                          onChange={() => {
                            setSelectedSettlementKeys((prev) => {
                              const withoutGroup = prev.filter((k) => !group.rows.some((r) => r.key === k));
                              if (allSelected) return withoutGroup;
                              return [...withoutGroup, ...group.rows.map((r) => r.key)];
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedGroupIds((prev) => ({ ...prev, [group.group_id]: !(prev[group.group_id] ?? true) }))
                            }
                            className="flex w-full items-center justify-between gap-2 text-left"
                          >
                            <p className="text-sm font-semibold text-slate-900">
                              {t('dashboard.settleInGroupLine', {
                                group: group.group_name,
                                amount: formatCurrencyCents(groupTotal),
                              })}
                            </p>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-slate-500" />
                            )}
                          </button>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="text"
                              value={(groupTotal / 100).toFixed(2)}
                              onChange={(e) => {
                                const cents = parseMoneyToCents(e.target.value);
                                if (cents == null) {
                                  return;
                                }
                                updateGroupTotal(group.group_id, cents);
                              }}
                              className="w-28 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-right"
                            />
                            <span className="text-xs text-slate-500">EUR</span>
                          </div>
                          {isExpanded && (
                            <div className="mt-2 space-y-1.5">
                              {group.rows.map((row) => {
                                const selected = selectedSettlementKeys.includes(row.key);
                                const amount = Math.max(0, editedAmountsByKey[row.key] ?? row.amount_cents);
                                return (
                                  <label
                                    key={row.key}
                                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                                      selected ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-slate-50'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      checked={selected}
                                      onChange={() =>
                                        setSelectedSettlementKeys((prev) =>
                                          prev.includes(row.key) ? prev.filter((k) => k !== row.key) : [...prev, row.key],
                                        )
                                      }
                                    />
                                    <span className="min-w-0 flex-1 text-xs text-slate-700">
                                      {row.direction === 'pay'
                                        ? t('dashboard.settleModalPayLine', {
                                            amount: formatCurrencyCents(amount),
                                            name: row.counterparty_name,
                                          })
                                        : t('dashboard.settleModalReceiveLine', {
                                            amount: formatCurrencyCents(amount),
                                            name: row.counterparty_name,
                                          })}
                                    </span>
                                    <input
                                      type="text"
                                      value={(amount / 100).toFixed(2)}
                                      onChange={(e) => {
                                        const cents = parseMoneyToCents(e.target.value);
                                        if (cents == null) return;
                                        setEditedAmountsByKey((prev) => ({ ...prev, [row.key]: cents }));
                                      }}
                                      className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-right"
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          {settlingError && (
            <p className="text-xs text-red-600 rounded-lg border border-red-200 bg-red-50 px-3 py-2">{settlingError}</p>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowSettleModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              className="flex-[2]"
              onClick={() => void handleConfirmSettlements()}
              loading={settlingLoading}
              disabled={settlementSuggestions.length === 0}
            >
              {t('dashboard.settleModalConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showSettleHelp}
        onClose={() => setShowSettleHelp(false)}
        title={t('groupDetail.settleHelpTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-600">{t('groupDetail.settleHelpBody')}</p>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setShowSettleHelp(false);
                navigate('/help#settle');
              }}
              className="text-xs font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700"
            >
              {t('groupDetail.settleHelpLearnMore')}
            </button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowSettleHelp(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
