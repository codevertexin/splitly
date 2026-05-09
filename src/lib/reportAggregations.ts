import { isAccountingEligibleExpenseRow } from './accountingExpenses';
import { socialDisplayName } from './displayName';

export type ReportExpenseLike = {
  id: string;
  title: string;
  amount_cents: number;
  paid_by_user_id: string;
  status: 'draft' | 'confirmed';
  affects_balances?: boolean | null;
  event_id?: string | null;
  event?: {
    id: string;
    title: string | null;
    status?: string | null;
  } | null;
  profiles?: {
    full_name?: string | null;
    username?: string | null;
  } | null;
  splits?: Array<{
    user_id: string;
    share_cents: number;
  }>;
};

export type ReportSettlementLike = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
};

export type ReportMemberLike = {
  user_id: string;
  full_name: string | null;
  username: string | null;
};

export type PayerTotalsRow = {
  userId: string;
  label: string;
  amountCents: number;
  expenseCount: number;
};

export type EventTotalsRow = {
  eventId: string;
  label: string;
  amountCents: number;
  expenseCount: number;
};

export type MemberNetRow = {
  userId: string;
  label: string;
  netCents: number;
};

export type TransferRow = {
  fromUserId: string;
  fromLabel: string;
  toUserId: string;
  toLabel: string;
  amountCents: number;
};

export type CycleSummaryMetrics = {
  expenseCount: number;
  totalSpentCents: number;
  memberCount: number;
  eventsWithExpenseCount: number;
  settlementCount: number;
};

function memberNameMap(members: ReportMemberLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    map.set(
      m.user_id,
      socialDisplayName(
        {
          full_name: m.full_name,
          username: m.username,
        },
        m.user_id,
      ),
    );
  }
  return map;
}

function expensePayerLabel(expense: ReportExpenseLike, fallbackUserId: string): string {
  return socialDisplayName(
    {
      full_name: expense.profiles?.full_name ?? null,
      username: expense.profiles?.username ?? null,
    },
    fallbackUserId,
  );
}

/** Mesma regra que GroupDetail / accounting: `accountingExpenses.isAccountingEligibleExpenseRow`. */
export function expenseAffectsBalancesInReport(expense: ReportExpenseLike): boolean {
  return isAccountingEligibleExpenseRow(expense);
}

export function totalExpensesCents(expenses: ReportExpenseLike[]): number {
  return expenses.reduce((sum, expense) => sum + (expense.amount_cents || 0), 0);
}

export function cycleSummaryMetrics(input: {
  expenses: ReportExpenseLike[];
  settlements: ReportSettlementLike[];
  members: ReportMemberLike[];
}): CycleSummaryMetrics {
  const { expenses, settlements, members } = input;
  const eventIds = new Set<string>();
  for (const e of expenses) {
    if (e.event_id) eventIds.add(e.event_id);
  }
  return {
    expenseCount: expenses.length,
    totalSpentCents: totalExpensesCents(expenses),
    memberCount: members.length,
    eventsWithExpenseCount: eventIds.size,
    settlementCount: settlements.length,
  };
}

export function totalsByPayer(expenses: ReportExpenseLike[]): PayerTotalsRow[] {
  const byPayer = new Map<string, { amountCents: number; label: string; expenseCount: number }>();
  for (const expense of expenses) {
    const payerId = expense.paid_by_user_id;
    const current = byPayer.get(payerId);
    const nextAmount = (current?.amountCents ?? 0) + (expense.amount_cents || 0);
    const nextCount = (current?.expenseCount ?? 0) + 1;
    byPayer.set(payerId, {
      amountCents: nextAmount,
      expenseCount: nextCount,
      label: current?.label ?? expensePayerLabel(expense, payerId),
    });
  }
  return Array.from(byPayer.entries())
    .map(([userId, row]) => ({
      userId,
      label: row.label,
      amountCents: row.amountCents,
      expenseCount: row.expenseCount,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

/** Apenas eventos ligados (event_id não nulo), com despesas neste conjunto. */
export function totalsByLinkedEventsOnly(expenses: ReportExpenseLike[]): EventTotalsRow[] {
  const byEvent = new Map<string, EventTotalsRow>();
  for (const expense of expenses) {
    if (!expense.event_id) continue;
    const prev = byEvent.get(expense.event_id);
    byEvent.set(expense.event_id, {
      eventId: expense.event_id,
      label: prev?.label ?? (expense.event?.title?.trim() || expense.event_id),
      amountCents: (prev?.amountCents ?? 0) + (expense.amount_cents || 0),
      expenseCount: (prev?.expenseCount ?? 0) + 1,
    });
  }
  return Array.from(byEvent.values()).sort((a, b) => b.amountCents - a.amountCents);
}

/**
 * Saldo líquido por membro no ciclo (paid − owed + efeito de settlements),
 * usando apenas despesas elegíveis para balanços (mesma regra que o resto da app).
 * Inclui todos os membros ativos do grupo, mesmo com saldo 0.
 */
export function computeMemberNetRows(
  members: ReportMemberLike[],
  expenses: ReportExpenseLike[],
  settlements: ReportSettlementLike[],
): MemberNetRow[] {
  const names = memberNameMap(members);
  const netMap = new Map<string, number>();

  for (const m of members) netMap.set(m.user_id, 0);

  for (const expense of expenses) {
    if (!expenseAffectsBalancesInReport(expense)) continue;
    netMap.set(
      expense.paid_by_user_id,
      (netMap.get(expense.paid_by_user_id) ?? 0) + (expense.amount_cents || 0),
    );
    for (const split of expense.splits || []) {
      netMap.set(split.user_id, (netMap.get(split.user_id) ?? 0) - (split.share_cents || 0));
    }
  }

  for (const settlement of settlements) {
    netMap.set(
      settlement.from_user_id,
      (netMap.get(settlement.from_user_id) ?? 0) + (settlement.amount_cents || 0),
    );
    netMap.set(
      settlement.to_user_id,
      (netMap.get(settlement.to_user_id) ?? 0) - (settlement.amount_cents || 0),
    );
  }

  return members
    .map((m) => ({
      userId: m.user_id,
      label: names.get(m.user_id) ?? socialDisplayName({}, m.user_id),
      netCents: netMap.get(m.user_id) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Coluna «Evento»: despesa só de grupo (sem event_id) → rótulo curto; caso contrário título do evento. */
export function reportExpenseEventCell(
  expense: ReportExpenseLike,
  t: (key: string) => string,
): string {
  if (!expense.event_id) return t('reports.expenseEventGroup');
  return expense.event?.title?.trim() || t('reports.noEvent');
}

/**
 * Coluna «Participantes»: para despesas de grupo, texto fixo curto (alinhado à regra de negócio);
 * com evento, lista os nomes a partir dos splits.
 */
export function reportExpenseParticipantsCell(
  expense: ReportExpenseLike,
  nameByUserId: Map<string, string>,
  t: (key: string) => string,
): string {
  if (!expense.event_id) return t('reports.participantsGroupWideShort');
  const splits = expense.splits || [];
  if (splits.length === 0) return '—';
  return splits
    .map((s) => nameByUserId.get(s.user_id) ?? socialDisplayName({}, s.user_id))
    .join(', ');
}

export function buildWhoOwesWho(rows: MemberNetRow[]): TransferRow[] {
  const nonZero = rows.filter((row) => row.netCents !== 0);
  const debtors = nonZero
    .filter((row) => row.netCents < 0)
    .map((row) => ({ ...row, remaining: Math.abs(row.netCents) }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = nonZero
    .filter((row) => row.netCents > 0)
    .map((row) => ({ ...row, remaining: row.netCents }))
    .sort((a, b) => b.remaining - a.remaining);

  const transfers: TransferRow[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        fromLabel: debtor.label,
        toUserId: creditor.userId,
        toLabel: creditor.label,
        amountCents: amount,
      });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
    }

    if (debtor.remaining <= 0) i += 1;
    if (creditor.remaining <= 0) j += 1;
  }

  return transfers;
}
