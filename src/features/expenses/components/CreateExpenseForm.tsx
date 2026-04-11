import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { MemberAvatar } from '../../../components/MemberAvatar';
import { supabase } from '../../../lib/supabase';
import { classifyExpenseTitle } from '../expenseSuggestions';
import { formatCentsAsDecimal, formatCurrencyCents, formatDecimal } from '../../../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../../../lib/accountingExpenses';
import { assertEventAllowsNewExpense } from '../../../lib/eventExpenseGuards';
import { EXPENSES_CHANGED_EVENT, expensesChangedAffectsGroup, notifyExpensesChanged } from '../../../lib/expenseEvents';
import {
  buildEqualSharesCents,
  canApplySettlementAwareEqualSplit,
  computeDebtsToCurrentUser,
  getSettlementAwareManualSubmitSplits,
  runSettlementAwareSelfChecks,
  suggestSettlementAwareEqualSplit,
} from '../../../lib/settlementSplit';
import { getOnboardingState, updateOnboardingState } from '../../../lib/onboardingState';
import { trackProductEvent } from '../../../lib/productTracking';
import { buildExpenseV2Payload } from '../../../lib/expenseV2Payload';
import { persistReceiptAfterExpenseCreate } from '../../../lib/expenseReceiptStorage';
import { ExpenseReceiptSection } from './ExpenseReceiptSection';
import { ExpenseDictationMicButton } from './ExpenseDictationMicButton';
import { getSpeechRecognitionLanguage, useSpeechToText } from '../../../hooks/useSpeechToText';
import {
  clearPendingResumeFeatureAfterCheckout,
  PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK,
  readPendingResumeFeatureAfterCheckout,
  registerPremiumResumeHandler,
  SCAN_RECEIPT_FEATURE_KEY,
  useBillingGuard,
} from '../../billing';

interface CreateExpenseFormProps {
  groupId: string;
  eventId?: string;
  initialTitle?: string;
  participants?: Array<{ user_id: string; full_name?: string | null; avatar_url?: string | null }>;
  participantsLoading?: boolean;
  participantsError?: string | null;
  submitDisabled?: boolean;
  submitDisabledMessage?: string;
  initialStatus?: 'draft' | 'confirmed';
  onSuccess: () => void;
  onCancel: () => void;
  session: any;
  /** Product analytics: where the scan-receipt / interest entry point was used. */
  scanReceiptInterestSource?: 'dashboard' | 'event' | 'group' | 'unknown';
}

export function CreateExpenseForm({
  groupId,
  eventId,
  initialTitle = '',
  participants = [],
  participantsLoading = false,
  participantsError = null,
  submitDisabled = false,
  submitDisabledMessage,
  initialStatus = 'confirmed',
  onSuccess,
  onCancel,
  session,
  scanReceiptInterestSource = 'unknown',
}: CreateExpenseFormProps) {
  runSettlementAwareSelfChecks();
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [splitMethod, setSplitMethod] = useState<'equal' | 'manual' | 'percentage'>('equal');
  const [settleAwareEnabled, setSettleAwareEnabled] = useState(false);
  const [debtsToCurrentUser, setDebtsToCurrentUser] = useState<Record<string, number>>({});
  const [manualShares, setManualShares] = useState<Record<string, string>>({});
  const [percentageShares, setPercentageShares] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenseStatus, setExpenseStatus] = useState<'draft' | 'confirmed'>(initialStatus);
  const onboardingState = getOnboardingState();
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
      if (import.meta.env.DEV && file) {
        // eslint-disable-next-line no-console
        console.debug('[receipt attachment] selected', file.name);
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

  React.useEffect(
    () => () => {
      if (receiptPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(receiptPreviewObjectUrlRef.current);
      }
    },
    [],
  );

  /** OCR / waitlist: billing guard only — never opens the attachment file picker. */
  const handleOcrInterestClick = useCallback(() => {
    void trackProductEvent(PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK, {
      metadata: {
        featureKey: SCAN_RECEIPT_FEATURE_KEY,
        source: scanReceiptInterestSource,
        subscription_tier: billing.tier,
        feature_unreleased: true,
      },
    });
    void billing.guardAndRun(SCAN_RECEIPT_FEATURE_KEY, () => {}, {
      interestSource: scanReceiptInterestSource,
    });
  }, [billing.guardAndRun, billing.tier, scanReceiptInterestSource]);

  React.useEffect(() => {
    return registerPremiumResumeHandler(SCAN_RECEIPT_FEATURE_KEY, () => {});
  }, []);

  React.useEffect(() => {
    const pending = readPendingResumeFeatureAfterCheckout();
    if (pending === SCAN_RECEIPT_FEATURE_KEY) {
      clearPendingResumeFeatureAfterCheckout();
    }
  }, []);

  React.useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  React.useEffect(() => {
    setExpenseStatus(initialStatus);
  }, [initialStatus]);

  React.useEffect(() => {
    if (!userId || !participants.length) return;
    setParticipantIds(participants.map((p) => p.user_id));
  }, [participants, userId]);

  const loadDebtsToCurrentUser = useCallback(async () => {
    if (!groupId || !userId || participants.length === 0) {
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
        members: participants,
        currentUserId: userId,
        eligibleExpenses: eligible,
      }),
    );
  }, [groupId, participants, userId]);

  React.useEffect(() => {
    void loadDebtsToCurrentUser();
  }, [loadDebtsToCurrentUser]);

  React.useEffect(() => {
    const onChanged = (ev: globalThis.Event) => {
      const detail = (ev as CustomEvent<{ groupId?: string }>).detail;
      if (!expensesChangedAffectsGroup(detail, groupId)) return;
      void loadDebtsToCurrentUser();
    };
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [groupId, loadDebtsToCurrentUser]);

  const matchedSuggestion = classifyExpenseTitle(title);
  const participantDisplayName = (participant: { full_name?: string | null; user_id: string }) =>
    participant.full_name || t('eventDetail.unknownUser') || participant.user_id;
  const amountCentsPreview = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100);
  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale: i18n.language });
  const equalSharesPreview = useMemo(() => {
    const selectedIds = participants.filter((p) => participantIds.includes(p.user_id)).map((p) => p.user_id);
    return buildEqualSharesCents(selectedIds, amountCentsPreview);
  }, [participants, participantIds, amountCentsPreview]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
  
    try {
      if (!userId || !session?.access_token) {
        throw new Error(t('expenseForm.createFailed'));
      }

      let createdExpenseId: string | null = null;
      let effectiveSplitMethod: 'equal' | 'manual' | 'percentage' = splitMethod;
  
      const euros = parseFloat(amount.replace(',', '.'));
      const amountCents = Math.round(euros * 100);
  
      if (Number.isNaN(euros) || amountCents <= 0) {
        throw new Error(t('expenseForm.invalidAmount'));
      }
  
      try {
        await assertEventAllowsNewExpense(supabase, groupId, eventId);
      } catch (guardErr: unknown) {
        const code = guardErr instanceof Error ? guardErr.message : '';
        if (code === 'EVENT_CLOSED') throw new Error(t('expenseForm.cannotAddToClosedEvent'));
        if (code === 'EVENT_NOT_FOUND') throw new Error(t('expenseForm.eventNotFound'));
        if (code === 'EVENT_GROUP_MISMATCH') throw new Error(t('expenseForm.eventGroupMismatch'));
        throw guardErr instanceof Error ? guardErr : new Error(t('expenseForm.createFailed'));
      }
  
      if (participants.length) {
        if (participantIds.length === 0) {
          throw new Error(t('groupExpense.noParticipants'));
        }
  
        let splits:
          | Array<{
              user_id: string;
              share_cents: number;
              percentage?: number;
            }>
          | undefined = undefined;
  
        if (splitMethod === 'manual') {
          const parsed = participantIds.map((id) => ({
            user_id: id,
            share_cents: Math.round(parseFloat((manualShares[id] ?? '').replace(',', '.')) * 100),
          }));
  
          if (parsed.some((row) => Number.isNaN(row.share_cents) || row.share_cents < 0)) {
            throw new Error(t('groupExpense.invalidManualSplit'));
          }
  
          const totalManual = parsed.reduce((sum, row) => sum + row.share_cents, 0);
          if (totalManual !== amountCents) {
            throw new Error(t('groupExpense.manualSplitTotalMismatch'));
          }
  
          splits = parsed;
        } else if (splitMethod === 'percentage') {
          const parsed = participantIds.map((id) => ({
            user_id: id,
            percentage: parseFloat((percentageShares[id] ?? '').replace(',', '.')),
          }));
  
          if (parsed.some((row) => Number.isNaN(row.percentage) || row.percentage < 0)) {
            throw new Error(t('groupExpense.invalidPercentageSplit'));
          }
  
          const totalPct = parsed.reduce((sum, row) => sum + row.percentage, 0);
          if (Math.abs(totalPct - 100) > 0.01) {
            throw new Error(t('groupExpense.percentageSplitTotalMismatch'));
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
            console.log('[create-expense-v2][settlement-aware]', {
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
  
        const manualSharesPayload =
          effectiveSplitMethod === 'manual' && splits
            ? splits.map((s) => ({
                userId: s.user_id,
                amountCents: s.share_cents,
              }))
            : [];
  
        const percentageSharesPayload =
          effectiveSplitMethod === 'percentage' && splits
            ? splits.map((s) => ({
                userId: s.user_id,
                percentage: s.percentage ?? 0,
              }))
            : [];
  
        const requestedSplitMethod =
          splitMethod === 'equal' && settleAwareEnabled && splits
            ? 'settlement_aware'
            : effectiveSplitMethod;
  
        const createBody = buildExpenseV2Payload({
          groupId,
          eventId: eventId ?? null,
          title,
          description,
          currency: 'EUR',
          amountCents,
          paidByUserId: userId,
          participantIds,
          splitMethod: requestedSplitMethod,
          status: expenseStatus,
          manualShares: manualSharesPayload,
          percentageShares: percentageSharesPayload,
        });
  
        if (import.meta.env.DEV) {
          console.log('[create-expense-v2] payload', createBody);
        }
  
        const { data, error: fnError } = await supabase.functions.invoke('create-expense-v2', {
          body: createBody,
          headers: {
            Authorization: `Bearer ${session.access_token!}`,
          },
        });
  
        if (fnError) throw fnError;
        if ((data as any)?.error) throw new Error((data as any).error);
  
        const created = data as { expense?: { id: string }; split_method?: string } | undefined;
        createdExpenseId = created?.expense?.id ?? null;
  
        if (
          import.meta.env.DEV &&
          created?.expense?.id &&
          effectiveSplitMethod === 'manual' &&
          splits?.length
        ) {
          const { data: persistedRow, error: persistErr } = await supabase
            .from('expenses')
            .select('split_method, splits:expense_splits(user_id, share_cents)')
            .eq('id', created.expense.id)
            .single();
  
          if (!persistErr && persistedRow) {
            const persistedMap = Object.fromEntries(
              (persistedRow.splits as Array<{ user_id: string; share_cents: number }>).map((s) => [
                s.user_id,
                s.share_cents,
              ]),
            );
  
            const expectedMap = Object.fromEntries(splits.map((s) => [s.user_id, s.share_cents]));
            const keys = new Set([...Object.keys(persistedMap), ...Object.keys(expectedMap)]);
  
            let match = persistedRow.split_method === 'manual';
            for (const k of keys) {
              if ((persistedMap[k] ?? -1) !== (expectedMap[k] ?? -2)) {
                match = false;
              }
            }
  
            console.log('[create-expense-v2] persisted vs preview splits', {
              split_method: persistedRow.split_method,
              persistedMap,
              expectedMap,
              match,
            });
          }
        }
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('expenses')
          .insert({
            title,
            amount_cents: amountCents,
            description,
            group_id: groupId,
            event_id: eventId || null,
            paid_by_user_id: userId,
            created_by: userId,
            currency: 'EUR',
            split_method: 'equal',
            status: expenseStatus,
          })
          .select('id')
          .single();
  
        if (insertError) throw insertError;
        createdExpenseId = inserted?.id ?? null;
      }
  
      notifyExpensesChanged({ groupId });

      if (receiptFile && createdExpenseId) {
        const receiptResult = await persistReceiptAfterExpenseCreate({
          supabase,
          accessToken: session.access_token,
          groupId,
          expenseId: createdExpenseId,
          file: receiptFile,
        });
        if (receiptResult.error) {
          setError(t('expenseForm.receiptUploadFailed'));
          setLoading(false);
          return;
        }
      }
  
      if (!onboardingState.hasCreatedExpense) {
        void trackProductEvent('first_expense_created', {
          once_key: 'first_expense_created',
          entity_type: 'expense',
          entity_id: createdExpenseId,
        });
        updateOnboardingState({ hasCreatedExpense: true });
      }
  
      if (settleAwareEnabled) {
        void trackProductEvent('smart_settlement_applied', {
          entity_type: 'expense',
          entity_id: createdExpenseId,
          metadata: {
            split_method: effectiveSplitMethod,
            suggestionApplied: settlementSuggestion.applied,
          },
        });
      }
  
      applyReceiptFile(null);
      onSuccess();
    } catch (err: any) {
      setError(err.message || t('expenseForm.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!userId) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {t('expenseForm.sessionRequired')}
        </div>
        <Button type="button" variant="secondary" onClick={onCancel} className="w-full">
          {t('common.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Input
            label={t('expenseForm.titleLabel')}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('expenseForm.titlePlaceholder')}
            helperText={
              dictationField === 'title' && speech.isListening ? t('expenseForm.dictationListening') : undefined
            }
            suffix={
              speech.isSupported ? (
                <ExpenseDictationMicButton
                  isListening={dictationField === 'title' && speech.isListening}
                  onClick={toggleTitleDictation}
                  disabled={loading}
                  labels={{
                    start: t('expenseForm.dictationStart'),
                    stop: t('expenseForm.dictationStop'),
                  }}
                />
              ) : undefined
            }
          />
          {matchedSuggestion && (
            <p className="mt-2 text-xs text-slate-500">
              {t('expenseForm.detectedSuggestion')}:{' '}
              <span className="font-semibold">
                {matchedSuggestion.icon} {t(`expenseSuggestions.${matchedSuggestion.id}`)}
              </span>
            </p>
          )}
        </div>
        <Input
          label={t('expenseForm.amountLabel')}
          type="number"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </div>

      <ExpenseReceiptSection
        attachmentInputRef={receiptAttachmentInputRef}
        receiptFile={receiptFile}
        receiptPreviewUrl={receiptPreviewUrl}
        onAttachmentInputChange={handleReceiptAttachmentChange}
        onRemoveReceipt={handleRemoveReceipt}
        onOcrInterestClick={handleOcrInterestClick}
        disablePhoto={loading}
        disableOcr={loading}
      />
      
      <Input
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
              disabled={loading}
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

      <div className="space-y-1">
        <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.expenseStatusLabel')}</label>
        <select
          className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
          value={expenseStatus}
          onChange={(e) => setExpenseStatus(e.target.value as 'draft' | 'confirmed')}
        >
          <option value="draft">{t('groupExpense.expenseStatusDraft')}</option>
          <option value="confirmed">{t('groupExpense.expenseStatusConfirmed')}</option>
        </select>
        <p className="text-xs text-slate-500">{t('groupExpense.expenseStatusHint')}</p>
      </div>

      {(participantsLoading || !!participantsError || participants.length > 0) && (
        <>
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.participantsLabel')}</span>
            {participantsLoading ? (
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50"
                  >
                    <span className="w-5 h-5 rounded-full bg-slate-200 animate-pulse" />
                    <span
                      className={`h-3.5 rounded bg-slate-200 animate-pulse ${
                        idx % 2 === 0 ? 'w-20' : 'w-28'
                      }`}
                    />
                  </div>
                ))}
              </div>
            ) : participantsError ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                <AlertCircle className="w-4 h-4" />
                {t('groupExpense.preflightMembersError', { message: participantsError })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <label
                    key={p.user_id}
                    className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer text-sm max-w-full"
                  >
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                      checked={participantIds.includes(p.user_id)}
                      onChange={() =>
                        setParticipantIds((prev) =>
                          prev.includes(p.user_id) ? prev.filter((id) => id !== p.user_id) : [...prev, p.user_id]
                        )
                      }
                    />
                    <MemberAvatar
                      userId={p.user_id}
                      fullName={p.full_name}
                      avatarUrl={p.avatar_url}
                      size="sm"
                    />
                    <span className="font-medium text-slate-800 truncate">{participantDisplayName(p)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {!participantsLoading && !participantsError && participants.length > 0 && (
          <>
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
                      // Funnel: user enabled settlement-aware mode while creating an expense.
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
                      const participant = participants.find((p) => p.user_id === id);
                      const name = participant?.full_name || t('eventDetail.unknownUser');
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
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.splitMethodLabel')}</label>
            <select
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
          </>
          )}

          {!participantsLoading && !participantsError && participants.length > 0 && splitMethod === 'manual' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.manualSplitLabel')}</span>
              <div className="space-y-2">
                {participants
                  .filter((p) => participantIds.includes(p.user_id))
                  .map((p) => (
                    <div key={p.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <MemberAvatar
                        userId={p.user_id}
                        fullName={p.full_name}
                        avatarUrl={p.avatar_url}
                        size="sm"
                      />
                      <span className="text-sm text-slate-800 flex-1 truncate">{participantDisplayName(p)}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={manualShares[p.user_id] ?? ''}
                        onChange={(e) => setManualShares((prev) => ({ ...prev, [p.user_id]: e.target.value }))}
                        placeholder={(() => {
                          const count = participantIds.length || 1;
                          const amountCentsPreview = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100);
                          return formatCentsAsDecimal(amountCentsPreview / count, { digits: 2 });
                        })()}
                        className="w-28 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                      />
                      {settleAwareEnabled && equalSharesPreview[p.user_id] != null && (
                        <span
                          className={`text-xs font-semibold ${
                            (Math.round(parseFloat((manualShares[p.user_id] ?? '').replace(',', '.')) * 100) || 0) >
                            (equalSharesPreview[p.user_id] || 0)
                              ? 'text-red-600'
                              : (Math.round(parseFloat((manualShares[p.user_id] ?? '').replace(',', '.')) * 100) || 0) <
                                  (equalSharesPreview[p.user_id] || 0)
                                ? 'text-emerald-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {(Math.round(parseFloat((manualShares[p.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                            (equalSharesPreview[p.user_id] || 0) >
                          0
                            ? '+'
                            : ''}
                          {formatMoney(
                            Math.abs(
                              (Math.round(parseFloat((manualShares[p.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                                (equalSharesPreview[p.user_id] || 0),
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

          {!participantsLoading && !participantsError && participants.length > 0 && splitMethod === 'percentage' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.percentageSplitLabel')}</span>
              <div className="space-y-2">
                {participants
                  .filter((p) => participantIds.includes(p.user_id))
                  .map((p) => (
                    <div key={p.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <MemberAvatar
                        userId={p.user_id}
                        fullName={p.full_name}
                        avatarUrl={p.avatar_url}
                        size="sm"
                      />
                      <span className="text-sm text-slate-800 flex-1 truncate">{participantDisplayName(p)}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={percentageShares[p.user_id] ?? ''}
                        onChange={(e) => setPercentageShares((prev) => ({ ...prev, [p.user_id]: e.target.value }))}
                        placeholder="0"
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
        </>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {submitDisabled && submitDisabledMessage && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-700 text-xs rounded-xl border border-amber-100">
          <AlertCircle className="w-4 h-4" />
          {submitDisabledMessage}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="flex-1"
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          loading={loading}
          disabled={submitDisabled}
          className="flex-[2]"
        >
          <Receipt className="w-5 h-5 mr-2" />
          {t('expenseForm.submit')}
        </Button>
      </div>

      {!onboardingState.hasCreatedExpense && (
        <p className="text-xs text-slate-500">
          {t('expenseForm.onboardingFirstExpenseTip')}
        </p>
      )}
    </form>
    </>
  );
}
