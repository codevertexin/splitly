import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Users,
  X,
  Receipt,
  UserPlus,
  Loader2,
  Settings,
  Calendar,
  ChevronDown,
  ChevronUp,
  Scale,
  Plus,
  Info,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Group } from '../../../types';
import { GroupExpenseRow } from '../../../hooks/useGroupExpenses';
import { GroupMemberRow, memberLabel } from '../../../hooks/useGroupMembers';
import { Button } from '../../../components/ui/Button';
import { InviteModal } from './InviteModal';
import { MemberAvatar } from '../../../components/MemberAvatar';
import { formatCurrencyCents, formatDateOnly } from '../../../lib/dateTime';
import { isAccountingEligibleExpense } from '../../../lib/accountingExpenses';
import { computePairwiseNetVsMe } from '../../../lib/groupPairwiseBalances';
import { iconForExpenseTitle } from '../../expenses/expenseSuggestions';

interface GroupDetailProps {
  group: Group;
  members: GroupMemberRow[];
  membersLoading: boolean;
  expenses: GroupExpenseRow[];
  allExpenses: GroupExpenseRow[];
  expensesLoading: boolean;
  yourBalanceCents: number;
  balanceLoading: boolean;
  balanceError: string | null;
  membersError: string | null;
  currentUserId: string;
  canAddExpense: boolean;
  addExpenseDisabledHint?: string;
  onBack: () => void;
  onSettleUp: () => Promise<void>;
  /** Loading state for confirm "Settle debts" only (optional; falls back to actionLoading). */
  settleActionLoading?: boolean;
  settleFeedback?: { type: 'success' | 'error'; message: string } | null;
  onDismissSettleFeedback?: () => void;
  onInvite: () => void;
  onNavigateToEvent?: (eventId: string) => void;
  onOpenCreateEvent?: () => void;
  isOwner?: boolean;
  onManageGroup?: () => void;
  onOpenAddExpense: () => void;
  onRequestPayment?: (targetUserId: string, amountCents: number, targetName: string) => Promise<void> | void;
  canEditExpense: (expense: GroupExpenseRow) => boolean;
  onEditExpense: (expense: GroupExpenseRow) => void;
  requestingUserIds?: Set<string>;
  requestedUserIds?: Set<string>;
  requestFeedback?: { type: 'success' | 'error'; message: string } | null;
  inviteModalProps: {
    isOpen: boolean;
    onClose: () => void;
    inviteLink: string | null;
    loading: boolean;
    error: string | null;
  };
  actionLoading: boolean;
  /** Refetch group balance (e.g. Retry when breakdown failed). */
  onRetryBalance?: () => void;
}

function expensePayerName(expense: GroupExpenseRow, members: GroupMemberRow[]) {
  const fromProfile = expense.profiles?.full_name?.trim();
  if (fromProfile) return fromProfile;
  const m = members.find((x) => x.user_id === expense.paid_by_user_id);
  if (m) return memberLabel(m);
  return expense.paid_by_user_id;
}

type ExpenseSection = {
  type: 'event' | 'ungrouped';
  eventId: string | null;
  title: string;
  eventMeta?: GroupExpenseRow['event'];
  totalAmountCents: number;
  expenseCount: number;
  latestExpenseAtMs: number;
  expenses: GroupExpenseRow[];
  participantIds: Set<string>;
};

const PAGE_CHUNK = 35;

function groupExpensesIntoSections(items: GroupExpenseRow[], t: (k: string) => string): ExpenseSection[] {
  const sectionMap = new Map<string, ExpenseSection>();

  for (const expense of items) {
    const key = expense.event?.id ?? '__ungrouped__';
    const isEvent = Boolean(expense.event?.id);
    const title = isEvent ? expense.event?.title || t('groupDetail.eventLabel') : t('groupDetail.otherExpenses');

    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        type: isEvent ? 'event' : 'ungrouped',
        eventId: expense.event?.id ?? null,
        title,
        eventMeta: expense.event ?? undefined,
        totalAmountCents: 0,
        expenseCount: 0,
        latestExpenseAtMs: 0,
        expenses: [],
        participantIds: new Set<string>(),
      });
    }

    const section = sectionMap.get(key)!;
    section.expenses.push(expense);
    section.totalAmountCents += expense.amount_cents;
    section.expenseCount += 1;
    section.latestExpenseAtMs = Math.max(section.latestExpenseAtMs, new Date(expense.incurred_at).getTime());
    section.participantIds.add(expense.paid_by_user_id);
    for (const split of expense.splits || []) {
      section.participantIds.add(split.user_id);
    }
  }

  const sections = Array.from(sectionMap.values());
  for (const section of sections) {
    section.expenses.sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
  }
  sections.sort((a, b) => b.latestExpenseAtMs - a.latestExpenseAtMs);
  return sections;
}

function applyExpenseFilters(
  list: GroupExpenseRow[],
  filterEventId: string,
  filterMemberId: string,
): GroupExpenseRow[] {
  return list.filter((e) => {
    if (filterEventId !== 'all') {
      if (filterEventId === '__none__') {
        if (e.event?.id) return false;
      } else if (e.event?.id !== filterEventId) return false;
    }
    if (filterMemberId !== 'all') {
      const payer = e.paid_by_user_id === filterMemberId;
      const inSplit = (e.splits || []).some((s) => s.user_id === filterMemberId);
      if (!payer && !inSplit) return false;
    }
    return true;
  });
}

function eventStatusLabel(status: string, t: (k: string) => string) {
  if (status === 'draft') return t('groupDetail.eventStatusDraft');
  if (status === 'closed') return t('groupDetail.eventStatusClosed');
  return t('groupDetail.eventStatusOpen');
}

export function GroupDetail({
  group,
  members,
  membersLoading,
  expenses,
  allExpenses,
  expensesLoading,
  yourBalanceCents,
  balanceLoading,
  balanceError,
  membersError,
  currentUserId,
  canAddExpense,
  addExpenseDisabledHint,
  onBack,
  onSettleUp,
  settleActionLoading,
  settleFeedback,
  onDismissSettleFeedback,
  onInvite,
  onNavigateToEvent,
  onOpenCreateEvent,
  isOwner = false,
  onManageGroup,
  onOpenAddExpense,
  onRequestPayment,
  canEditExpense,
  onEditExpense,
  requestingUserIds,
  requestedUserIds,
  requestFeedback,
  inviteModalProps,
  actionLoading,
  onRetryBalance,
}: GroupDetailProps) {
  const settleBusy = settleActionLoading ?? actionLoading;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [showSettleHelp, setShowSettleHelp] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const sectionStateKey = `splitly_group_expanded_sections_v2_${group.id}`;
  const [filterEventId, setFilterEventId] = useState<string>('all');
  const [filterMemberId, setFilterMemberId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'confirmed'>('all');
  const [confirmedLimit, setConfirmedLimit] = useState(PAGE_CHUNK);
  const [draftLimit, setDraftLimit] = useState(PAGE_CHUNK);

  const locale =
    i18n.language === 'pt-BR'
      ? 'pt-BR'
      : i18n.language === 'pt-PT'
        ? 'pt-PT'
        : i18n.language === 'es'
          ? 'es-ES'
          : 'en-IE';

  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale });

  const confirmedIds = useMemo(() => new Set(expenses.map((e) => e.id)), [expenses]);

  const draftExpensesAll = useMemo(
    () => allExpenses.filter((e) => !confirmedIds.has(e.id)),
    [allExpenses, confirmedIds],
  );

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allExpenses) {
      if (e.event?.id && e.event.title) map.set(e.event.id, e.event.title);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allExpenses]);

  const draftFiltered = useMemo(
    () => applyExpenseFilters(draftExpensesAll, filterEventId, filterMemberId),
    [draftExpensesAll, filterEventId, filterMemberId],
  );

  const confirmedFiltered = useMemo(
    () => applyExpenseFilters(expenses, filterEventId, filterMemberId),
    [expenses, filterEventId, filterMemberId],
  );

  const draftFlatSorted = useMemo(() => {
    const list = [...draftFiltered];
    list.sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
    return list;
  }, [draftFiltered]);

  const confirmedFlatSorted = useMemo(() => {
    const list = [...confirmedFiltered];
    list.sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
    return list;
  }, [confirmedFiltered]);

  const draftVisibleFlat = useMemo(() => draftFlatSorted.slice(0, draftLimit), [draftFlatSorted, draftLimit]);
  const confirmedVisibleFlat = useMemo(
    () => confirmedFlatSorted.slice(0, confirmedLimit),
    [confirmedFlatSorted, confirmedLimit],
  );

  const groupedDraftSections = useMemo(
    () => groupExpensesIntoSections(draftVisibleFlat, (k) => t(k)),
    [draftVisibleFlat, t],
  );

  const groupedConfirmedSections = useMemo(
    () => groupExpensesIntoSections(confirmedVisibleFlat, (k) => t(k)),
    [confirmedVisibleFlat, t],
  );

  const eligibleAccountingExpenses = useMemo(
    () => expenses.filter(isAccountingEligibleExpense),
    [expenses],
  );

  const pairwiseRows = useMemo(
    () => computePairwiseNetVsMe(currentUserId, members, eligibleAccountingExpenses),
    [currentUserId, members, eligibleAccountingExpenses],
  );

  const youOweThem = useMemo(
    () => pairwiseRows.filter((r) => r.netIOCents > 0).sort((a, b) => b.netIOCents - a.netIOCents),
    [pairwiseRows],
  );

  const theyOweYou = useMemo(
    () => pairwiseRows.filter((r) => r.netIOCents < 0).sort((a, b) => a.netIOCents - b.netIOCents),
    [pairwiseRows],
  );

  const toReceiveCents = Math.max(0, yourBalanceCents);
  const toPayCents = Math.max(0, -yourBalanceCents);

  /** Single merged line: emotional + people context (no repeated €). */
  const balanceSubtitle = useMemo(() => {
    if (balanceLoading || balanceError) return null;
    if (yourBalanceCents > 0) {
      const c = theyOweYou.length;
      if (c === 0) return t('groupDetail.balanceLinePositiveSimple');
      return c === 1 ? t('groupDetail.balanceLinePositiveOne') : t('groupDetail.balanceLinePositiveMany', { count: c });
    }
    if (yourBalanceCents < 0) {
      const c = youOweThem.length;
      if (c === 0) return t('groupDetail.balanceLineNegativeSimple');
      return c === 1 ? t('groupDetail.balanceLineNegativeOne') : t('groupDetail.balanceLineNegativeMany', { count: c });
    }
    return t('groupDetail.balanceLineZero');
  }, [balanceLoading, balanceError, yourBalanceCents, theyOweYou.length, youOweThem.length, t]);

  const toggleSection = (prefix: string, sectionKey: string) => {
    const k = `${prefix}:${sectionKey}`;
    setExpandedSections((prev) => ({
      ...prev,
      [k]: !(prev[k] ?? true),
    }));
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sectionStateKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      setExpandedSections(parsed || {});
    } catch {
      // ignore
    }
  }, [sectionStateKey]);

  useEffect(() => {
    try {
      localStorage.setItem(sectionStateKey, JSON.stringify(expandedSections));
    } catch {
      // ignore
    }
  }, [sectionStateKey, expandedSections]);

  useEffect(() => {
    setConfirmedLimit(PAGE_CHUNK);
    setDraftLimit(PAGE_CHUNK);
  }, [filterEventId, filterMemberId, statusFilter, group.id]);

  const handleSettleUp = async () => {
    await onSettleUp();
    setShowSettleConfirm(false);
  };

  const formatEventDates = (ev: NonNullable<GroupExpenseRow['event']>) => {
    const start = ev.starts_at ? formatDateOnly(ev.starts_at, locale) : null;
    const end = ev.ends_at ? formatDateOnly(ev.ends_at, locale) : null;
    if (start && end) return t('groupDetail.eventDateShort', { start, end });
    if (start) return t('groupDetail.eventDateStart', { date: start });
    return null;
  };

  const renderExpenseRow = (expense: GroupExpenseRow, opts: { readOnlyDraft: boolean; sectionPrefix: string }) => {
    const { readOnlyDraft, sectionPrefix } = opts;
    const payerId = expense.paid_by_user_id;
    const prof = expense.profiles;
    const mem = members.find((x) => x.user_id === payerId);
    const payerName = expensePayerName(expense, members);
    const participantCount = (expense.splits || []).length;
    const editable = canEditExpense(expense);
    const titleIcon = iconForExpenseTitle(expense.title);
    const pcLabel =
      participantCount === 0
        ? t('groupDetail.noParticipantsDefined')
        : participantCount === 1
          ? t('groupDetail.participantsCountOne')
          : t('groupDetail.participantsCount', { count: participantCount });

    return (
      <motion.li
        layout
        key={`${sectionPrefix}-${expense.id}`}
        className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 shadow-sm transition-all sm:gap-4 sm:px-4 sm:py-3 ${
          readOnlyDraft
            ? 'border-amber-200/90 bg-amber-50/90 hover:bg-amber-50'
            : 'border-slate-100/90 bg-white hover:border-slate-200 hover:bg-white'
        }`}
        onClick={() => editable && onEditExpense(expense)}
        onKeyDown={(e) => {
          if (editable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onEditExpense(expense);
          }
        }}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
      >
        <MemberAvatar
          userId={payerId}
          fullName={prof?.full_name ?? mem?.full_name}
          avatarUrl={prof?.avatar_url ?? mem?.avatar_url}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-lg leading-none" aria-hidden>
              {titleIcon}
            </span>
            <p className="min-w-0 truncate font-semibold text-slate-900">{expense.title}</p>
            {readOnlyDraft && null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              {formatDateOnly(expense.incurred_at, locale)}
            </span>
            <span className="text-slate-300">·</span>
            <span>
              {t('expenses.paidBy', { name: payerName })}
            </span>
            <span className="text-slate-300">·</span>
            {participantCount === 0 ? (
              <span className="rounded-md bg-amber-100/90 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950">
                {pcLabel}
              </span>
            ) : (
              <span>{pcLabel}</span>
            )}
          </p>
        </div>
        <span className="shrink-0 font-bold tabular-nums text-slate-900">{formatMoney(expense.amount_cents)}</span>
        {editable && (
          <span className="hidden text-xs font-semibold text-blue-600 group-hover:inline sm:inline">{t('expenseForm.editAction')}</span>
        )}
      </motion.li>
    );
  };

  const renderSectionBlock = (
    section: ExpenseSection,
    opts: { prefix: 'draft' | 'confirmed'; readOnlyDraft: boolean },
  ) => {
    const { prefix, readOnlyDraft } = opts;
    const sectionKey = section.eventId ?? '__ungrouped__';
    const expandKey = `${prefix}:${sectionKey}`;
    const isExpanded = expandedSections[expandKey] ?? true;
    const ev = section.eventMeta;

    return (
      <div
        key={expandKey}
        className={`overflow-hidden rounded-2xl border shadow-sm ${
          readOnlyDraft ? 'border-amber-200/90 bg-amber-50/25' : 'border-slate-200/90 bg-white'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSection(prefix, sectionKey)}
          className={`flex w-full items-start gap-3 border-b px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4 ${
            readOnlyDraft
              ? 'border-amber-200/80 bg-amber-50/90 hover:bg-amber-50'
              : 'border-slate-200/90 bg-slate-50/95 hover:bg-slate-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-slate-900">{section.title}</p>
              {ev?.status && (
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    ev.status === 'closed'
                      ? 'bg-slate-200 text-slate-700'
                      : ev.status === 'draft'
                        ? 'bg-amber-200 text-amber-950'
                        : 'bg-emerald-100 text-emerald-900'
                  }`}
                >
                  {eventStatusLabel(ev.status, (k) => t(k))}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs font-semibold text-slate-700">
              {formatMoney(section.totalAmountCents)} · {section.expenseCount}{' '}
              {t('groupDetail.expensesCountLabel')} ·{' '}
              {section.participantIds.size === 0
                ? t('groupDetail.participantsCountZero')
                : section.participantIds.size === 1
                  ? t('groupDetail.participantsCountOne')
                  : t('groupDetail.participantsCount', { count: section.participantIds.size })}
            </p>
            {ev && (ev.starts_at || ev.ends_at) && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatEventDates(ev)}
                </span>
                {onNavigateToEvent && ev.id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToEvent(ev.id);
                    }}
                    className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {t('groupDetail.viewEvent')}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
            )}
          </div>
        </button>

        {isExpanded && (
          <ul className="space-y-2 border-t border-slate-100/90 bg-slate-50/50 p-3 sm:p-4">
            {section.expenses.map((expense) =>
              renderExpenseRow(expense, { readOnlyDraft, sectionPrefix: expandKey }),
            )}
          </ul>
        )}
      </div>
    );
  };

  const showDraftBlock = statusFilter !== 'confirmed' && draftFiltered.length > 0;
  const showConfirmedBlock = statusFilter !== 'draft' && confirmedFiltered.length > 0;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"
      >
        <div className="p-5 sm:p-8">
          <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3 md:gap-4">
              <button
                type="button"
                onClick={onBack}
                className="shrink-0 rounded-xl bg-slate-50 p-2 text-slate-500 transition-all hover:bg-slate-100"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Users className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold text-slate-900">{group.name}</h2>
                <p className="truncate text-sm text-slate-500">{group.description || t('groupDetail.noDescription')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {isOwner && onManageGroup && (
                <button
                  type="button"
                  onClick={onManageGroup}
                  className="shrink-0 rounded-xl bg-slate-50 p-2 text-slate-600 transition-all hover:bg-slate-100"
                  title={t('groupDetail.manageGroup')}
                  aria-label={t('groupDetail.manageGroup')}
                >
                  <Settings className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <div className="mb-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={onOpenAddExpense}
              disabled={!canAddExpense}
              title={addExpenseDisabledHint}
              className="w-full py-3.5 text-base font-bold shadow-lg shadow-blue-900/15 sm:w-auto sm:min-w-[220px]"
            >
              <Plus className="mr-2 h-5 w-5" />
              {t('groupDetail.addExpense')}
            </Button>
            {onOpenCreateEvent && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onOpenCreateEvent}
                className="w-full border-slate-300 py-3.5 text-base font-semibold text-slate-800 hover:bg-slate-50 sm:w-auto"
              >
                <Calendar className="mr-2 h-4 w-4 shrink-0" />
                {t('groupDetail.createEvent')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={onInvite}
              className="w-full py-3.5 text-base font-semibold text-slate-500 ring-1 ring-slate-200/90 ring-inset hover:bg-slate-50 hover:text-slate-700 sm:w-auto"
            >
              <UserPlus className="mr-2 h-4 w-4 shrink-0 opacity-80" />
              {t('groupDetail.invite')}
            </Button>
          </div>

          <AnimatePresence>
            {showSettleConfirm && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-6 flex items-center gap-3 rounded-2xl border border-green-100 bg-green-50 p-4"
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-green-900">{t('groupDetail.confirmSettleTitle')}</p>
                  <p className="text-xs text-green-700">{t('groupDetail.confirmSettleBody')}</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setShowSettleConfirm(false)} variant="outline" size="sm">
                    <X className="h-4 w-4" />
                  </Button>
                  <Button onClick={handleSettleUp} disabled={settleBusy} loading={settleBusy} variant="success" size="sm">
                    {t('groupDetail.confirm')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {membersError && (
            <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{membersError}</div>
          )}

          {settleFeedback && (
            <div
              className={`mb-4 flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${
                settleFeedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
              role="status"
            >
              <span>{settleFeedback.message}</span>
              {onDismissSettleFeedback && (
                <button
                  type="button"
                  className="shrink-0 font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
                  onClick={onDismissSettleFeedback}
                >
                  {t('groupDetail.dismissNotice')}
                </button>
              )}
            </div>
          )}

          <section className="mb-8 rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-white to-slate-50/80 p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('groupDetail.netPositionLabel')}</p>
            <p
              className={`mt-1.5 text-4xl font-extrabold tabular-nums tracking-tight sm:text-5xl ${
                yourBalanceCents > 0 ? 'text-emerald-700' : yourBalanceCents < 0 ? 'text-red-700' : 'text-slate-800'
              }`}
              title={balanceError ?? undefined}
            >
              {balanceLoading ? '…' : balanceError ? '—' : `${yourBalanceCents > 0 ? '+' : yourBalanceCents < 0 ? '−' : ''}${formatMoney(Math.abs(yourBalanceCents))}`}
            </p>
            {balanceSubtitle && (
              <p
                aria-live="polite"
                className={`mt-2 max-w-xl text-sm font-medium leading-snug ${
                  yourBalanceCents > 0 ? 'text-emerald-900/90' : yourBalanceCents < 0 ? 'text-red-900/90' : 'text-slate-600'
                }`}
              >
                {balanceSubtitle}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-100/90 bg-emerald-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/90">{t('groupDetail.toReceiveLabel')}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-emerald-800 sm:text-xl">
                  {balanceLoading || balanceError ? '—' : formatMoney(toReceiveCents)}
                </p>
              </div>
              <div className="rounded-2xl border border-red-100/90 bg-red-50/70 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-800/90">{t('groupDetail.toPayLabel')}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-red-800 sm:text-xl">
                  {balanceLoading || balanceError ? '—' : formatMoney(toPayCents)}
                </p>
              </div>
            </div>
            {!showSettleConfirm && yourBalanceCents !== 0 && (
              <Button
                type="button"
                onClick={() => setShowSettleConfirm(true)}
                className={`mt-4 w-full py-3.5 text-base font-bold shadow-lg ring-2 border ${
                  yourBalanceCents > 0
                    ? 'border-emerald-900/15 bg-emerald-700 text-white shadow-emerald-950/25 ring-emerald-800/20 hover:bg-emerald-800'
                    : 'border-red-900/15 bg-red-700 text-white shadow-red-950/20 ring-red-800/25 hover:bg-red-800'
                }`}
              >
                <Scale className="mr-2 h-5 w-5 shrink-0" />
                {yourBalanceCents > 0 ? t('groupDetail.ctaRequestPayments') : t('groupDetail.ctaSettleDebts')}
              </Button>
            )}
            <div className="relative mt-3">
              <button
                type="button"
                onClick={() => setShowSettleHelp((v) => !v)}
                className="text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-800"
              >
                {t('groupDetail.howSettlementsWork')}
              </button>
              {showSettleHelp && (
                <div className="absolute left-0 top-full z-20 mt-2 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                  <p className="text-sm font-bold text-slate-900">{t('groupDetail.settleHelpTitle')}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('groupDetail.settleHelpBody')}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => navigate('/help#settle')}
                      className="text-xs font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700"
                    >
                      {t('groupDetail.settleHelpLearnMore')}
                    </button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setShowSettleHelp(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="mb-8">
            <h3 className="mb-4 text-base font-bold tracking-tight text-slate-900">{t('groupDetail.whoOwesWhoHeading')}</h3>
            {requestFeedback && (
              <div
                className={`mb-3 rounded-xl border px-3 py-2 text-sm ${
                  requestFeedback.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {requestFeedback.message}
              </div>
            )}
            {membersLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                {t('groupDetail.membersLoading')}
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-slate-400">{t('groupDetail.noMembersYet')}</p>
            ) : (
              <>
                {pairwiseRows.length > 0 && (
                  <div className="space-y-6">
                    {theyOweYou.length > 0 && (
                      <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 sm:p-5">
                        <p className="mb-3 text-sm font-bold text-emerald-900">{t('groupDetail.sectionYouAreOwed')}</p>
                        <ul className="space-y-2.5">
                          {theyOweYou.map((row) => {
                            const isRequesting = requestingUserIds?.has(row.member.user_id) ?? false;
                            const isRequested = requestedUserIds?.has(row.member.user_id) ?? false;
                            const targetName = memberLabel(row.member);
                            return (
                            <li
                              key={row.member.user_id}
                              className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100/90 bg-white/90 px-3.5 py-3 shadow-sm sm:gap-3 sm:px-4"
                            >
                              <MemberAvatar
                                userId={row.member.user_id}
                                fullName={row.member.full_name}
                                avatarUrl={row.member.avatar_url}
                                size="sm"
                                className="shrink-0"
                              />
                              <p className="min-w-0 flex-1 text-base font-medium leading-snug text-emerald-950">
                                {t('groupDetail.owesYouFull', {
                                  name: memberLabel(row.member),
                                  amount: formatMoney(Math.abs(row.netIOCents)),
                                })}
                              </p>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onRequestPayment?.(row.member.user_id, Math.abs(row.netIOCents), targetName);
                                }}
                                disabled={isRequesting || isRequested}
                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
                                  isRequested
                                    ? 'border border-emerald-600 bg-emerald-600 text-white'
                                    : isRequesting
                                      ? 'border border-emerald-300/90 bg-emerald-50 text-emerald-900'
                                      : 'border border-emerald-300/90 bg-white text-emerald-900 hover:bg-emerald-50'
                                }`}
                              >
                                <span className="inline-flex items-center gap-1">
                                  {isRequested && <CheckCircle2 className="h-3.5 w-3.5" />}
                                  {isRequesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                  {isRequested
                                    ? t('groupDetail.requestedPayment')
                                    : isRequesting
                                      ? t('groupDetail.requestSending')
                                      : t('groupDetail.rowRequestPayment')}
                                </span>
                              </button>
                            </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {youOweThem.length > 0 && (
                      <div className="rounded-2xl border border-red-200/80 bg-red-50/40 p-4 sm:p-5">
                        <p className="mb-3 text-sm font-bold text-red-900">{t('groupDetail.sectionYouOwe')}</p>
                        <ul className="space-y-2.5">
                          {youOweThem.map((row) => (
                            <li
                              key={row.member.user_id}
                              className="flex flex-wrap items-center gap-2 rounded-xl border border-red-100/90 bg-white/90 px-3.5 py-3 shadow-sm sm:gap-3 sm:px-4"
                            >
                              <MemberAvatar
                                userId={row.member.user_id}
                                fullName={row.member.full_name}
                                avatarUrl={row.member.avatar_url}
                                size="sm"
                                className="shrink-0"
                              />
                              <p className="min-w-0 flex-1 text-base font-medium leading-snug text-red-950">
                                {t('groupDetail.youOweFull', {
                                  name: memberLabel(row.member),
                                  amount: formatMoney(row.netIOCents),
                                })}
                              </p>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowSettleConfirm(true);
                                }}
                                className="shrink-0 rounded-lg border border-red-300/90 bg-white px-3 py-1.5 text-xs font-semibold text-red-950 shadow-sm transition-colors hover:bg-red-50"
                              >
                                {t('groupDetail.rowSettle')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {pairwiseRows.length === 0 && balanceLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                    {t('groupDetail.balancesLoading')}
                  </div>
                )}
                {pairwiseRows.length === 0 && !balanceLoading && balanceError && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-relaxed text-slate-700">{t('groupDetail.whoOwesWhoBreakdownError')}</p>
                    {onRetryBalance && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRetryBalance()} className="shrink-0">
                        {t('groupDetail.breakdownRetry')}
                      </Button>
                    )}
                  </div>
                )}
                {pairwiseRows.length === 0 && !balanceLoading && !balanceError && yourBalanceCents === 0 && (
                  <div className="flex items-start gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/50 px-4 py-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                    <p className="text-sm font-medium leading-relaxed text-emerald-950">{t('groupDetail.whoOwesWhoEmptyEven')}</p>
                  </div>
                )}
                {pairwiseRows.length === 0 && !balanceLoading && !balanceError && yourBalanceCents !== 0 && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium leading-relaxed text-amber-950">{t('groupDetail.whoOwesWhoIncomplete')}</p>
                    {onRetryBalance && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRetryBalance()} className="shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100/80">
                        {t('groupDetail.breakdownRetry')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {expensesLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              <div id="group-expenses" className="flex flex-col gap-3 scroll-mt-24 sm:flex-row sm:items-end sm:justify-between">
                <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.expensesHeading')}</h3>
              </div>

              <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('groupDetail.filterStatus')}</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'confirmed')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="all">{t('groupDetail.filterStatusAll')}</option>
                    <option value="draft">{t('groupDetail.filterStatusDraftOnly')}</option>
                    <option value="confirmed">{t('groupDetail.filterStatusConfirmedOnly')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('groupDetail.filterEvent')}</label>
                  <select
                    value={filterEventId}
                    onChange={(e) => setFilterEventId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="all">{t('groupDetail.filterEventAll')}</option>
                    <option value="__none__">{t('groupDetail.filterEventNone')}</option>
                    {eventOptions.map(([eid, title]) => (
                      <option key={eid} value={eid}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('groupDetail.filterMember')}</label>
                  <select
                    value={filterMemberId}
                    onChange={(e) => setFilterMemberId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="all">{t('groupDetail.filterMemberAll')}</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {showDraftBlock && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-bold text-amber-900">{t('groupDetail.draftSectionTitle')}</h4>
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                      title={t('groupDetail.draftTooltip')}
                    >
                      <Info className="h-3 w-3" />
                      {t('groupDetail.draftTooltip')}
                    </span>
                  </div>
                  {groupedDraftSections.length === 0 ? (
                    <p className="rounded-2xl border border-amber-100 bg-amber-50/50 px-4 py-8 text-center text-sm text-amber-900/80">
                      {t('groupDetail.noDraftExpenses')}
                    </p>
                  ) : (
                    <>
                      <div className="space-y-6">{groupedDraftSections.map((s) => renderSectionBlock(s, { prefix: 'draft', readOnlyDraft: true }))}</div>
                      {draftLimit < draftFlatSorted.length && (
                        <div className="flex justify-center pt-2">
                          <Button type="button" variant="outline" onClick={() => setDraftLimit((n) => n + PAGE_CHUNK)}>
                            {t('groupDetail.loadMore')}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {showConfirmedBlock && (
                <div className="space-y-4">
                  <h4 className="text-base font-bold text-slate-900">{t('groupDetail.confirmedSectionTitle')}</h4>
                  <div className="space-y-6">
                    {groupedConfirmedSections.map((s) => renderSectionBlock(s, { prefix: 'confirmed', readOnlyDraft: false }))}
                  </div>
                  {confirmedLimit < confirmedFlatSorted.length && (
                    <div className="flex justify-center pt-2">
                      <Button type="button" variant="outline" onClick={() => setConfirmedLimit((n) => n + PAGE_CHUNK)}>
                        {t('groupDetail.loadMore')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {!showDraftBlock && !showConfirmedBlock && allExpenses.length === 0 && (
                <div className="rounded-3xl border-2 border-dashed border-slate-100 py-16 text-center">
                  <Receipt className="mx-auto mb-3 h-12 w-12 text-slate-200" />
                  <p className="font-medium text-slate-400">{t('groupDetail.noExpenses')}</p>
                  <Button className="mt-4" onClick={onOpenAddExpense} disabled={!canAddExpense} title={addExpenseDisabledHint}>
                    {t('groupDetail.addFirstExpense')}
                  </Button>
                </div>
              )}
              {!showDraftBlock && !showConfirmedBlock && allExpenses.length > 0 && (
                <p className="py-10 text-center text-sm text-slate-500">{t('groupDetail.noMatchingExpenses')}</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
      <InviteModal {...inviteModalProps} />
    </>
  );
}
