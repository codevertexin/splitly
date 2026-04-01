import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useGroups } from '../../hooks/useGroups';
import { GroupExpenseRow, useGroupExpenses } from '../../hooks/useGroupExpenses';
import { useGroupMembers } from '../../hooks/useGroupMembers';
import { useGroupBalances } from '../../hooks/useGroupBalances';
import { useGroupAllBalancesZero } from '../../hooks/useGroupAllBalancesZero';
import { useEvents } from '../../hooks/useEvents';
import { GroupDetail } from './components/GroupDetail';
import { CreateExpenseModal } from './components/CreateExpenseModal';
import { ManageGroupModal } from './components/ManageGroupModal';
import { CreateEventForm } from '../events/components/CreateEventForm';
import { Group } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { formatCentsAsDecimal, formatCurrencyCents, formatDecimal, formatFixedInput } from '../../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../../lib/accountingExpenses';
import {
  buildEqualSharesCents,
  canApplySettlementAwareEqualSplit,
  computeDebtsToCurrentUser,
  suggestSettlementAwareEqualSplit,
} from '../../lib/settlementSplit';
import { buildSettlementSuggestionsForUser } from '../../lib/settlementSuggestions';

interface GroupDetailPageProps {
  session: Session;
}

export function GroupDetailPage({ session }: GroupDetailPageProps) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { groups, loading, error, actionLoading, updateGroup, archiveGroup, fetchGroups } =
    useGroups(session);
  const [group, setGroup] = useState<Group | null>(null);

  const {
    expenses,
    allExpenses,
    loading: expensesLoading,
    actionLoading: expenseActionLoading,
    createExpense,
    updateExpense,
    refetch: refetchExpenses,
  } = useGroupExpenses(session, group?.id);
  const { createEvent, actionLoading: eventActionLoading } = useEvents(session, group?.id);
  const {
    members,
    loading: membersLoading,
    error: membersError,
  } = useGroupMembers(session, group?.id);

  const {
    myBalanceCents,
    loading: balanceLoading,
    error: balanceError,
    refetch: refetchBalances,
  } = useGroupBalances(session, group?.id);

  const {
    allBalancesZero,
    loading: balancesZeroLoading,
    error: balancesZeroError,
    refetch: refetchBalancesZero,
  } = useGroupAllBalancesZero(group?.id);

  const isOwner = useMemo(
    () => members.some((m) => m.user_id === session.user.id && m.role === 'owner'),
    [members, session.user.id]
  );

  const canAddExpense =
    !membersLoading && !membersError && members.length > 0;

  const addExpenseDisabledHint = !canAddExpense
    ? membersLoading
      ? t('groupExpense.tooltipLoadingMembers')
      : membersError
        ? t('groupExpense.tooltipMembersError')
        : t('groupExpense.tooltipNoMembers')
    : undefined;

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [requestingUserIds, setRequestingUserIds] = useState<Set<string>>(new Set());
  const [requestedUserIds, setRequestedUserIds] = useState<Set<string>>(new Set());
  const [requestFeedback, setRequestFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editingExpense, setEditingExpense] = useState<GroupExpenseRow | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editParticipantIds, setEditParticipantIds] = useState<string[]>([]);
  const [editSplitMethod, setEditSplitMethod] = useState<'equal' | 'manual' | 'percentage'>('equal');
  const [editSettleAwareEnabled, setEditSettleAwareEnabled] = useState(false);
  const [editDebtsToCurrentUser, setEditDebtsToCurrentUser] = useState<Record<string, number>>({});
  const [editManualShares, setEditManualShares] = useState<Record<string, string>>({});
  const [editPercentageShares, setEditPercentageShares] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'draft' | 'confirmed'>('confirmed');
  const editAmountCentsPreview = Math.round((parseFloat(editAmount.replace(',', '.')) || 0) * 100);
  const editEqualSharesPreview = useMemo(
    () => buildEqualSharesCents(editParticipantIds, editAmountCentsPreview),
    [editParticipantIds, editAmountCentsPreview],
  );
  const editSettleAwareAvailable = useMemo(
    () => canApplySettlementAwareEqualSplit({
      splitMethod: 'equal',
      participantIds: editParticipantIds,
      payerId: session.user.id,
      debtsToPayer: editDebtsToCurrentUser,
    }),
    [editParticipantIds, session.user.id, editDebtsToCurrentUser],
  );
  const editSettlementSuggestion = useMemo(
    () =>
      suggestSettlementAwareEqualSplit({
        amountCents: editAmountCentsPreview,
        participantIds: editParticipantIds,
        payerId: session.user.id,
        debtsToPayer: editDebtsToCurrentUser,
        enabled: editSettleAwareEnabled,
        splitMethod: editSplitMethod,
      }),
    [editAmountCentsPreview, editParticipantIds, session.user.id, editDebtsToCurrentUser, editSettleAwareEnabled, editSplitMethod],
  );
  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale: 'pt-PT' });
  const editManualTotal = editParticipantIds.reduce((sum, id) => {
    const cents = Math.round(parseFloat((editManualShares[id] ?? '').replace(',', '.')) * 100);
    return sum + (Number.isNaN(cents) ? 0 : cents);
  }, 0);
  const editManualDelta = editAmountCentsPreview - editManualTotal;
  const editPercentageTotal = editParticipantIds.reduce((sum, id) => {
    const pct = parseFloat((editPercentageShares[id] ?? '').replace(',', '.'));
    return sum + (Number.isNaN(pct) ? 0 : pct);
  }, 0);
  const editPercentageDelta = 100 - editPercentageTotal;

  useEffect(() => {
    setGroup(null);
    setRequestedUserIds(new Set());
    setRequestingUserIds(new Set());
    setRequestFeedback(null);
  }, [id]);

  useEffect(() => {
    if (!requestFeedback) return;
    const timeout = window.setTimeout(() => setRequestFeedback(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [requestFeedback]);

  useEffect(() => {
    if (!loading && groups.length > 0 && id) {
      const found = groups.find((g) => g.id === id);
      if (found) {
        setGroup(found);
      }
    }
  }, [id, groups, loading]);

  const [settleLoading, setSettleLoading] = useState(false);
  const [settleFeedback, setSettleFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const groupSettlementSuggestions = useMemo(() => {
    if (!group) return [];
    const profileNamesById: Record<string, string> = {};
    for (const m of members) {
      if (m.full_name?.trim()) profileNamesById[m.user_id] = m.full_name.trim();
    }
    return buildSettlementSuggestionsForUser(allExpenses, session.user.id, {
      groupId: group.id,
      groupNameById: new Map([[group.id, group.name]]),
      profileNamesById,
    });
  }, [allExpenses, group, members, session.user.id]);

  useEffect(() => {
    if (!settleFeedback) return;
    const timeout = window.setTimeout(() => setSettleFeedback(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [settleFeedback]);

  const handleSettleUp = useCallback(async () => {
    if (!group) return;
    if (import.meta.env.DEV) {
      console.log('[group-settle] start', {
        groupId: group.id,
        suggestionCount: groupSettlementSuggestions.length,
        rows: groupSettlementSuggestions,
      });
    }
    setSettleLoading(true);
    setSettleFeedback(null);
    try {
      const rows = groupSettlementSuggestions.filter((r) => r.amount_cents > 0);
      if (rows.length === 0) {
        setSettleFeedback({ type: 'error', message: t('groupDetail.settleNothingToRecord') });
        return;
      }
      const now = new Date().toISOString();
      const payload = rows.map((row) => ({
        group_id: row.group_id,
        event_id: null as string | null,
        from_user_id: row.from_user_id,
        to_user_id: row.to_user_id,
        amount_cents: row.amount_cents,
        currency: 'EUR',
        settled_at: now,
        note: 'Group detail: settle up',
        created_by: session.user.id,
      }));
      if (import.meta.env.DEV) {
        console.log('[group-settle] insert payload', payload);
      }
      const { data: inserted, error } = await supabase.from('settlements').insert(payload).select('id');
      if (import.meta.env.DEV) {
        console.log('[group-settle] insert result', { inserted, error });
      }
      if (error) throw error;
      setSettleFeedback({ type: 'success', message: t('groupDetail.settleRecordedSuccess') });
      await Promise.all([refetchBalances(), refetchExpenses(), refetchBalancesZero()]);
      if (import.meta.env.DEV) {
        console.log('[group-settle] refetch done');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('groupDetail.settleRecordedError');
      setSettleFeedback({ type: 'error', message: msg });
      if (import.meta.env.DEV) console.error('[group-settle] failed', e);
    } finally {
      setSettleLoading(false);
    }
  }, [
    group,
    groupSettlementSuggestions,
    refetchBalances,
    refetchExpenses,
    refetchBalancesZero,
    session.user.id,
    t,
  ]);

  const handleRequestPayment = useCallback(
    async (targetUserId: string, amountCents: number, targetName: string) => {
      if (!group) return;
      if (requestingUserIds.has(targetUserId) || requestedUserIds.has(targetUserId)) return;

      setRequestingUserIds((prev) => {
        const next = new Set(prev);
        next.add(targetUserId);
        return next;
      });
      setRequestFeedback(null);

      try {
        const { data, error } = await supabase.functions.invoke('create-payment-request', {
          body: {
            group_id: group.id,
            target_user_id: targetUserId,
            amount_cents: amountCents,
            currency: (group as any).currency || 'EUR',
          },
        });
        if (error) throw error;
        if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
          throw new Error(String((data as { error: string }).error));
        }

        setRequestedUserIds((prev) => {
          const next = new Set(prev);
          next.add(targetUserId);
          return next;
        });
        setRequestFeedback({
          type: 'success',
          message: t('groupDetail.paymentRequestSentTo', { name: targetName }),
        });
      } catch (err: unknown) {
        if (import.meta.env.DEV) console.error('create-payment-request failed:', err);
        setRequestFeedback({
          type: 'error',
          message: t('groupDetail.paymentRequestFailed'),
        });
      } finally {
        setRequestingUserIds((prev) => {
          const next = new Set(prev);
          next.delete(targetUserId);
          return next;
        });
      }
    },
    [group, requestingUserIds, requestedUserIds, t],
  );

  const handleCreateEvent = async (
    title: string,
    description: string,
    groupId: string,
    status: 'open' | 'draft',
    startsAt: string,
    endsAt?: string | null,
  ) => {
    const result = await createEvent(title, description, groupId, status, startsAt, endsAt);
    if (result.success) {
      setCreateEventModalOpen(false);
      void refetchExpenses();
    }
    return result;
  };

  const handleInvite = async () => {
    if (!group) return;

    setIsInviteModalOpen(true);
    setInviteLoading(true);
    setInviteError(null);
    setInviteLink(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-invite', {
        body: { group_id: group.id },
      });

      if (fnError) throw fnError;
      if (!data?.invite_link) throw new Error(t('groupDetailPage.inviteLinkMissing'));

      setInviteLink(data.invite_link);
    } catch (err: any) {
      console.error('Error creating invite:', err);
      setInviteError(err.message || t('groupDetailPage.inviteFailed'));
    } finally {
      setInviteLoading(false);
    }
  };

  const canEditExpense = (expense: GroupExpenseRow) =>
    expense.created_by === session.user.id && (!expense.event || expense.event.status !== 'closed');

  const openEditExpense = (expense: GroupExpenseRow) => {
    if (!canEditExpense(expense)) return;
    setEditingExpense(expense);
    setEditTitle(expense.title);
    setEditAmount(formatFixedInput(expense.amount_cents / 100));
    setEditDescription(expense.description || '');
    const participantIds = (expense.splits || []).map((s) => s.user_id);
    setEditParticipantIds(participantIds.length ? participantIds : members.map((m) => m.user_id));
    const method = (expense.split_method === 'manual' || expense.split_method === 'percentage')
      ? expense.split_method
      : 'equal';
    setEditSplitMethod(method);
    setEditSettleAwareEnabled(false);
    setEditStatus(expense.status === 'draft' ? 'draft' : 'confirmed');
    const manualMap: Record<string, string> = {};
    const pctMap: Record<string, string> = {};
    for (const split of expense.splits || []) {
      manualMap[split.user_id] = formatFixedInput(split.share_cents / 100);
      if (split.percentage !== null && split.percentage !== undefined) {
        pctMap[split.user_id] = String(split.percentage);
      }
    }
    setEditManualShares(manualMap);
    setEditPercentageShares(pctMap);
    setEditError(null);
  };

  const closeEditExpense = () => {
    setEditingExpense(null);
    setEditSettleAwareEnabled(false);
    setEditError(null);
  };

  useEffect(() => {
    if (!group?.id || members.length === 0) {
      setEditDebtsToCurrentUser({});
      return;
    }
    const eligible = allExpenses
      .filter((row) => isAccountingEligibleExpenseRow(row as any))
      .map((row) => ({
        paid_by_user_id: row.paid_by_user_id,
        splits: row.splits?.map((s) => ({ user_id: s.user_id, share_cents: s.share_cents })),
      }));
    setEditDebtsToCurrentUser(
      computeDebtsToCurrentUser({
        members,
        currentUserId: session.user.id,
        eligibleExpenses: eligible,
      }),
    );
  }, [group?.id, members, allExpenses, session.user.id]);

  const handleEditExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;
    setEditError(null);

    const amountCents = Math.round(parseFloat(editAmount.replace(',', '.')) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setEditError(t('expenseForm.invalidAmount'));
      return;
    }

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setEditError(t('expenseForm.titleRequired'));
      return;
    }

    if (editParticipantIds.length === 0) {
      setEditError(t('groupExpense.noParticipants'));
      return;
    }

    let splits: Array<{ user_id: string; share_cents?: number; percentage?: number }> | undefined = undefined;
    if (editSplitMethod === 'manual') {
      const parsed = editParticipantIds.map((id) => ({
        user_id: id,
        share_cents: Math.round(parseFloat((editManualShares[id] ?? '').replace(',', '.')) * 100),
      }));
      if (parsed.some((row) => Number.isNaN(row.share_cents) || row.share_cents < 0)) {
        setEditError(t('groupExpense.invalidManualSplit'));
        return;
      }
      const totalManual = parsed.reduce((sum, row) => sum + row.share_cents, 0);
      if (totalManual !== amountCents) {
        setEditError(t('groupExpense.manualSplitTotalMismatch'));
        return;
      }
      splits = parsed;
    } else if (editSplitMethod === 'percentage') {
      const parsed = editParticipantIds.map((id) => ({
        user_id: id,
        percentage: parseFloat((editPercentageShares[id] ?? '').replace(',', '.')),
      }));
      if (parsed.some((row) => Number.isNaN(row.percentage) || row.percentage < 0)) {
        setEditError(t('groupExpense.invalidPercentageSplit'));
        return;
      }
      const totalPct = parsed.reduce((sum, row) => sum + row.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        setEditError(t('groupExpense.percentageSplitTotalMismatch'));
        return;
      }
      let allocated = 0;
      splits = parsed.map((row, index) => {
        if (index === parsed.length - 1) {
          return { user_id: row.user_id, percentage: row.percentage, share_cents: amountCents - allocated };
        }
        const share = Math.round(amountCents * (row.percentage / 100));
        allocated += share;
        return { user_id: row.user_id, percentage: row.percentage, share_cents: share };
      });
    } else if (editSplitMethod === 'equal' && editSettleAwareEnabled && editSettleAwareAvailable) {
      if (editSettlementSuggestion.applied) {
        splits = editParticipantIds.map((id) => ({ user_id: id, share_cents: editSettlementSuggestion.adjustedShares[id] || 0 }));
      }
    }

    const result = await updateExpense(editingExpense.id, {
      title: trimmedTitle,
      amount_cents: amountCents,
      description: editDescription.trim() ? editDescription.trim() : null,
      split_method:
        editSplitMethod === 'equal' && editSettleAwareEnabled && editSettleAwareAvailable ? 'manual' : editSplitMethod,
      participant_ids: editParticipantIds,
      splits,
      status: editStatus,
    });

    if (result.success) {
      closeEditExpense();
      void refetchBalances();
      void refetchBalancesZero();
    } else {
      setEditError(result.error || t('expenseForm.updateFailed'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-red-50 border border-red-100 rounded-3xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-red-600 mt-0.5" />
          <div>
            <p className="text-lg font-bold text-red-900">{t('groupDetailPage.loadError')}</p>
            <p className="text-red-700 mt-1">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/groups')}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
            >
              {t('groupDetailPage.backToGroups')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!group && !loading) {
    return (
      <div className="text-center py-20">
        <h3 className="text-xl font-bold text-slate-900 mb-2">{t('groupDetailPage.notFoundTitle')}</h3>
        <p className="text-slate-500 mb-6">{t('groupDetailPage.notFoundBody')}</p>
        <button
          type="button"
          onClick={() => navigate('/groups')}
          className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
        >
          {t('groupDetailPage.backToGroups')}
        </button>
      </div>
    );
  }

  if (!group) return null;

  return (
    <>
      <GroupDetail
        group={group}
        members={members}
        membersLoading={membersLoading}
        expenses={expenses}
        allExpenses={allExpenses}
        expensesLoading={expensesLoading}
        yourBalanceCents={myBalanceCents}
        balanceLoading={balanceLoading}
        balanceError={balanceError}
        membersError={membersError}
        currentUserId={session.user.id}
        canAddExpense={canAddExpense}
        addExpenseDisabledHint={addExpenseDisabledHint}
        onBack={() => navigate('/groups')}
        onSettleUp={handleSettleUp}
        settleActionLoading={settleLoading}
        settleFeedback={settleFeedback}
        onDismissSettleFeedback={() => setSettleFeedback(null)}
        onInvite={handleInvite}
        onNavigateToEvent={(eventId) => navigate(`/events/${eventId}`)}
        onOpenCreateEvent={() => setCreateEventModalOpen(true)}
        isOwner={isOwner}
        onManageGroup={() => setIsManageModalOpen(true)}
        onOpenAddExpense={() => {
          if (membersLoading || membersError || members.length === 0) return;
          setIsExpenseModalOpen(true);
        }}
        canEditExpense={canEditExpense}
        onEditExpense={openEditExpense}
        onRequestPayment={handleRequestPayment}
        requestingUserIds={requestingUserIds}
        requestedUserIds={requestedUserIds}
        requestFeedback={requestFeedback}
        inviteModalProps={{
          isOpen: isInviteModalOpen,
          onClose: () => setIsInviteModalOpen(false),
          inviteLink,
          loading: inviteLoading,
          error: inviteError,
        }}
        actionLoading={actionLoading}
        onRetryBalance={() => {
          void refetchBalances();
        }}
      />

      <Modal
        isOpen={createEventModalOpen}
        onClose={() => setCreateEventModalOpen(false)}
        title={t('events.createNewEvent')}
        size="lg"
      >
        <CreateEventForm
          groups={[group]}
          onSubmit={handleCreateEvent}
          onCancel={() => setCreateEventModalOpen(false)}
          loading={eventActionLoading}
        />
      </Modal>

      <Modal
        isOpen={Boolean(editingExpense)}
        onClose={closeEditExpense}
        title={t('expenseForm.editTitle')}
        size="lg"
      >
        <form onSubmit={handleEditExpenseSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('expenseForm.titleLabel')}
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder={t('expenseForm.titlePlaceholder')}
            />
            <Input
              label={t('expenseForm.amountLabel')}
              type="number"
              step="0.01"
              required
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Input
            label={t('expenseForm.descriptionLabel')}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder={t('expenseForm.descriptionPlaceholder')}
          />
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.expenseStatusLabel')}</label>
            <select
              className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as 'draft' | 'confirmed')}
            >
              <option value="draft">{t('groupExpense.expenseStatusDraft')}</option>
              <option value="confirmed">{t('groupExpense.expenseStatusConfirmed')}</option>
            </select>
            <p className="text-xs text-slate-500">{t('groupExpense.expenseStatusHint')}</p>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.participantsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <label
                  key={m.user_id}
                  className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer text-sm max-w-full"
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    checked={editParticipantIds.includes(m.user_id)}
                    onChange={() =>
                      setEditParticipantIds((prev) =>
                        prev.includes(m.user_id) ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                      )
                    }
                  />
                  <span className="font-medium text-slate-800 truncate">{m.full_name || m.user_id}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {editSplitMethod === 'equal' && editSettleAwareAvailable && (
              <div className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={editSettleAwareEnabled}
                    onChange={(e) => setEditSettleAwareEnabled(e.target.checked)}
                  />
                  {t('groupExpense.useToSettleBalances')}
                </label>
                <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesHint')}</p>
                <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesRule')}</p>
                {editSettleAwareEnabled && editSettlementSuggestion.applied && (
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                    <p className="font-semibold text-slate-700">{t('groupExpense.adjustedToSettleBalances')}</p>
                    <div className="mt-1 space-y-1">
                      {editParticipantIds.map((id) => {
                        const member = members.find((m) => m.user_id === id);
                        const name = member?.full_name || id;
                        const base = editSettlementSuggestion.baseShares[id] || 0;
                        const adjusted = editSettlementSuggestion.adjustedShares[id] || 0;
                        const delta = adjusted - base;
                        return (
                          <p key={id} className={delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-600'}>
                            {t('groupExpense.adjustedPreviewLine', { name, adjusted: formatMoney(adjusted), base: formatMoney(base) })}
                          </p>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-slate-500">{t('groupExpense.settleSuggestionNote')}</p>
                  </div>
                )}
              </div>
            )}
            <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.splitMethodLabel')}</label>
            <select
              className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
              value={editSplitMethod}
              onChange={(e) => {
                const nextMethod = e.target.value as 'equal' | 'manual' | 'percentage';
                if (nextMethod === 'manual') {
                  const next: Record<string, string> = {};
                  for (const id of editParticipantIds) {
                    const cents =
                      editSettleAwareEnabled && editSettlementSuggestion.applied
                        ? editSettlementSuggestion.adjustedShares[id] || 0
                        : editEqualSharesPreview[id] || 0;
                    next[id] = formatCentsAsDecimal(cents, { digits: 2 });
                  }
                  setEditManualShares(next);
                }
                setEditSplitMethod(nextMethod);
              }}
            >
              <option value="equal">{t('groupExpense.splitEqual')}</option>
              <option value="manual">{t('groupExpense.splitManual')}</option>
              <option value="percentage">{t('groupExpense.splitPercentage')}</option>
            </select>
          </div>
          {editSplitMethod === 'manual' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.manualSplitLabel')}</span>
              <div className="space-y-2">
                {members
                  .filter((m) => editParticipantIds.includes(m.user_id))
                  .map((m) => (
                    <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <span className="text-sm text-slate-800 flex-1 truncate">{m.full_name || m.user_id}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editManualShares[m.user_id] ?? ''}
                        onChange={(e) => setEditManualShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                        placeholder={(() => {
                          const count = editParticipantIds.length || 1;
                          return formatCentsAsDecimal(editAmountCentsPreview / count, { digits: 2 });
                        })()}
                        className="w-28 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                      />
                      {editSettleAwareEnabled && editEqualSharesPreview[m.user_id] != null && (
                        <span
                          className={`text-xs font-semibold ${
                            (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) >
                            (editEqualSharesPreview[m.user_id] || 0)
                              ? 'text-red-600'
                              : (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) <
                                  (editEqualSharesPreview[m.user_id] || 0)
                                ? 'text-emerald-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {(Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                            (editEqualSharesPreview[m.user_id] || 0) >
                          0
                            ? '+'
                            : ''}
                          {formatMoney(
                            Math.abs(
                              (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                                (editEqualSharesPreview[m.user_id] || 0),
                            ),
                          )}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
              <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                editManualDelta === 0
                  ? 'text-green-700 bg-green-50 border-green-200'
                  : editManualDelta > 0
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                {editManualDelta === 0
                  ? t('groupExpense.manualSplitExact')
                  : editManualDelta > 0
                    ? t('groupExpense.manualSplitMissing', { amount: formatMoney(editManualDelta) })
                    : t('groupExpense.manualSplitExcess', { amount: formatMoney(Math.abs(editManualDelta)) })}
              </p>
            </div>
          )}
          {editSplitMethod === 'percentage' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.percentageSplitLabel')}</span>
              <div className="space-y-2">
                {members
                  .filter((m) => editParticipantIds.includes(m.user_id))
                  .map((m) => (
                    <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <span className="text-sm text-slate-800 flex-1 truncate">{m.full_name || m.user_id}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editPercentageShares[m.user_id] ?? ''}
                        onChange={(e) => setEditPercentageShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                        placeholder="0"
                        className="w-20 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  ))}
              </div>
              <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                Math.abs(editPercentageDelta) < 0.01
                  ? 'text-green-700 bg-green-50 border-green-200'
                  : editPercentageDelta > 0
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                {Math.abs(editPercentageDelta) < 0.01
                  ? t('groupExpense.percentageSplitExact')
                  : editPercentageDelta > 0
                    ? t('groupExpense.percentageSplitMissing', { value: formatDecimal(editPercentageDelta, { locale: 'pt-PT', digits: 2 }) })
                    : t('groupExpense.percentageSplitExcess', { value: formatDecimal(Math.abs(editPercentageDelta), { locale: 'pt-PT', digits: 2 }) })}
              </p>
            </div>
          )}
          {editError && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              {editError}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={closeEditExpense} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={expenseActionLoading} className="flex-[2]">
              {t('expenseForm.saveChanges')}
            </Button>
          </div>
        </form>
      </Modal>

      <CreateExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        groupId={group.id}
        session={session}
        members={members}
        membersLoading={membersLoading}
        membersError={membersError}
        actionLoading={expenseActionLoading}
        createExpense={createExpense}
        onExpenseCreated={() => {
          void refetchBalances();
          void refetchBalancesZero();
        }}
      />

      <ManageGroupModal
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        group={group}
        actionLoading={actionLoading}
        updateGroup={updateGroup}
        archiveGroup={archiveGroup}
        allBalancesZero={allBalancesZero}
        balancesLoading={balancesZeroLoading}
        balancesError={balancesZeroError}
        onUpdated={() => void fetchGroups()}
        onArchived={() => navigate('/groups')}
      />
    </>
  );
}
