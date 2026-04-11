import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { GroupMemberRow, memberLabel } from '../../../hooks/useGroupMembers';
import { MemberAvatar } from '../../../components/MemberAvatar';
import { CreateExpenseInput } from '../../../hooks/useGroupExpenses';
import { formatCentsAsDecimal, formatCurrencyCents, formatDecimal } from '../../../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../../../lib/accountingExpenses';
import { supabase } from '../../../lib/supabase';
import { EXPENSES_CHANGED_EVENT, expensesChangedAffectsGroup } from '../../../lib/expenseEvents';
import {
  buildEqualSharesCents,
  canApplySettlementAwareEqualSplit,
  computeDebtsToCurrentUser,
  getSettlementAwareManualSubmitSplits,
  runSettlementAwareSelfChecks,
  suggestSettlementAwareEqualSplit,
} from '../../../lib/settlementSplit';
import { getOnboardingState } from '../../../lib/onboardingState';
import { trackProductEvent } from '../../../lib/productTracking';
import { persistReceiptAfterExpenseCreate } from '../../../lib/expenseReceiptStorage';
import { ExpenseReceiptSection } from '../../expenses/components/ExpenseReceiptSection';
import { ExpenseDictationMicButton } from '../../expenses/components/ExpenseDictationMicButton';
import { getSpeechRecognitionLanguage, useSpeechToText } from '../../../hooks/useSpeechToText';
import {
  clearPendingResumeFeatureAfterCheckout,
  PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK,
  readPendingResumeFeatureAfterCheckout,
  registerPremiumResumeHandler,
  SCAN_RECEIPT_FEATURE_KEY,
  useBillingGuard,
} from '../../billing';

interface CreateExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  session: Session;
  members: GroupMemberRow[];
  membersLoading: boolean;
  membersError: string | null;
  actionLoading: boolean;
  createExpense: (input: CreateExpenseInput) => Promise<{ success: boolean; error?: string }>;
  /** Called after an expense is created successfully (e.g. refresh balances). */
  onExpenseCreated?: () => void;
}

export function CreateExpenseModal({
  isOpen,
  onClose,
  groupId,
  session,
  members,
  membersLoading,
  membersError,
  actionLoading,
  createExpense,
  onExpenseCreated,
}: CreateExpenseModalProps) {
  runSettlementAwareSelfChecks();
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [splitMethod, setSplitMethod] = useState<'equal' | 'manual' | 'percentage'>('equal');
  const [settleAwareEnabled, setSettleAwareEnabled] = useState(false);
  const [debtsToCurrentUser, setDebtsToCurrentUser] = useState<Record<string, number>>({});
  const [manualShares, setManualShares] = useState<Record<string, string>>({});
  const [percentageShares, setPercentageShares] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [expenseStatus, setExpenseStatus] = useState<'draft' | 'confirmed'>('confirmed');
  const receiptAttachmentInputRef = useRef<HTMLInputElement>(null);
  const receiptPreviewObjectUrlRef = useRef<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const billing = useBillingGuard();
  const userId = session?.user?.id;

  const speech = useSpeechToText();
  const speechLang = useMemo(() => getSpeechRecognitionLanguage(i18n.language), [i18n.language]);
  const [dictationField, setDictationField] = useState<'title' | 'description' | null>(null);

  useEffect(() => {
    if (!speech.isListening) setDictationField(null);
  }, [speech.isListening]);

  useEffect(() => {
    if (!isOpen) {
      speech.stopListening();
    }
  }, [isOpen, speech.stopListening]);

  const appendDictated = useCallback((current: string, chunk: string) => {
    const t = chunk.trim();
    if (!t) return current;
    const p = current.trim();
    return p ? `${p} ${t}` : t;
  }, []);

  const toggleTitleDictation = useCallback(() => {
    if (!speech.isSupported) return;
    if (speech.isListening && dictationField === 'title') {
      speech.stopListening();
      return;
    }
    setDictationField('title');
    speech.startListening((text) => {
      setTitle((prev) => appendDictated(prev, text));
    }, speechLang);
  }, [speech, dictationField, speechLang, appendDictated]);

  const toggleDescriptionDictation = useCallback(() => {
    if (!speech.isSupported) return;
    if (speech.isListening && dictationField === 'description') {
      speech.stopListening();
      return;
    }
    setDictationField('description');
    speech.startListening((text) => {
      setDescription((prev) => appendDictated(prev, text));
    }, speechLang);
  }, [speech, dictationField, speechLang, appendDictated]);

  const revokeReceiptPreview = useCallback(() => {
    if (receiptPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(receiptPreviewObjectUrlRef.current);
      receiptPreviewObjectUrlRef.current = null;
    }
    setReceiptPreviewUrl(null);
  }, []);

  const applyReceiptFile = useCallback(
    (file: File | null) => {
      revokeReceiptPreview();
      setReceiptFile(file);
      if (file) {
        const url = URL.createObjectURL(file);
        receiptPreviewObjectUrlRef.current = url;
        setReceiptPreviewUrl(url);
      }
    },
    [revokeReceiptPreview],
  );

  const handleReceiptAttachmentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      applyReceiptFile(file);
    },
    [applyReceiptFile],
  );

  const handleRemoveReceipt = useCallback(() => {
    applyReceiptFile(null);
  }, [applyReceiptFile]);

  useEffect(
    () => () => {
      if (receiptPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(receiptPreviewObjectUrlRef.current);
      }
    },
    [],
  );

  const handleOcrInterestClick = useCallback(() => {
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

  useEffect(() => {
    return registerPremiumResumeHandler(SCAN_RECEIPT_FEATURE_KEY, () => {});
  }, []);

  useEffect(() => {
    const pending = readPendingResumeFeatureAfterCheckout();
    if (pending === SCAN_RECEIPT_FEATURE_KEY) {
      clearPendingResumeFeatureAfterCheckout();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setAmount('');
    setFormError(null);
    setExpenseStatus('confirmed');
    setSplitMethod('equal');
    setSettleAwareEnabled(false);
    setManualShares({});
    setPercentageShares({});
    if (members.length > 0) {
      setParticipantIds(members.map((m) => m.user_id));
    } else {
      setParticipantIds([]);
    }
  }, [isOpen, userId, members, groupId]);

  useEffect(() => {
    if (!isOpen) return;
    applyReceiptFile(null);
    // Only when `isOpen` becomes true — do not re-run when `applyReceiptFile` identity changes (would clear a user-selected file).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadDebtsToCurrentUser = useCallback(async () => {
    if (!isOpen || !groupId || !userId || members.length === 0) {
      setDebtsToCurrentUser({});
      return;
    }
    const { data, error } = await supabase
      .from('expenses')
      .select('id, paid_by_user_id, status, event:events(status), splits:expense_splits(user_id, share_cents)')
      .eq('group_id', groupId)
      .is('deleted_at', null);
    if (error) {
      setDebtsToCurrentUser({});
      return;
    }
    const eligible = (data || []).filter((row) => isAccountingEligibleExpenseRow(row as any)) as Array<{
      paid_by_user_id: string;
      splits?: Array<{ user_id: string; share_cents: number }>;
    }>;
    setDebtsToCurrentUser(
      computeDebtsToCurrentUser({
        members,
        currentUserId: userId,
        eligibleExpenses: eligible,
      }),
    );
  }, [isOpen, groupId, members, userId]);

  useEffect(() => {
    void loadDebtsToCurrentUser();
  }, [loadDebtsToCurrentUser]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{ groupId?: string }>).detail;
      if (!expensesChangedAffectsGroup(detail, groupId)) return;
      void loadDebtsToCurrentUser();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [groupId, loadDebtsToCurrentUser]);

  const toggleParticipant = (userId: string) => {
    setParticipantIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!userId) {
      setFormError(t('expenseForm.createFailed'));
      return;
    }

    const trimmed = title.trim();
    if (!trimmed) {
      setFormError(t('groupExpense.titleRequired'));
      return;
    }

    const euros = parseFloat(amount.replace(',', '.'));
    const amountCents = Math.round(euros * 100);
    if (Number.isNaN(euros) || amountCents <= 0) {
      setFormError(t('groupExpense.invalidAmount'));
      return;
    }

    if (participantIds.length === 0) {
      setFormError(t('groupExpense.noParticipants'));
      return;
    }

    const selectedParticipantIds = participantIds;
    let splits: Array<{ user_id: string; share_cents?: number; percentage?: number }> | undefined = undefined;
    let effectiveSplitMethod: 'equal' | 'manual' | 'percentage' = splitMethod;
    if (splitMethod === 'manual') {
      const selected = selectedParticipantIds.map((id) => ({
        user_id: id,
        value: manualShares[id] ?? '',
      }));
      const parsed = selected.map((row) => ({
        user_id: row.user_id,
        share_cents: Math.round(parseFloat(row.value.replace(',', '.')) * 100),
      }));
      if (parsed.some((row) => Number.isNaN(row.share_cents) || row.share_cents < 0)) {
        setFormError(t('groupExpense.invalidManualSplit'));
        return;
      }
      const totalManual = parsed.reduce((sum, row) => sum + row.share_cents, 0);
      if (totalManual !== amountCents) {
        setFormError(t('groupExpense.manualSplitTotalMismatch'));
        return;
      }
      splits = parsed;
    } else if (splitMethod === 'percentage') {
      const selected = selectedParticipantIds.map((id) => ({
        user_id: id,
        value: percentageShares[id] ?? '',
      }));
      const parsed = selected.map((row) => ({
        user_id: row.user_id,
        percentage: parseFloat(row.value.replace(',', '.')),
      }));
      if (parsed.some((row) => Number.isNaN(row.percentage) || row.percentage < 0)) {
        setFormError(t('groupExpense.invalidPercentageSplit'));
        return;
      }
      const totalPct = parsed.reduce((sum, row) => sum + row.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        setFormError(t('groupExpense.percentageSplitTotalMismatch'));
        return;
      }
      let allocated = 0;
      splits = parsed.map((row, index) => {
        if (index === parsed.length - 1) {
          return {
            user_id: row.user_id,
            percentage: row.percentage,
            share_cents: amountCents - allocated,
          };
        }
        const share = Math.round(amountCents * (row.percentage / 100));
        allocated += share;
        return {
          user_id: row.user_id,
          percentage: row.percentage,
          share_cents: share,
        };
      });
    } else if (splitMethod === 'equal') {
      const settleSubmit = getSettlementAwareManualSubmitSplits({
        amountCents,
        participantIds,
        payerId: userId,
        debtsToPayer: debtsToCurrentUser,
        settleAwareEnabled,
        splitMethod,
      });
      if (import.meta.env.DEV && settleAwareEnabled) {
        console.log('[create-expense][settlement-aware]', {
          amountCents,
          baseShares: settleSubmit.suggestion.baseShares,
          adjustedShares: settleSubmit.suggestion.adjustedShares,
          applied: settleSubmit.suggestion.applied,
          reason: settleSubmit.suggestion.reason,
        });
      }
      if (settleSubmit.splits) {
        splits = settleSubmit.splits;
        effectiveSplitMethod = settleSubmit.effectiveSplitMethod;
      }
    }

    const result = await createExpense({
      title: trimmed,
      description: description.trim() || undefined,
      amount_cents: amountCents,
      paid_by_user_id: userId,
      participant_ids: participantIds,
      split_method: effectiveSplitMethod,
      splits,
      status: expenseStatus,
    });

    if (result.success) {
      if (settleAwareEnabled) {
        // Funnel: settle-aware split actually saved in a group expense flow.
        void trackProductEvent('smart_settlement_applied', {
          entity_type: 'group',
          entity_id: groupId,
          metadata: { split_method: effectiveSplitMethod, suggestionApplied: settlementSuggestion.applied },
        });
      }
      if (receiptFile && result.expenseId && session.access_token) {
        const receiptResult = await persistReceiptAfterExpenseCreate({
          supabase,
          accessToken: session.access_token,
          groupId,
          expenseId: result.expenseId,
          file: receiptFile,
        });
        if (receiptResult.error) {
          setFormError(t('expenseForm.receiptUploadFailed'));
          onExpenseCreated?.();
          return;
        }
      }
      applyReceiptFile(null);
      onExpenseCreated?.();
      onClose();
    } else {
      setFormError(result.error || 'Error');
    }
  };

  const disabled =
    membersLoading || !!membersError || members.length === 0 || actionLoading;
  const amountCentsPreview = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100);
  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale: i18n.language });
  const equalSharesPreview = useMemo(() => {
    const selectedIds = members.filter((m) => participantIds.includes(m.user_id)).map((m) => m.user_id);
    return buildEqualSharesCents(selectedIds, amountCentsPreview);
  }, [members, participantIds, amountCentsPreview]);
  const settleAwareAvailable = useMemo(
    () => canApplySettlementAwareEqualSplit({
      splitMethod: 'equal',
      participantIds,
      payerId: userId ?? '',
      debtsToPayer: debtsToCurrentUser,
    }),
    [participantIds, userId, debtsToCurrentUser],
  );
  const settlementSuggestion = useMemo(
    () =>
      suggestSettlementAwareEqualSplit({
        amountCents: amountCentsPreview,
        participantIds,
        payerId: userId ?? '',
        debtsToPayer: debtsToCurrentUser,
        enabled: settleAwareEnabled,
        splitMethod,
      }),
    [amountCentsPreview, participantIds, userId, debtsToCurrentUser, settleAwareEnabled, splitMethod],
  );
  const manualTotal = participantIds.reduce((sum, id) => {
    const cents = Math.round(parseFloat((manualShares[id] ?? '').replace(',', '.')) * 100);
    return sum + (Number.isNaN(cents) ? 0 : cents);
  }, 0);
  const manualDelta = amountCentsPreview - manualTotal;
  const percentageTotal = participantIds.reduce((sum, id) => {
    const pct = parseFloat((percentageShares[id] ?? '').replace(',', '.'));
    return sum + (Number.isNaN(pct) ? 0 : pct);
  }, 0);
  const percentageDelta = 100 - percentageTotal;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('groupExpense.modalTitle')}
      size="lg"
    >
      {!userId ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {t('expenseForm.sessionRequired')}
          </div>
          <Button type="button" variant="secondary" onClick={onClose} className="w-full">
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-5">
        {membersLoading && (
          <p className="text-sm text-slate-500">{t('groupExpense.loadingMembers')}</p>
        )}

        {!membersLoading && membersError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
            {t('groupExpense.preflightMembersError', { message: membersError })}
          </p>
        )}

        {!membersLoading && !membersError && members.length === 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
            {t('groupExpense.noMembersInGroup')}
          </p>
        )}

        <Input
          id="expense-title"
          label={t('groupExpense.titleLabel')}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('groupExpense.titlePlaceholder')}
          helperText={
            dictationField === 'title' && speech.isListening ? t('expenseForm.dictationListening') : undefined
          }
          suffix={
            speech.isSupported ? (
              <ExpenseDictationMicButton
                isListening={dictationField === 'title' && speech.isListening}
                onClick={toggleTitleDictation}
                disabled={disabled}
                labels={{
                  start: t('expenseForm.dictationStart'),
                  stop: t('expenseForm.dictationStop'),
                }}
              />
            ) : undefined
          }
        />

        <Input
          id="expense-amount"
          label={t('groupExpense.amountLabel')}
          type="text"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />

        <Input
          id="expense-description"
          label={t('expenseForm.descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('expenseForm.descriptionPlaceholder')}
          helperText={
            dictationField === 'description' && speech.isListening
              ? t('expenseForm.dictationListening')
              : undefined
          }
          suffix={
            speech.isSupported ? (
              <ExpenseDictationMicButton
                isListening={dictationField === 'description' && speech.isListening}
                onClick={toggleDescriptionDictation}
                disabled={disabled}
                labels={{
                  start: t('expenseForm.dictationStart'),
                  stop: t('expenseForm.dictationStop'),
                }}
              />
            ) : undefined
          }
        />

        {speech.error && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {t('expenseForm.dictationError')}
          </p>
        )}

        <ExpenseReceiptSection
          attachmentInputRef={receiptAttachmentInputRef}
          receiptFile={receiptFile}
          receiptPreviewUrl={receiptPreviewUrl}
          onAttachmentInputChange={handleReceiptAttachmentChange}
          onRemoveReceipt={handleRemoveReceipt}
          onOcrInterestClick={handleOcrInterestClick}
          disablePhoto={actionLoading}
          disableOcr={actionLoading}
        />

        <div className="space-y-1">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="expense-status">
            {t('groupExpense.expenseStatusLabel')}
          </label>
          <select
            id="expense-status"
            disabled={disabled}
            className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
            value={expenseStatus}
            onChange={(e) => setExpenseStatus(e.target.value as 'draft' | 'confirmed')}
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
                  checked={participantIds.includes(m.user_id)}
                  onChange={() => toggleParticipant(m.user_id)}
                  disabled={disabled}
                />
                <MemberAvatar
                  userId={m.user_id}
                  fullName={m.full_name}
                  avatarUrl={m.avatar_url}
                  size="sm"
                />
                <span className="font-medium text-slate-800 truncate">{memberLabel(m)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {splitMethod === 'equal' && settleAwareAvailable && (
            <div className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={settleAwareEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked && !settleAwareEnabled) {
                      // Funnel: user enabled settlement-aware mode.
                      void trackProductEvent('smart_settlement_enabled');
                    }
                    setSettleAwareEnabled(checked);
                  }}
                />
                {t('groupExpense.useToSettleBalances')}
              </label>
              <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesHint')}</p>
              <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesRule')}</p>
              {settleAwareEnabled && settlementSuggestion.applied && (
                <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                  <p className="font-semibold text-slate-700">{t('groupExpense.adjustedToSettleBalances')}</p>
                  <div className="mt-1 space-y-1">
                    {participantIds.map((id) => {
                      const member = members.find((m) => m.user_id === id);
                      const name = member ? memberLabel(member) : id;
                      const base = settlementSuggestion.baseShares[id] || 0;
                      const adjusted = settlementSuggestion.adjustedShares[id] || 0;
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
            disabled={disabled}
            className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
            value={splitMethod}
            onChange={(e) => {
              const nextMethod = e.target.value as 'equal' | 'manual' | 'percentage';
              if (nextMethod === 'manual') {
                const next: Record<string, string> = {};
                for (const id of participantIds) {
                  const cents =
                    settleAwareEnabled && settlementSuggestion.applied
                      ? settlementSuggestion.adjustedShares[id] || 0
                      : equalSharesPreview[id] || 0;
                  next[id] = formatCentsAsDecimal(cents, { digits: 2 });
                }
                setManualShares(next);
              }
              setSplitMethod(nextMethod);
            }}
          >
            <option value="equal">{t('groupExpense.splitEqual')}</option>
            <option value="manual">{t('groupExpense.splitManual')}</option>
            <option value="percentage">{t('groupExpense.splitPercentage')}</option>
          </select>
        </div>

        {!getOnboardingState().hasCreatedExpense && (
          <p className="text-xs text-slate-500">
            {t('groupExpense.onboardingFirstExpenseTip')}
          </p>
        )}

        {splitMethod === 'manual' && (
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.manualSplitLabel')}</span>
            <div className="space-y-2">
              {members
                .filter((m) => participantIds.includes(m.user_id))
                .map((m) => (
                  <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                    <MemberAvatar
                      userId={m.user_id}
                      fullName={m.full_name}
                      avatarUrl={m.avatar_url}
                      size="sm"
                    />
                    <span className="text-sm text-slate-800 flex-1 truncate">{memberLabel(m)}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={manualShares[m.user_id] ?? ''}
                      onChange={(e) =>
                        setManualShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                      }
                      placeholder={(() => {
                        const count = participantIds.length || 1;
                        return formatCentsAsDecimal(amountCentsPreview / count, { digits: 2 });
                      })()}
                      disabled={disabled}
                      className="w-28 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                    />
                    {settleAwareEnabled && equalSharesPreview[m.user_id] != null && (
                      <span
                        className={`text-xs font-semibold ${
                          (Math.round(parseFloat((manualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) >
                          (equalSharesPreview[m.user_id] || 0)
                            ? 'text-red-600'
                            : (Math.round(parseFloat((manualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) <
                                (equalSharesPreview[m.user_id] || 0)
                              ? 'text-emerald-600'
                              : 'text-slate-400'
                        }`}
                      >
                        {(Math.round(parseFloat((manualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                          (equalSharesPreview[m.user_id] || 0) >
                        0
                          ? '+'
                          : ''}
                        {formatMoney(
                          Math.abs(
                            (Math.round(parseFloat((manualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                              (equalSharesPreview[m.user_id] || 0),
                          ),
                        )}
                      </span>
                    )}
                  </div>
                ))}
            </div>
            <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
              manualDelta === 0
                ? 'text-green-700 bg-green-50 border-green-200'
                : manualDelta > 0
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-red-700 bg-red-50 border-red-200'
            }`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
              {manualDelta === 0
                ? t('groupExpense.manualSplitExact')
                : manualDelta > 0
                  ? t('groupExpense.manualSplitMissing', { amount: formatMoney(manualDelta) })
                  : t('groupExpense.manualSplitExcess', { amount: formatMoney(Math.abs(manualDelta)) })}
            </p>
          </div>
        )}

        {splitMethod === 'percentage' && (
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.percentageSplitLabel')}</span>
            <div className="space-y-2">
              {members
                .filter((m) => participantIds.includes(m.user_id))
                .map((m) => (
                  <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                    <MemberAvatar
                      userId={m.user_id}
                      fullName={m.full_name}
                      avatarUrl={m.avatar_url}
                      size="sm"
                    />
                    <span className="text-sm text-slate-800 flex-1 truncate">{memberLabel(m)}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={percentageShares[m.user_id] ?? ''}
                      onChange={(e) =>
                        setPercentageShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                      }
                      placeholder="0"
                      disabled={disabled}
                      className="w-20 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                    />
                    <span className="text-xs text-slate-500">%</span>
                  </div>
                ))}
            </div>
            <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
              Math.abs(percentageDelta) < 0.01
                ? 'text-green-700 bg-green-50 border-green-200'
                : percentageDelta > 0
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-red-700 bg-red-50 border-red-200'
            }`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
              {Math.abs(percentageDelta) < 0.01
                ? t('groupExpense.percentageSplitExact')
                : percentageDelta > 0
                  ? t('groupExpense.percentageSplitMissing', { value: formatDecimal(percentageDelta, { locale: i18n.language, digits: 2 }) })
                  : t('groupExpense.percentageSplitExcess', { value: formatDecimal(Math.abs(percentageDelta), { locale: i18n.language, digits: 2 }) })}
            </p>
          </div>
        )}

        {formError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {formError}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={actionLoading}>
            {t('groupExpense.cancel')}
          </Button>
          <Button type="submit" className="flex-[2]" loading={actionLoading} disabled={disabled}>
            {t('groupExpense.submit')}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
