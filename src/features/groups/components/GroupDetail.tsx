import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
  LayoutGrid,
  Wallet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Group } from '../../../dbAliases';
import { GroupExpenseRow } from '../../../hooks/useGroupExpenses';
import { GroupMemberRow, memberLabel } from '../../../hooks/useGroupMembers';
import { Button } from '../../../components/ui/Button';
import { InviteModal } from './InviteModal';
import { MemberAvatar } from '../../../components/MemberAvatar';
import { formatCurrencyCents, formatDateOnly } from '../../../lib/dateTime';
import { computePairwiseNetVsMe } from '../../../lib/groupPairwiseBalances';
import { iconForExpenseTitle } from '../../expenses/expenseSuggestions';
import { GroupOnboardingHero } from './GroupOnboardingHero';
import { socialDisplayName } from '../../../lib/displayName';

interface GroupDetailProps {
  group: Group;
  members: GroupMemberRow[];
  membersLoading: boolean;
  expenses: GroupExpenseRow[];
  allExpenses: GroupExpenseRow[];
  activeBatchPreview?: {
    id: string;
    title: string;
    description: string | null;
    is_active: boolean;
    closed_at: string | null;
    created_at: string | null;
  } | null;
  settlements: Array<{
    id: string;
    group_id: string;
    from_user_id: string;
    to_user_id: string;
    amount_cents: number;
    settled_at: string;
  }>;
  expensesLoading: boolean;
  yourBalanceCents: number;
  balanceLoading: boolean;
  balanceError: string | null;
  membersError: string | null;
  currentUserId: string;
  canAddExpense: boolean;
  addExpenseDisabledHint?: string;
  onBack: () => void;
  onSettleUp: (targetUserId?: string, amountCents?: number, targetName?: string) => Promise<void>;
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
  /** Opens the owner flow to name the next cycle and close the current one (handled in GroupDetailPage). */
  onOpenCloseBatchModal?: () => void;
  closingCurrentBatch?: boolean;
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
  showOnboardingNextExpenseBanner?: boolean;
  onDismissOnboardingNextExpenseBanner?: () => void;
  highlightAddExpenseCta?: boolean;
  showSettlementHint?: boolean;
  /** Após a primeira despesa confirmada — feedback breve sem alterar cálculos. */
  showFirstExpenseSuccessBanner?: boolean;
  onDismissFirstExpenseSuccessBanner?: () => void;
}

function expensePayerName(expense: GroupExpenseRow, members: GroupMemberRow[]) {
  const m = members.find((x) => x.user_id === expense.paid_by_user_id);
  const prof = expense.profiles;
  return socialDisplayName(
    {
      full_name: prof?.full_name ?? m?.full_name ?? null,
      username: prof?.username ?? m?.username ?? null,
    },
    expense.paid_by_user_id,
  );
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

type BatchSection = {
  batchId: string | null;
  title: string;
  description?: string | null;
  isActive: boolean;
  closedAt?: string | null;
  createdAtMs: number;
  totalAmountCents: number;
  expenseCount: number;
  expenses: GroupExpenseRow[];
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

function groupExpensesIntoBatches(
  items: GroupExpenseRow[],
  t: (k: string) => string,
): BatchSection[] {
  const map = new Map<string, BatchSection>();

  for (const expense of items) {
    const batchKey = expense.batch?.id ?? expense.batch_id ?? '__no_batch__';
    const batchTitle = expense.batch?.title || t('groupDetail.batchFallbackTitle');

    if (!map.has(batchKey)) {
      map.set(batchKey, {
        batchId: batchKey === '__no_batch__' ? null : batchKey,
        title: batchTitle,
        description: expense.batch?.description ?? null,
        isActive: expense.batch?.is_active ?? false,
        closedAt: expense.batch?.closed_at ?? null,
        createdAtMs: expense.batch?.created_at
          ? new Date(expense.batch.created_at).getTime()
          : 0,
        totalAmountCents: 0,
        expenseCount: 0,
        expenses: [],
      });
    }

    const batch = map.get(batchKey)!;
    batch.expenses.push(expense);
    batch.totalAmountCents += expense.amount_cents;
    batch.expenseCount += 1;
  }

  const result = Array.from(map.values());

  for (const batch of result) {
    batch.expenses.sort(
      (a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime(),
    );
  }

  result.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.createdAtMs - a.createdAtMs;
  });

  return result;
}

function applyExpenseFilters(
  list: GroupExpenseRow[],
  filterEventId: string,
  filterMemberId: string,
  opts?: { payerOnly?: boolean },
): GroupExpenseRow[] {
  return list.filter((e) => {
    if (filterEventId !== 'all') {
      if (filterEventId === '__none__') {
        if (e.event?.id) return false;
      } else if (e.event?.id !== filterEventId) return false;
    }
    if (filterMemberId !== 'all') {
      const payer = e.paid_by_user_id === filterMemberId;
      if (opts?.payerOnly) {
        if (!payer) return false;
      } else {
        const inSplit = (e.splits || []).some((s) => s.user_id === filterMemberId);
        if (!payer && !inSplit) return false;
      }
    }
    return true;
  });
}

export function GroupDetail({
  group,
  settlements,
  members,
  membersLoading,
  expenses,
  allExpenses,
  activeBatchPreview,
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
  onOpenCloseBatchModal,
  closingCurrentBatch = false,
  onRequestPayment,
  canEditExpense,
  onEditExpense,
  requestingUserIds,
  requestedUserIds,
  requestFeedback,
  inviteModalProps,
  actionLoading,
  onRetryBalance,
  showOnboardingNextExpenseBanner = false,
  onDismissOnboardingNextExpenseBanner,
  highlightAddExpenseCta = false,
  showSettlementHint = false,
  showFirstExpenseSuccessBanner = false,
  onDismissFirstExpenseSuccessBanner,
}: GroupDetailProps) {
  const settleBusy = settleActionLoading ?? actionLoading;
  const { t, i18n } = useTranslation();
const navigate = useNavigate();
const [showSettleConfirm, setShowSettleConfirm] = useState(false);
const [showSettleHelp, setShowSettleHelp] = useState(false);
const [selectedSettleRow, setSelectedSettleRow] = useState<{
  targetUserId: string;
  amountCents: number;
  targetName: string;
} | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const sectionStateKey = `splitly_group_expanded_sections_v2_${group.id}`;
  const historySubtabStateKey = `splitly_group_history_subtab_v1_${group.id}`;
  const [filterEventId, setFilterEventId] = useState<string>('all');
  const [filterMemberId, setFilterMemberId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'confirmed'>('all');
  const [confirmedLimit, setConfirmedLimit] = useState(PAGE_CHUNK);
  const [draftLimit, setDraftLimit] = useState(PAGE_CHUNK);
  const [detailTab, setDetailTab] = useState<'overview' | 'expenses' | 'history' | 'members'>('overview');
  const [historySubtab, setHistorySubtab] = useState<'group_expenses' | 'events'>('group_expenses');
  const [memberSearch, setMemberSearch] = useState('');
  /** After navigating to a group, apply default tab once the expense list has loaded. */
  const pendingInitialTabRef = useRef(true);

  const locale =
    i18n.language === 'pt-BR'
      ? 'pt-BR'
      : i18n.language === 'pt-PT'
        ? 'pt-PT'
        : i18n.language === 'es'
          ? 'es-ES'
          : 'en-IE';

          const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale });

          const confirmedIds = useMemo(
            () => new Set(expenses.map((e) => e.id)),
            [expenses],
          );
        
          /** Sem despesas nenhumas no grupo: mostrar onboarding. */
          const showFinancialOnboarding = !expensesLoading && allExpenses.length === 0;
        
          /** Separação principal: batch ativo = despesas atuais; batch fechado = histórico */
          const activeBatchExpenses = useMemo(
            () => allExpenses.filter((e) => e.batch?.is_active === true),
            [allExpenses],
          );
        
          const historicalExpenses = useMemo(
            () => allExpenses.filter((e) => e.batch?.is_active === false),
            [allExpenses],
          );
        
          /** Na tab "Despesas", drafts/confirmed são apenas do batch ativo */
          const activeDraftExpenses = useMemo(
            () => activeBatchExpenses.filter((e) => !confirmedIds.has(e.id)),
            [activeBatchExpenses, confirmedIds],
          );
        
          const activeConfirmedExpenses = useMemo(
            () => activeBatchExpenses.filter((e) => confirmedIds.has(e.id)),
            [activeBatchExpenses, confirmedIds],
          );
        
          const eventOptions = useMemo(() => {
            const map = new Map<string, string>();
            for (const e of allExpenses) {
              if (e.event?.id && e.event.title) map.set(e.event.id, e.event.title);
            }
            return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
          }, [allExpenses]);
        
          const draftFiltered = useMemo(
            () => applyExpenseFilters(activeDraftExpenses, filterEventId, filterMemberId),
            [activeDraftExpenses, filterEventId, filterMemberId],
          );
        
          const confirmedFiltered = useMemo(
            () => applyExpenseFilters(activeConfirmedExpenses, filterEventId, filterMemberId),
            [activeConfirmedExpenses, filterEventId, filterMemberId],
          );
        
          const historicalFilteredForSubtab = useMemo(
            () =>
              applyExpenseFilters(
                historicalExpenses,
                historySubtab === 'events' ? filterEventId : 'all',
                filterMemberId,
                { payerOnly: historySubtab === 'group_expenses' },
              ),
            [historicalExpenses, historySubtab, filterEventId, filterMemberId],
          );

          const historicalGroupExpenses = useMemo(
            () => historicalFilteredForSubtab.filter((e) => !e.event?.id),
            [historicalFilteredForSubtab],
          );

          const historicalEventExpenses = useMemo(
            () => historicalFilteredForSubtab.filter((e) => Boolean(e.event?.id)),
            [historicalFilteredForSubtab],
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
        
          const draftVisibleFlat = useMemo(
            () => draftFlatSorted.slice(0, draftLimit),
            [draftFlatSorted, draftLimit],
          );
        
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
        
          const groupedHistoricalGroupBatches = useMemo(
            () => groupExpensesIntoBatches(historicalGroupExpenses, (k) => t(k)),
            [historicalGroupExpenses, t],
          );

          const groupedHistoricalEventBatches = useMemo(() => {
            const batches = groupExpensesIntoBatches(historicalEventExpenses, (k) => t(k));
            return batches.map((batch) => ({
              batch,
              eventSections: groupExpensesIntoSections(batch.expenses, (k) => t(k)),
            }));
          }, [historicalEventExpenses, t]);

          const currentActiveBatch = useMemo(() => {
            const grouped = groupExpensesIntoBatches(activeBatchExpenses, (k) => t(k));
            const fromExpenses = grouped.find((b) => b.isActive);
            if (fromExpenses) return fromExpenses;
            if (!activeBatchPreview?.is_active) return null;
            return {
              batchId: activeBatchPreview.id,
              title: activeBatchPreview.title,
              description: activeBatchPreview.description,
              isActive: true,
              closedAt: activeBatchPreview.closed_at,
              createdAtMs: activeBatchPreview.created_at
                ? new Date(activeBatchPreview.created_at).getTime()
                : 0,
              totalAmountCents: 0,
              expenseCount: 0,
              expenses: [],
            };
          }, [activeBatchExpenses, activeBatchPreview, t]);

          /** Soma bruta das despesas no ciclo ativo (alinha com o cartão no separador Despesas). */
          const activeCycleGrossTotalCents = useMemo(
            () => activeBatchExpenses.reduce((sum, e) => sum + e.amount_cents, 0),
            [activeBatchExpenses],
          );

          const openCycleBreakdownLine = useMemo(() => {
            if (expensesLoading) return null;
            if (activeBatchExpenses.length === 0) return t('groupDetail.openCycleBreakdownNone');
            const hasGroup = activeBatchExpenses.some((e) => !e.event?.id);
            const hasEvent = activeBatchExpenses.some((e) => Boolean(e.event?.id));
            if (hasGroup && hasEvent) return t('groupDetail.openCycleBreakdownBoth');
            if (hasEvent) return t('groupDetail.openCycleBreakdownEventsOnly');
            return t('groupDetail.openCycleBreakdownGroupOnly');
          }, [activeBatchExpenses, expensesLoading, t]);

  const pairwiseRows = useMemo(
    () => computePairwiseNetVsMe(currentUserId, members, expenses, settlements),
    [currentUserId, members, expenses, settlements],
  );

  const theyOweYou = useMemo(
    () => pairwiseRows.filter((r) => r.netIOCents > 0).sort((a, b) => b.netIOCents - a.netIOCents),
    [pairwiseRows],
  );

  const youOweThem = useMemo(
    () => pairwiseRows.filter((r) => r.netIOCents < 0).sort((a, b) => a.netIOCents - b.netIOCents),
    [pairwiseRows],
  );

  const pairwiseByUserId = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of pairwiseRows) {
      m.set(row.member.user_id, row.netIOCents);
    }
    return m;
  }, [pairwiseRows]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const list = [...members];
    list.sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));
    if (!q) return list;
    return list.filter((m) => memberLabel(m).toLowerCase().includes(q));
  }, [members, memberSearch]);

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

  const detailTabs = useMemo(
    () =>
      [
        { id: 'overview' as const, icon: LayoutGrid, label: t('groupDetail.tabOverview') },
        { id: 'expenses' as const, icon: Wallet, label: t('groupDetail.tabExpenses') },
        { id: 'history' as const, icon: Receipt, label: t('groupDetail.tabHistory') },
        { id: 'members' as const, icon: Users, label: t('groupDetail.tabMembers') },
      ] as const,
    [t],
  );

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(historySubtabStateKey);
      if (raw === 'group_expenses' || raw === 'events') {
        setHistorySubtab(raw);
        return;
      }
    } catch {
      // ignore
    }
    setHistorySubtab('group_expenses');
  }, [historySubtabStateKey]);

  useEffect(() => {
    try {
      localStorage.setItem(historySubtabStateKey, historySubtab);
    } catch {
      // ignore
    }
  }, [historySubtabStateKey, historySubtab]);

  useEffect(() => {
    pendingInitialTabRef.current = true;
    setMemberSearch('');
  }, [group.id]);

  const hasExpensesForGroup = useMemo(
    () => allExpenses.some((e) => e.group_id === group.id),
    [allExpenses, group.id],
  );

  useEffect(() => {
    if (expensesLoading || !pendingInitialTabRef.current) return;

    pendingInitialTabRef.current = false;

    setDetailTab((current) => {
      if (current !== 'overview') return current;
      return hasExpensesForGroup ? 'expenses' : 'overview';
    });
  }, [group.id, expensesLoading, hasExpensesForGroup]);

  const handleSettleUp = async () => {
    if (!selectedSettleRow) {
      setShowSettleConfirm(false);
      return;
    }
  
    await onSettleUp(
      selectedSettleRow.targetUserId,
      selectedSettleRow.amountCents,
      selectedSettleRow.targetName,
    );
  
    setShowSettleConfirm(false);
    setSelectedSettleRow(null);
  };

  const formatEventDates = (ev: NonNullable<GroupExpenseRow['event']>) => {
    const start = ev.starts_at ? formatDateOnly(ev.starts_at, locale) : null;
    const end = ev.ends_at ? formatDateOnly(ev.ends_at, locale) : null;
    if (start && end) return t('groupDetail.eventDateShort', { start, end });
    if (start) return t('groupDetail.eventDateStart', { date: start });
    return null;
  };

  /** No separador Despesas: eventos abertos mostram a data em vez do estado «Aberto». */
  const renderEventSectionBadge = (ev: NonNullable<ExpenseSection['eventMeta']>) => {
    const dateLine = formatEventDates(ev);
    if (ev.status === 'open') {
      if (!dateLine) return null;
      return (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
          <Calendar className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate normal-case">{dateLine}</span>
        </span>
      );
    }
    if (ev.status === 'draft') {
      return (
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
          {t('groupDetail.eventStatusDraft')}
          {dateLine ? <span className="font-semibold normal-case">· {dateLine}</span> : null}
        </span>
      );
    }
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
        {t('groupDetail.eventStatusClosed')}
        {dateLine ? <span className="font-semibold normal-case">· {dateLine}</span> : null}
      </span>
    );
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
  : editable
    ? 'border-sky-200 bg-sky-50 hover:bg-sky-100 hover:border-sky-300'
    : 'border-slate-100/90 bg-white hover:border-slate-200'
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
  <span className="hidden text-xs font-semibold text-sky-700 group-hover:inline sm:inline">
    {t('expenseForm.editAction')}
  </span>
)}
      </motion.li>
    );
  };

  const renderSectionBlock = (
    section: ExpenseSection,
    opts: { prefix: string; readOnlyDraft: boolean },
  ) => {
    const { prefix, readOnlyDraft } = opts;
    const sectionKey = section.eventId ?? '__ungrouped__';
    const expandKey = `${prefix}:${sectionKey}`;
    const isExpanded = expandedSections[expandKey] ?? true;
    const ev = section.eventMeta;
    const sectionHasEditableExpense = section.expenses.some((e) => canEditExpense(e));

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
          className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 shadow-sm transition-all sm:gap-4 sm:px-4 sm:py-3 ${
            readOnlyDraft
              ? 'border-amber-200/90 bg-amber-50/90 hover:bg-amber-50'
              : sectionHasEditableExpense
                ? 'border-sky-200 bg-sky-50 hover:bg-sky-100 hover:border-sky-300'
                : 'border-slate-100/90 bg-white hover:border-slate-200'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {section.type === 'event' && ev ? (
                <>
                  <p className="shrink-0 text-base font-semibold text-slate-900">{t('groupDetail.withEvent')}</p>
                  {ev.title || section.title ? (
                    <p
                      className="min-w-0 truncate text-base font-semibold text-slate-800"
                      title={ev.title || section.title}
                    >
                      {ev.title || section.title}
                    </p>
                  ) : null}
                  {renderEventSectionBadge(ev)}
                </>
              ) : (
                <p className="truncate text-base font-semibold text-slate-900">{section.title}</p>
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
            {ev?.id && onNavigateToEvent && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
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

  const renderBatchBlock = (
    batch: BatchSection,
    opts: { prefix: string; readOnlyDraft: boolean },
  ) => {
    const { prefix, readOnlyDraft } = opts;
    const batchKey = batch.batchId ?? '__no_batch__';
    const expandKey = `${prefix}:batch:${batchKey}`;
    const isExpanded = expandedSections[expandKey] ?? true;
    const batchHasEditableExpense = batch.expenses.some((e) => canEditExpense(e));

    return (
      <div
        key={expandKey}
        className={`overflow-hidden rounded-2xl border shadow-sm ${
          readOnlyDraft ? 'border-amber-200/90 bg-amber-50/25' : 'border-slate-200/90 bg-white'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSection(`${prefix}:batch`, batchKey)}
          className={`flex w-full items-start gap-3 border-b px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4 ${
            readOnlyDraft
              ? 'border-amber-200/80 bg-amber-50/90 hover:bg-amber-50'
              : batchHasEditableExpense
                ? 'border-sky-200 bg-sky-50 hover:bg-sky-100'
                : 'border-slate-200/90 bg-slate-50/95 hover:bg-slate-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-slate-900">{batch.title}</p>
  
              {batch.isActive ? (
                <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800">
                  {t('groupDetail.batchActive')}
                </span>
              ) : (
                <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                  {t('groupDetail.batchClosed')}
                </span>
              )}
            </div>
  
            <p className="mt-1.5 text-xs font-semibold text-slate-700">
              {formatMoney(batch.totalAmountCents)} · {batch.expenseCount} {t('groupDetail.expensesCountLabel')}
            </p>

            {batch.closedAt && !batch.isActive && (
              <p className="mt-1 text-xs text-slate-500">
                {t('groupDetail.batchClosedOn', { date: formatDateOnly(batch.closedAt, locale) })}
              </p>
            )}
  
            {batch.description && (
              <p className="mt-1 text-xs text-slate-500">{batch.description}</p>
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
            {batch.expenses.map((expense) =>
              renderExpenseRow(expense, {
                readOnlyDraft,
                sectionPrefix: expandKey,
              }),
            )}
          </ul>
        )}
      </div>
    );
  };

  const renderHistoricalEventBatchGroup = (
    batch: BatchSection,
    eventSections: ExpenseSection[],
    opts: { prefix: string; readOnlyDraft: boolean },
  ) => {
    const { prefix, readOnlyDraft } = opts;
    const batchKey = batch.batchId ?? '__no_batch__';
    const expandKey = `${prefix}:batch:${batchKey}`;
    const isExpanded = expandedSections[expandKey] ?? true;
    const batchHasEditableExpense = batch.expenses.some((e) => canEditExpense(e));

    return (
      <div
        key={expandKey}
        className={`overflow-hidden rounded-2xl border shadow-sm ${
          readOnlyDraft ? 'border-amber-200/90 bg-amber-50/25' : 'border-slate-200/90 bg-white'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSection(`${prefix}:batch`, batchKey)}
          className={`flex w-full items-start gap-3 border-b px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4 ${
            readOnlyDraft
              ? 'border-amber-200/80 bg-amber-50/90 hover:bg-amber-50'
              : batchHasEditableExpense
                ? 'border-sky-200 bg-sky-50 hover:bg-sky-100'
                : 'border-slate-200/90 bg-slate-50/95 hover:bg-slate-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-slate-900">{batch.title}</p>
              <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                {t('groupDetail.batchClosed')}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-semibold text-slate-700">
              {formatMoney(batch.totalAmountCents)} · {batch.expenseCount} {t('groupDetail.expensesCountLabel')}
            </p>
            {batch.closedAt && (
              <p className="mt-1 text-xs text-slate-500">
                {t('groupDetail.batchClosedOn', { date: formatDateOnly(batch.closedAt, locale) })}
              </p>
            )}
            {batch.description && <p className="mt-1 text-xs text-slate-500">{batch.description}</p>}
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
          <div className="space-y-4 border-t border-slate-100/90 bg-slate-50/50 p-3 sm:p-4">
            {eventSections.map((section) =>
              renderSectionBlock(section, {
                prefix: `${prefix}:b:${batchKey}`,
                readOnlyDraft,
              }),
            )}
          </div>
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
              className={`w-full py-3.5 text-base font-bold shadow-lg shadow-blue-900/15 sm:w-auto sm:min-w-[220px] ${
                highlightAddExpenseCta ? 'ring-2 ring-blue-400 ring-offset-2 animate-pulse' : ''
              }`}
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
        <p className="text-sm font-bold text-green-900">
          {t('groupDetail.confirmSettleTitle')}
        </p>
        <p className="text-xs text-green-700">
          {selectedSettleRow
            ? t('groupDetail.confirmSettleRecipientBody', {
                name: selectedSettleRow.targetName,
                amount: formatMoney(selectedSettleRow.amountCents),
              })
            : t('groupDetail.confirmSettleGenericBody')}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setShowSettleConfirm(false);
            setSelectedSettleRow(null);
          }}
          variant="outline"
          size="sm"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          onClick={handleSettleUp}
          disabled={settleBusy}
          loading={settleBusy}
          variant="success"
          size="sm"
        >
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

          {showOnboardingNextExpenseBanner && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <span>{t('groupDetail.onboardingNextExpenseBanner')}</span>
              {onDismissOnboardingNextExpenseBanner && (
                <button
                  type="button"
                  className="shrink-0 font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
                  onClick={onDismissOnboardingNextExpenseBanner}
                >
                  {t('groupDetail.dismissNotice')}
                </button>
              )}
            </div>
          )}

          {showFirstExpenseSuccessBanner && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <span>{t('groupDetail.firstExpenseSuccessBanner')}</span>
              {onDismissFirstExpenseSuccessBanner && (
                <button
                  type="button"
                  className="shrink-0 font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
                  onClick={onDismissFirstExpenseSuccessBanner}
                >
                  {t('groupDetail.dismissNotice')}
                </button>
              )}
            </div>
          )}

          {members.length === 1 && expenses.length > 0 && !showFinancialOnboarding && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50/90 p-4 text-sm text-violet-950 sm:flex-row sm:items-center sm:justify-between">
              <span className="leading-relaxed">{t('groupDetail.soloMemberInviteNudge')}</span>
              <Button type="button" variant="primary" size="sm" className="shrink-0" onClick={onInvite}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t('groupDetail.invite')}
              </Button>
            </div>
          )}

          <div
            className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-100/90 p-2 shadow-sm sm:flex sm:flex-nowrap sm:gap-1.5 sm:overflow-x-auto sm:rounded-2xl sm:border-slate-100 sm:bg-slate-50/90 sm:p-1 sm:shadow-sm"
            role="tablist"
            aria-label={t('groupDetail.tabListAriaLabel')}
          >
            {detailTabs.map((tab) => {
              const active = detailTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDetailTab(tab.id)}
                  className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-center transition-all sm:min-h-0 sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:shrink-0 sm:whitespace-nowrap ${
                    active
                      ? 'bg-white text-blue-700 shadow-md ring-2 ring-blue-500/35 sm:shadow-sm sm:ring-1 sm:ring-slate-200/80'
                      : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 active:scale-[0.99] sm:text-slate-500 sm:hover:bg-white/60 sm:hover:text-slate-800 sm:active:scale-100'
                  }`}
                >
                  <tab.icon
                    className={`h-5 w-5 shrink-0 sm:h-4 sm:w-4 ${active ? 'opacity-100' : 'opacity-80'}`}
                    aria-hidden
                  />
                  <span className="px-0.5 text-center text-[11px] font-bold leading-snug sm:text-left sm:text-sm">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>

          {detailTab === 'overview' && showFinancialOnboarding && (
            <GroupOnboardingHero
              hasDrafts={activeDraftExpenses.length > 0}
              onAddExpense={onOpenAddExpense}
              onInvite={onInvite}
              onCreateEvent={onOpenCreateEvent}
            />
          )}

          {detailTab === 'overview' && !showFinancialOnboarding && (
            <>
          <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <section className="rounded-3xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-white to-slate-50/80 p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
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
                onClick={() => {
                  setSelectedSettleRow(null);
                  setShowSettleConfirm(true);
                }}
                className={`mt-4 w-full py-3.5 text-base font-bold shadow-lg ring-2 border ${
                  yourBalanceCents > 0
                    ? 'border-emerald-900/15 bg-emerald-700 text-white shadow-emerald-950/25 ring-emerald-800/20 hover:bg-emerald-800'
                    : 'border-red-900/15 bg-red-700 text-white shadow-red-950/20 ring-red-800/25 hover:bg-red-800'
                } ${showSettlementHint ? 'ring-offset-2 animate-pulse' : ''}`}
              >
                <Scale className="mr-2 h-5 w-5 shrink-0" />
                {yourBalanceCents > 0 ? t('groupDetail.ctaRequestPayments') : t('groupDetail.ctaSettleDebts')}
              </Button>
            )}
            {showSettlementHint && (
              <p className="mt-2 text-xs text-emerald-800/90">{t('groupDetail.onboardingSettlementHint')}</p>
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

          <section className="rounded-3xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/40 to-slate-50/90 p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('groupDetail.openCycleTotalLabel')}
            </p>
            <p className="mt-1.5 text-4xl font-extrabold tabular-nums tracking-tight text-slate-800 sm:text-5xl">
              {expensesLoading ? '…' : formatMoney(activeCycleGrossTotalCents)}
            </p>
            {openCycleBreakdownLine && (
              <p className="mt-2 text-sm font-medium text-slate-600">{openCycleBreakdownLine}</p>
            )}
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">{t('groupDetail.openCycleTotalFootnote')}</p>
          </section>
          </div>

          <section
            className={`mb-8 ${showFirstExpenseSuccessBanner && pairwiseRows.length > 0 ? 'rounded-2xl p-1 ring-2 ring-blue-400/35 ring-offset-2' : ''}`}
          >
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
              amount: formatMoney(Math.abs(row.netIOCents)),
            })}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSettleRow({
                targetUserId: row.member.user_id,
                amountCents: Math.abs(row.netIOCents),
                targetName: memberLabel(row.member),
              });
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

            </>
          )}

{detailTab === 'expenses' && (
  <>
    {expensesLoading ? (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
      </div>
    ) : activeBatchExpenses.length === 0 ? (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Receipt className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.noExpenses')}</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          {t('groupDetail.noExpensesDescription')}
        </p>
        <Button
          className="mt-5"
          onClick={onOpenAddExpense}
          disabled={!canAddExpense}
          title={addExpenseDisabledHint}
        >
          {t('groupDetail.addFirstExpense')}
        </Button>
      </div>
    ) : (
      <div className="space-y-6">
        <div
          id="group-expenses"
          className="flex flex-col gap-3 scroll-mt-24 sm:flex-row sm:items-end sm:justify-between"
        >
          <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.expensesHeading')}</h3>
        </div>

        {currentActiveBatch && (
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:border-slate-200/90 sm:bg-slate-50/70 sm:shadow-none">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t('groupDetail.currentBatchHeading')}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">{currentActiveBatch.title}</p>
              <p className="mt-1 text-xs text-slate-600">
                {formatMoney(currentActiveBatch.totalAmountCents)} · {currentActiveBatch.expenseCount}{' '}
                {t('groupDetail.expensesCountLabel')}
                {currentActiveBatch.createdAtMs > 0
                  ? ` · ${formatDateOnly(new Date(currentActiveBatch.createdAtMs).toISOString(), locale)}`
                  : ''}
              </p>
            </div>
            {onOpenCloseBatchModal && isOwner && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenCloseBatchModal}
                loading={closingCurrentBatch}
                disabled={closingCurrentBatch}
                className="shrink-0"
              >
                {t('groupDetail.closeBatch')}
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:border-slate-100 sm:bg-slate-50/50 sm:shadow-none sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t('groupDetail.filterStatus')}
            </label>
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
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t('groupDetail.filterEvent')}
            </label>
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
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {historySubtab === 'group_expenses'
                ? t('groupDetail.filterPayer')
                : t('groupDetail.filterMember')}
            </label>
            <select
              value={filterMemberId}
              onChange={(e) => setFilterMemberId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">
                {historySubtab === 'group_expenses'
                  ? t('groupDetail.filterPayerAll')
                  : t('groupDetail.filterMemberAll')}
              </option>
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
                <div className="space-y-6">
                  {groupedDraftSections.map((section) =>
                    renderSectionBlock(section, { prefix: 'draft', readOnlyDraft: true }),
                  )}
                </div>

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

            {groupedConfirmedSections.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
                {t('groupDetail.noMatchingExpenses')}
              </p>
            ) : (
              <>
                <div className="space-y-6">
                  {groupedConfirmedSections.map((section) =>
                    renderSectionBlock(section, { prefix: 'confirmed', readOnlyDraft: false }),
                  )}
                </div>

                {confirmedLimit < confirmedFlatSorted.length && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmedLimit((n) => n + PAGE_CHUNK)}
                    >
                      {t('groupDetail.loadMore')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!showDraftBlock && !showConfirmedBlock && activeBatchExpenses.length > 0 && (
          <p className="py-10 text-center text-sm text-slate-500">{t('groupDetail.noMatchingExpenses')}</p>
        )}
      </div>
    )}
  </>
)}

{detailTab === 'history' && (
  <>
    {expensesLoading ? (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
      </div>
    ) : historicalExpenses.length === 0 ? (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Receipt className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.historyHeading')}</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          {t('groupDetail.noHistoryYet')}
        </p>
      </div>
    ) : (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 scroll-mt-24 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.historyHeading')}</h3>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setHistorySubtab('group_expenses')}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              historySubtab === 'group_expenses'
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t('groupDetail.historySubtabGroupExpenses')}
          </button>
          <button
            type="button"
            onClick={() => setHistorySubtab('events')}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              historySubtab === 'events'
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t('groupDetail.historySubtabEvents')}
          </button>
        </div>

        {historySubtab === 'events' && (
          <p className="text-sm text-slate-600">{t('groupDetail.historyEventsByCycleHint')}</p>
        )}

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:border-slate-100 sm:bg-slate-50/50 sm:shadow-none sm:grid-cols-2">
          {historySubtab === 'events' && (
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {t('groupDetail.filterEvent')}
              </label>
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
          )}

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t('groupDetail.filterMember')}
            </label>
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

        {historySubtab === 'group_expenses' ? (
          groupedHistoricalGroupBatches.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
              {t('groupDetail.noGroupExpenseHistoryYet')}
            </p>
          ) : (
            <div className="space-y-6">
              {groupedHistoricalGroupBatches.map((batch) =>
                renderBatchBlock(batch, { prefix: 'history-group', readOnlyDraft: false }),
              )}
            </div>
          )
        ) : groupedHistoricalEventBatches.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
            {t('groupDetail.noEventHistoryYet')}
          </p>
        ) : (
          <div className="space-y-6">
            {groupedHistoricalEventBatches.map(({ batch, eventSections }) =>
              renderHistoricalEventBatchGroup(batch, eventSections, {
                prefix: 'history-events',
                readOnlyDraft: false,
              }),
            )}
          </div>
        )}
      </div>
    )}
  </>
)}

          {detailTab === 'members' && (
            <section className="mb-8 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{t('groupDetail.membersSectionTitle')}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {t('groupDetail.membersSectionSubtitle', { count: members.length })}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onInvite}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('groupDetail.membersInviteCta')}
                </Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={t('groupDetail.membersSearchPlaceholder')}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoComplete="off"
                />
              </div>
              {membersLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
                  <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
                  {t('groupDetail.membersLoading')}
                </div>
              ) : filteredMembers.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">{t('groupDetail.membersNoMatch')}</p>
              ) : (
                <ul className="max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/50 p-2 sm:p-3">
                  {filteredMembers.map((m) => {
                    const isYou = m.user_id === currentUserId;
                    const net = pairwiseByUserId.get(m.user_id);
                    const roleLabel =
                      m.role === 'owner' ? t('groupDetail.memberRoleOwner') : t('groupDetail.memberRoleMember');
                    let statusLabel: string | null = null;
                    if (isYou) {
                      statusLabel = t('groupDetail.memberYou');
                    } else if (net === undefined || net === 0) {
                      statusLabel = t('groupDetail.memberBalanceEven');
                    } else if (net > 0) {
                      statusLabel = t('groupDetail.memberTheyOweYou', { amount: formatMoney(Math.abs(net)) });
                    } else {
                      statusLabel = t('groupDetail.memberYouOweThem', { amount: formatMoney(Math.abs(net)) });
                    }
                    return (
                      <li
                        key={m.user_id}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm sm:px-4"
                      >
                        <MemberAvatar
                          userId={m.user_id}
                          fullName={m.full_name}
                          avatarUrl={m.avatar_url}
                          size="md"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900">{memberLabel(m)}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            <span className="font-medium text-slate-600">{roleLabel}</span>
                            {statusLabel ? <span className="text-slate-400"> · {statusLabel}</span> : null}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </motion.div>
      <InviteModal {...inviteModalProps} />
    </>
  );
}
