import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useGroups } from '../../hooks/useGroups';
import { GroupExpenseRow, useGroupExpenses } from '../../hooks/useGroupExpenses';
import { useGroupMembers, memberLabel } from '../../hooks/useGroupMembers';
import { useGroupBalances } from '../../hooks/useGroupBalances';
import { useGroupAllBalancesZero } from '../../hooks/useGroupAllBalancesZero';
import { useEvents } from '../../hooks/useEvents';
import { GroupDetail } from './components/GroupDetail';
import { CreateExpenseModal } from './components/CreateExpenseModal';
import { ManageGroupModal } from './components/ManageGroupModal';
import { CreateEventForm } from '../events/components/CreateEventForm';
import type { Group } from '../../dbAliases';
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
import {
  notifyExpensesChanged,
  EXPENSES_CHANGED_EVENT,
  expensesChangedAffectsGroup,
} from '../../lib/expenseEvents';
import { getOnboardingState, updateOnboardingState } from '../../lib/onboardingState';
import { trackProductEvent } from '../../lib/productTracking';
import {
  buildExpenseReceiptObjectPath,
  removeExpenseReceiptObject,
  uploadExpenseReceiptObject,
} from '../../lib/expenseReceiptStorage';
import { useExpenseReceiptSignedUrl } from '../../hooks/useExpenseReceiptSignedUrl';
import { ExpenseReceiptSection } from '../expenses/components/ExpenseReceiptSection';
import { MemberAvatar } from '../../components/MemberAvatar';
import {
  PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK,
  SCAN_RECEIPT_FEATURE_KEY,
  useBillingGuard,
} from '../billing';

type GroupSettlementRow = {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  settled_at: string;
};

type ActiveBatchPreview = {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  closed_at: string | null;
  created_at: string | null;
};

interface GroupDetailPageProps {
  session: Session;
}

export function GroupDetailPage({ session }: GroupDetailPageProps) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [showOnboardingNextExpenseBanner, setShowOnboardingNextExpenseBanner] = useState(
    Boolean((location.state as { onboardingNextExpense?: boolean } | null)?.onboardingNextExpense),
  );
  const [firstExpenseSuccessBanner, setFirstExpenseSuccessBanner] = useState(false);
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
  const editReceiptAttachmentInputRef = useRef<HTMLInputElement>(null);
  const editReceiptPreviewObjectUrlRef = useRef<string | null>(null);
  const [editReceiptFile, setEditReceiptFile] = useState<File | null>(null);
  const [editReceiptPreviewUrl, setEditReceiptPreviewUrl] = useState<string | null>(null);
  const [editReceiptRemoved, setEditReceiptRemoved] = useState(false);
  const billing = useBillingGuard();
  const [settlements, setSettlements] = useState<GroupSettlementRow[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [activeBatchPreview, setActiveBatchPreview] = useState<ActiveBatchPreview | null>(null);
  const onboardingState = getOnboardingState();
  const showSettlementHint = onboardingState.hasCreatedExpense && myBalanceCents > 0 && !onboardingState.hasSeenSettlementHint;
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

  const revokeEditReceiptPreview = useCallback(() => {
    if (editReceiptPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(editReceiptPreviewObjectUrlRef.current);
      editReceiptPreviewObjectUrlRef.current = null;
    }
    setEditReceiptPreviewUrl(null);
  }, []);

  const applyEditReceiptFile = useCallback(
    (file: File | null) => {
      revokeEditReceiptPreview();
      setEditReceiptFile(file);
      setEditReceiptRemoved(false);
      if (file) {
        const url = URL.createObjectURL(file);
        editReceiptPreviewObjectUrlRef.current = url;
        setEditReceiptPreviewUrl(url);
      }
    },
    [revokeEditReceiptPreview],
  );

  const handleEditReceiptAttachmentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      applyEditReceiptFile(file);
    },
    [applyEditReceiptFile],
  );

  const handleEditRemoveReceipt = useCallback(() => {
    if (editReceiptFile) {
      applyEditReceiptFile(null);
      return;
    }
    setEditReceiptRemoved(true);
  }, [editReceiptFile, applyEditReceiptFile]);

  const handleEditOcrInterestClick = useCallback(() => {
    void trackProductEvent(PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK, {
      metadata: {
        featureKey: SCAN_RECEIPT_FEATURE_KEY,
        source: 'group',
        subscription_tier: billing.tier,
        feature_unreleased: true,
      },
    });
    void billing.guardAndRun(SCAN_RECEIPT_FEATURE_KEY, () => {}, {
      interestSource: 'group',
    });
  }, [billing.guardAndRun, billing.tier]);

  const storedReceiptPathForPreview =
    editingExpense?.receipt_path && !editReceiptRemoved ? editingExpense.receipt_path : null;
  const storedReceiptSignedUrl = useExpenseReceiptSignedUrl(storedReceiptPathForPreview);

  const refetchActiveBatch = useCallback(async () => {
    if (!group?.id) {
      setActiveBatchPreview(null);
      return;
    }

    try {
      const { data, error: qError } = await supabase
        .from('expense_batches')
        .select('id, title, description, is_active, closed_at, created_at')
        .eq('group_id', group.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (qError) throw qError;
      setActiveBatchPreview((data as ActiveBatchPreview | null) ?? null);
    } catch (err) {
      console.error('Failed to load active batch preview:', err);
      setActiveBatchPreview(null);
    }
  }, [group?.id]);

  useEffect(() => {
    return () => {
      if (editReceiptPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(editReceiptPreviewObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void refetchActiveBatch();
  }, [refetchActiveBatch]);

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
  const [closeBatchLoading, setCloseBatchLoading] = useState(false);
  const [closeBatchModalOpen, setCloseBatchModalOpen] = useState(false);
  const [newCycleTitleInput, setNewCycleTitleInput] = useState('');
  const [closeBatchModalError, setCloseBatchModalError] = useState<string | null>(null);

  const refetchSettlements = useCallback(async () => {
    if (!group?.id) {
      setSettlements([]);
      setSettlementsError(null);
      return;
    }
  
    setSettlementsLoading(true);
    setSettlementsError(null);
  
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, group_id, from_user_id, to_user_id, amount_cents, settled_at')
        .eq('group_id', group.id)
        .order('settled_at', { ascending: false });
  
      if (error) throw error;
  
      setSettlements((data || []) as GroupSettlementRow[]);
    } catch (err: unknown) {
      console.error('Failed to load settlements:', err);
      setSettlements([]);
      setSettlementsError(err instanceof Error ? err.message : 'Failed to load settlements');
    } finally {
      setSettlementsLoading(false);
    }
  }, [group?.id]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ groupId?: string | null }>;
      const changedGroupId = customEvent.detail?.groupId;
  
      if (!group?.id) return;
      if (changedGroupId && changedGroupId !== group.id) return;
  
      void Promise.all([
        refetchBalances(),
        refetchBalancesZero(),
        refetchExpenses(),
        refetchSettlements(),
      ]);
    };
  
    window.addEventListener('group-settlement-confirmed', handler as EventListener);
  
    return () => {
      window.removeEventListener('group-settlement-confirmed', handler as EventListener);
    };
  }, [
    group?.id,
    refetchBalances,
    refetchBalancesZero,
    refetchExpenses,
    refetchSettlements,
  ]);

  useEffect(() => {
    const onExpensesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string | null }>).detail;

      if (!group?.id) return;
      if (!expensesChangedAffectsGroup(detail, group.id)) return;

      void Promise.all([
        refetchBalances(),
        refetchBalancesZero(),
        refetchExpenses(),
        refetchSettlements(),
      ]);
    };

    window.addEventListener(EXPENSES_CHANGED_EVENT, onExpensesChanged);

    return () => {
      window.removeEventListener(EXPENSES_CHANGED_EVENT, onExpensesChanged);
    };
  }, [
    group?.id,
    refetchBalances,
    refetchBalancesZero,
    refetchExpenses,
    refetchSettlements,
  ]);
  
  useEffect(() => {
    void refetchSettlements();
  }, [refetchSettlements]);

  useEffect(() => {
    if (!settleFeedback) return;
    const timeout = window.setTimeout(() => setSettleFeedback(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [settleFeedback]);

  const handleSettleUp = useCallback(
    async (targetUserId?: string, amountCents?: number, targetName?: string) => {
      if (!group) return;
  
      setSettleLoading(true);
      setSettleFeedback(null);
  
      try {
        if (!targetUserId || !amountCents || amountCents <= 0) {
          setSettleFeedback({
            type: 'error',
            message: t('groupDetail.settleNothingToRecord'),
          });
          return;
        }
  
        const { data, error } = await supabase.functions.invoke(
          'create-settlement-confirmation-request',
          {
            body: {
              group_id: group.id,
              target_user_id: targetUserId,
              amount_cents: amountCents,
              currency: 'EUR',
            },
          }
        );
  
        if (error) throw error;
        if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
          throw new Error(String((data as { error: string }).error));
        }
  
        setSettleFeedback({
          type: 'success',
          message: targetName
            ? `Pedido de confirmação enviado a ${targetName}.`
            : 'Pedido de confirmação enviado.',
        });
  
        notifyExpensesChanged({ groupId: group.id });
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : 'Não foi possível pedir confirmação do pagamento.';
  
        setSettleFeedback({
          type: 'error',
          message: msg,
        });
  
        if (import.meta.env.DEV) {
          console.error('[group-settle] failed', e);
        }
      } finally {
        setSettleLoading(false);
      }
    },
    [group, t],
  );

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
        // Funnel: user sent a payment request to settle balances.
        void trackProductEvent('payment_request_sent', {
          entity_type: 'group',
          entity_id: group.id,
          metadata: { targetUserId, amountCents },
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

  const openCloseBatchModal = useCallback(() => {
    setCloseBatchModalError(null);
    const dateStr = new Date().toISOString().slice(0, 10);
    setNewCycleTitleInput(t('groupDetail.closeBatchSuggestedTitle', { date: dateStr }));
    setCloseBatchModalOpen(true);
  }, [t]);

  const closeCloseBatchModal = useCallback(() => {
    setCloseBatchModalOpen(false);
    setCloseBatchModalError(null);
  }, []);

  const confirmCloseCurrentBatch = useCallback(async () => {
    if (!group?.id) return;
    const trimmed = newCycleTitleInput.trim();
    const fallbackTitle = `Cycle ${new Date().toISOString().slice(0, 10)}`;
    const title = trimmed || fallbackTitle;
    setCloseBatchLoading(true);
    setCloseBatchModalError(null);
    try {
      const { error } = await supabase.rpc('close_current_batch_and_open_new', {
        p_group_id: group.id,
        p_created_by: session.user.id,
        p_new_title: title,
      });
      if (error) throw error;

      await Promise.all([
        refetchExpenses(),
        refetchActiveBatch(),
        refetchBalances(),
        refetchBalancesZero(),
      ]);
      notifyExpensesChanged({ groupId: group.id });
      closeCloseBatchModal();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : t('groupDetail.closeBatchFailed');
      setCloseBatchModalError(msg);
      console.error('close_current_batch_and_open_new failed:', err);
    } finally {
      setCloseBatchLoading(false);
    }
  }, [
    closeCloseBatchModal,
    group?.id,
    newCycleTitleInput,
    refetchBalances,
    refetchBalancesZero,
    refetchActiveBatch,
    refetchExpenses,
    session.user.id,
    t,
  ]);

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
    // Funnel: user opened invite sharing flow.
    void trackProductEvent('invite_modal_opened', { entity_type: 'group', entity_id: group.id });

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
    (
      expense.created_by === session.user.id ||
      expense.paid_by_user_id === session.user.id
    ) &&
    (!expense.event || expense.event.status !== 'closed');

  const openEditExpense = (expense: GroupExpenseRow) => {
    console.log('[group-edit] canEditExpense?', {
      expenseId: expense.id,
      created_by: expense.created_by,
      paid_by_user_id: expense.paid_by_user_id,
      currentUserId: session.user.id,
      eventStatus: expense.event?.status,
    });
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
    applyEditReceiptFile(null);
    setEditReceiptRemoved(false);
  };

  const closeEditExpense = () => {
    revokeEditReceiptPreview();
    setEditReceiptFile(null);
    setEditReceiptRemoved(false);
    setEditingExpense(null);
    setEditSettleAwareEnabled(false);
    setEditError(null);
  };

  useEffect(() => {
    if (myBalanceCents !== 0) {
      // Funnel: first time user sees meaningful balance in a group.
      void trackProductEvent('first_balance_seen', { once_key: 'first_balance_seen' });
    }
  }, [myBalanceCents]);

  useEffect(() => {
    if (!showSettlementHint) return;
    // Funnel: user saw settlement education hint after getting positive balance.
    void trackProductEvent('first_settlement_hint_seen', { once_key: 'first_settlement_hint_seen' });
    updateOnboardingState({ hasSeenSettlementHint: true });
  }, [showSettlementHint]);

  useEffect(() => {
    void refetchSettlements();
  }, [refetchSettlements]);

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

    let receipt_path: string | null | undefined = undefined;
    let receipt_filename: string | null | undefined = undefined;
    let receipt_mime_type: string | null | undefined = undefined;
    let receipt_size_bytes: number | null | undefined = undefined;
    if (editReceiptFile) {
      const path = buildExpenseReceiptObjectPath(editingExpense.group_id, editingExpense.id, editReceiptFile);
      const up = await uploadExpenseReceiptObject(supabase, path, editReceiptFile);
      if (up.error) {
        setEditError(t('expenseForm.receiptUploadFailedEdit'));
        return;
      }
      receipt_path = path;
      receipt_filename = editReceiptFile.name;
      receipt_mime_type = editReceiptFile.type || null;
      receipt_size_bytes = editReceiptFile.size;
    } else if (editReceiptRemoved && editingExpense.receipt_path) {
      receipt_path = null;
    }

    const updatePayload: Parameters<typeof updateExpense>[1] = {
      title: trimmedTitle,
      amount_cents: amountCents,
      description: editDescription.trim() ? editDescription.trim() : null,
      split_method:
        editSplitMethod === 'equal' && editSettleAwareEnabled && editSettleAwareAvailable ? 'manual' : editSplitMethod,
      participant_ids: editParticipantIds,
      splits,
      status: editStatus,
    };
    if (receipt_path !== undefined) {
      updatePayload.receipt_path = receipt_path;
    }
    if (receipt_filename !== undefined) {
      updatePayload.receipt_filename = receipt_filename;
    }
    if (receipt_mime_type !== undefined) {
      updatePayload.receipt_mime_type = receipt_mime_type;
    }
    if (receipt_size_bytes !== undefined) {
      updatePayload.receipt_size_bytes = receipt_size_bytes;
    }

    const result = await updateExpense(editingExpense.id, updatePayload);

    if (result.success) {
      const prevPath = editingExpense.receipt_path;
      if (receipt_path && prevPath && prevPath !== receipt_path) {
        await removeExpenseReceiptObject(supabase, prevPath);
      }
      if (receipt_path === null && prevPath) {
        await removeExpenseReceiptObject(supabase, prevPath);
      }
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

  const isEditingGroupWideExpense = Boolean(editingExpense && !editingExpense.event_id);

  return (
    <>
      <GroupDetail
        group={group}
        members={members}
        membersLoading={membersLoading}
        expenses={expenses}
        allExpenses={allExpenses}
        activeBatchPreview={activeBatchPreview}
        settlements={settlements}
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
          if (!getOnboardingState().hasCreatedExpense) {
            // Funnel: first intent signal that user started adding an expense.
            void trackProductEvent('first_expense_started', { once_key: 'first_expense_started' });
          }
          setIsExpenseModalOpen(true);
        }}
        onOpenCloseBatchModal={isOwner ? openCloseBatchModal : undefined}
        closingCurrentBatch={closeBatchLoading}
        showOnboardingNextExpenseBanner={showOnboardingNextExpenseBanner}
        onDismissOnboardingNextExpenseBanner={() => setShowOnboardingNextExpenseBanner(false)}
        highlightAddExpenseCta={showOnboardingNextExpenseBanner && !onboardingState.hasCreatedExpense}
        showSettlementHint={showSettlementHint}
        showFirstExpenseSuccessBanner={firstExpenseSuccessBanner}
        onDismissFirstExpenseSuccessBanner={() => setFirstExpenseSuccessBanner(false)}
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
        isOpen={closeBatchModalOpen}
        onClose={closeCloseBatchModal}
        title={t('groupDetail.closeBatchModalTitle')}
        size="md"
        closable={!closeBatchLoading}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('groupDetail.closeBatchModalBody')}</p>
          <Input
            id="new-cycle-title"
            label={t('groupDetail.newCycleTitleLabel')}
            value={newCycleTitleInput}
            onChange={(e) => setNewCycleTitleInput(e.target.value)}
            placeholder={t('groupDetail.newCycleTitlePlaceholder')}
            disabled={closeBatchLoading}
          />
          {closeBatchModalError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {closeBatchModalError}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={closeCloseBatchModal}
              disabled={closeBatchLoading}
            >
              {t('groupDetail.closeBatchModalCancel')}
            </Button>
            <Button type="button" className="flex-[2]" loading={closeBatchLoading} onClick={() => void confirmCloseCurrentBatch()}>
              {t('groupDetail.closeBatchModalConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

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
          {isEditingGroupWideExpense && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {t('expenseForm.groupWideEditLockedHint')}
            </div>
          )}
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
              readOnly={isEditingGroupWideExpense}
              className={isEditingGroupWideExpense ? 'bg-slate-100 cursor-not-allowed' : ''}
            />
          </div>
          <Input
            label={t('expenseForm.descriptionLabel')}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder={t('expenseForm.descriptionPlaceholder')}
          />
          <ExpenseReceiptSection
            attachmentInputRef={editReceiptAttachmentInputRef}
            receiptFile={editReceiptFile}
            receiptPreviewUrl={editReceiptPreviewUrl}
            storedReceiptPreviewUrl={storedReceiptSignedUrl}
            onAttachmentInputChange={handleEditReceiptAttachmentChange}
            onRemoveReceipt={handleEditRemoveReceipt}
            onOcrInterestClick={handleEditOcrInterestClick}
            disablePhoto={expenseActionLoading}
            disableOcr={expenseActionLoading}
            scanReceiptInterestUserId={session.user.id}
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
            {isEditingGroupWideExpense ? (
              <>
                <p className="text-xs text-slate-500">{t('groupExpense.groupWideParticipantsHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {editParticipantIds.map((id) => {
                    const m = members.find((x) => x.user_id === id);
                    if (!m) {
                      return (
                        <div
                          key={id}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 text-sm text-slate-600"
                        >
                          {id}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={id}
                        className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 text-sm max-w-full"
                      >
                        <MemberAvatar
                          userId={m.user_id}
                          fullName={m.full_name}
                          avatarUrl={m.avatar_url}
                          size="sm"
                        />
                        <span className="font-medium text-slate-800 truncate">{memberLabel(m)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
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
                    <span className="font-medium text-slate-800 truncate">{memberLabel(m)}</span>
                  </label>
                ))}
              </div>
            )}
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
                        const name = member ? memberLabel(member) : id;
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
                      <span className="text-sm text-slate-800 flex-1 truncate">{memberLabel(m)}</span>
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
                      <span className="text-sm text-slate-800 flex-1 truncate">{memberLabel(m)}</span>
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
          const hadCreatedBefore = getOnboardingState().hasCreatedExpense;
          if (!hadCreatedBefore) {
            // Funnel: first expense completion in group context.
            void trackProductEvent('first_expense_created', { once_key: 'first_expense_created' });
            updateOnboardingState({ hasCreatedExpense: true });
            setFirstExpenseSuccessBanner(true);
          }
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
