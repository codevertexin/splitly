/**
 * Modelo único de relatório (ciclo): HTML e PDF consomem o mesmo contrato.
 * Ordem oficial: 1 Pessoas → 2 Despesas grupo → 3 Eventos → 4 Totais → 5 Comprovativos
 */

import type { Group } from '../dbAliases';
import type { GroupMemberRow, GroupMemberRole } from '../hooks/useGroupMembers';
import type {
  ReportBatchRow,
  ReportExpenseRow,
  ReportSettlementRow,
} from '../hooks/useReportData';
import { REPORT_EVENT_FILTER_GROUP_ONLY } from '../hooks/useReportData';
import { socialDisplayName } from './displayName';
import {
  buildWhoOwesWho,
  computeMemberNetRows,
  cycleSummaryMetrics,
  expenseAffectsBalancesInReport,
  totalExpensesCents,
  totalsByLinkedEventsOnly,
  totalsByPayer,
  type EventTotalsRow,
  type MemberNetRow,
  type PayerTotalsRow,
  type TransferRow,
} from './reportAggregations';

export type ReportFilterMode = 'all' | 'group_only' | 'single_event';

export type ReportTranslate = (key: string, params?: Record<string, unknown>) => string;

export type ReportHeaderView = {
  groupName: string;
  batchTitle: string;
  batchStateLabel: string;
  /** Início do período do ciclo (ISO). */
  periodStartIso: string;
  /** Fim do período se ciclo fechado; null se ainda aberto. */
  periodEndIso: string | null;
  generatedAtIso: string;
  eventFilterLabel: string;
};

export type ReportPersonRowView = {
  userId: string;
  displayName: string;
  roleLabel: string;
  statusLabel: string;
  notes: string | null;
};

export type ReportPeopleSectionView = {
  rows: ReportPersonRowView[];
};

export type ReportGroupExpenseRowView = {
  expenseId: string;
  dateIso: string;
  description: string;
  payerLabel: string;
  amountCents: number;
  currency: string;
  batchTitle: string;
  receiptFilename: string | null;
  hasReceipt: boolean;
};

export type ReportGroupExpensesSectionView = {
  /** Lista de participantes (membros do grupo) mostrada antes da tabela, como nos eventos. */
  participantSummary: string;
  rows: ReportGroupExpenseRowView[];
};

export type ReportEventExpenseRowView = {
  expenseId: string;
  dateIso: string;
  description: string;
  payerLabel: string;
  amountCents: number;
  currency: string;
  receiptFilename: string | null;
  hasReceipt: boolean;
};

export type ReportEventSectionView = {
  eventId: string;
  eventTitle: string;
  participantSummary: string;
  expenses: ReportEventExpenseRowView[];
};

export type ReportTotalsSectionView = {
  grandTotalCents: number;
  summaryMetrics: {
    expenseCount: number;
    settlementCount: number;
    memberCount: number;
    eventsWithExpenseCount: number;
  };
  byPayer: PayerTotalsRow[];
  byEvent: EventTotalsRow[];
  memberNet: MemberNetRow[];
  transfers: TransferRow[];
};

export type ReportReceiptItemView = {
  expenseId: string;
  expenseTitle: string;
  dateIso: string;
  /** Caminho no storage (assinatura URL no cliente). */
  receiptPath: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  amountCents: number;
  currency: string;
  embeddableAsImage: boolean;
};

export type ReportReceiptsSectionView = {
  items: ReportReceiptItemView[];
};

export type ReportViewModel = {
  header: ReportHeaderView;
  peopleSection: ReportPeopleSectionView;
  groupExpensesSection: ReportGroupExpensesSectionView;
  eventSections: ReportEventSectionView[];
  totalsSection: ReportTotalsSectionView;
  receiptsSection: ReportReceiptsSectionView;
  meta: {
    filterMode: ReportFilterMode;
    locale: string;
    currency: string;
    generatedAtIso: string;
  };
};

function memberRoleLabel(role: GroupMemberRole, t: ReportTranslate): string {
  return role === 'owner' ? t('groupDetail.memberRoleOwner') : t('groupDetail.memberRoleMember');
}

function payerLabel(expense: ReportExpenseRow): string {
  return socialDisplayName(
    {
      full_name: expense.profiles?.full_name ?? null,
      username: expense.profiles?.username ?? null,
    },
    expense.paid_by_user_id,
  );
}

function expenseDescription(e: ReportExpenseRow): string {
  const title = e.title?.trim() || '—';
  const d = e.description?.trim();
  return d ? `${title} — ${d}` : title;
}

function embeddableAsImage(expense: ReportExpenseRow): boolean {
  const mime = (expense.receipt_mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const path = (expense.receipt_path || '').toLowerCase();
  return /\.(jpe?g|png|gif|webp)$/i.test(path);
}

export function resolveReportFilterMode(selectedEventId: string): ReportFilterMode {
  if (selectedEventId === 'all') return 'all';
  if (selectedEventId === REPORT_EVENT_FILTER_GROUP_ONLY) return 'group_only';
  return 'single_event';
}

export function buildReportEventFilterLabel(
  selectedEventId: string,
  eventTitle: string | null | undefined,
  t: ReportTranslate,
): string {
  if (selectedEventId === 'all') return t('reports.allEvents');
  if (selectedEventId === REPORT_EVENT_FILTER_GROUP_ONLY) return t('reports.groupExpensesOnly');
  return eventTitle?.trim() || t('reports.allEvents');
}

export type BuildReportViewModelInput = {
  group: Group;
  batch: ReportBatchRow;
  selectedEventId: string;
  /** Título do evento quando o filtro é um evento concreto (para o cabeçalho). */
  selectedEventTitle?: string | null;
  expenses: ReportExpenseRow[];
  settlements: ReportSettlementRow[];
  members: GroupMemberRow[];
  generatedAtIso: string;
  locale: string;
  t: ReportTranslate;
};

export function buildReportViewModel(input: BuildReportViewModelInput): ReportViewModel {
  const {
    group,
    batch,
    selectedEventId,
    selectedEventTitle,
    expenses,
    settlements,
    members,
    generatedAtIso,
    locale,
    t,
  } = input;

  const filterMode = resolveReportFilterMode(selectedEventId);
  const eligible = expenses.filter((e) => expenseAffectsBalancesInReport(e));
  const currency = eligible[0]?.currency || expenses[0]?.currency || 'EUR';

  const nameByUserId = new Map<string, string>();
  for (const m of members) {
    nameByUserId.set(
      m.user_id,
      socialDisplayName({ full_name: m.full_name, username: m.username }, m.user_id),
    );
  }

  const batchStateLabel = batch.is_active
    ? t('reports.batchStateActivePreview')
    : t('reports.batchStateClosed');

  const header: ReportHeaderView = {
    groupName: group.name,
    batchTitle: batch.title,
    batchStateLabel,
    periodStartIso: batch.created_at,
    periodEndIso: batch.closed_at,
    generatedAtIso,
    eventFilterLabel: buildReportEventFilterLabel(
      selectedEventId,
      filterMode === 'single_event' ? selectedEventTitle : null,
      t,
    ),
  };

  const peopleSection: ReportPeopleSectionView = {
    rows: members.map((m) => ({
      userId: m.user_id,
      displayName: nameByUserId.get(m.user_id) ?? socialDisplayName({}, m.user_id),
      roleLabel: memberRoleLabel(m.role, t),
      statusLabel: t('reports.memberStatusActive'),
      notes: null,
    })),
  };

  const groupParticipantSummary =
    [...members]
      .map((m) => nameByUserId.get(m.user_id) ?? socialDisplayName({}, m.user_id))
      .sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }))
      .join(', ') || '—';

  const groupEligible =
    filterMode === 'single_event' ? [] : eligible.filter((e) => !e.event_id);

  const groupExpensesSection: ReportGroupExpensesSectionView = {
    participantSummary: groupParticipantSummary,
    rows: groupEligible.map((e) => ({
      expenseId: e.id,
      dateIso: e.incurred_at,
      description: expenseDescription(e),
      payerLabel: payerLabel(e),
      amountCents: e.amount_cents,
      currency: e.currency || currency,
      batchTitle: batch.title,
      receiptFilename: e.receipt_filename ?? null,
      hasReceipt: Boolean(e.receipt_path),
    })),
  };

  const eventSections: ReportEventSectionView[] = [];
  if (filterMode !== 'group_only') {
    const eventIds = new Set<string>();
    for (const e of eligible) {
      if (e.event_id) eventIds.add(e.event_id);
    }
    if (filterMode === 'single_event' && selectedEventId !== 'all') {
      eventIds.clear();
      eventIds.add(selectedEventId);
    }

    const sortedIds = Array.from(eventIds).sort((a, b) => {
      const ta = eligible.find((x) => x.event_id === a)?.event?.title?.trim() || a;
      const tb = eligible.find((x) => x.event_id === b)?.event?.title?.trim() || b;
      return ta.localeCompare(tb);
    });

    for (const eventId of sortedIds) {
      const evExpenses = eligible.filter((e) => e.event_id === eventId);
      if (evExpenses.length === 0) continue;
      const title = evExpenses[0]?.event?.title?.trim() || eventId;
      const participantIds = new Set<string>();
      for (const ex of evExpenses) {
        for (const s of ex.splits || []) participantIds.add(s.user_id);
      }
      const participantSummary = Array.from(participantIds)
        .sort()
        .map((id) => nameByUserId.get(id) ?? socialDisplayName({}, id))
        .join(', ');

      eventSections.push({
        eventId,
        eventTitle: title,
        participantSummary: participantSummary || '—',
        expenses: evExpenses.map((e) => ({
          expenseId: e.id,
          dateIso: e.incurred_at,
          description: expenseDescription(e),
          payerLabel: payerLabel(e),
          amountCents: e.amount_cents,
          currency: e.currency || currency,
          receiptFilename: e.receipt_filename ?? null,
          hasReceipt: Boolean(e.receipt_path),
        })),
      });
    }
  }

  const metrics = cycleSummaryMetrics({ expenses: eligible, settlements, members });
  const byPayer = totalsByPayer(eligible);
  const byEvent = totalsByLinkedEventsOnly(eligible);
  const memberNet = computeMemberNetRows(members, eligible, settlements);
  const transfers = buildWhoOwesWho(memberNet);

  const totalsSection: ReportTotalsSectionView = {
    grandTotalCents: totalExpensesCents(eligible),
    summaryMetrics: {
      expenseCount: metrics.expenseCount,
      settlementCount: metrics.settlementCount,
      memberCount: metrics.memberCount,
      eventsWithExpenseCount: metrics.eventsWithExpenseCount,
    },
    byPayer,
    byEvent,
    memberNet,
    transfers,
  };

  const receiptsSection: ReportReceiptsSectionView = {
    items: eligible
      .filter((e) => e.receipt_path)
      .map((e) => ({
        expenseId: e.id,
        expenseTitle: e.title,
        dateIso: e.incurred_at,
        receiptPath: e.receipt_path!,
        filename: e.receipt_filename ?? null,
        mimeType: e.receipt_mime_type ?? null,
        sizeBytes: e.receipt_size_bytes ?? null,
        amountCents: e.amount_cents,
        currency: e.currency || currency,
        embeddableAsImage: embeddableAsImage(e),
      })),
  };

  return {
    header,
    peopleSection,
    groupExpensesSection,
    eventSections,
    totalsSection,
    receiptsSection,
    meta: {
      filterMode,
      locale,
      currency,
      generatedAtIso,
    },
  };
}
