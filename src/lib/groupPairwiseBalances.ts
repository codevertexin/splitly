import type { GroupExpenseRow } from '../hooks/useGroupExpenses';
import type { GroupMemberRow } from '../hooks/useGroupMembers';
import { memberLabel } from '../hooks/useGroupMembers';
import { computeLedger } from './ledger';

/** Positive = they owe you; negative = you owe them. */
export type PairwiseNetRow = { member: GroupMemberRow; netIOCents: number };

export type SettlementRow = {
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
};

/**
 * Everyone who can appear as payer or split participant on eligible expenses,
 * merged with group members (so we never miss a counterparty that affects net balance).
 */
export function buildCounterpartyRows(
  meId: string,
  members: GroupMemberRow[],
  eligibleExpenses: GroupExpenseRow[],
): GroupMemberRow[] {
  const byId = new Map(members.map((m) => [m.user_id, m]));
  const ids = new Set<string>();

  for (const e of eligibleExpenses) {
    ids.add(e.paid_by_user_id);
    for (const s of e.splits || []) {
      ids.add(s.user_id);
    }
  }

  ids.delete(meId);

  const out: GroupMemberRow[] = [];
  for (const id of ids) {
    const existing = byId.get(id);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        user_id: id,
        role: 'member',
        full_name: null,
        username: null,
        avatar_url: null,
      });
    }
  }

  out.sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));
  return out;
}

export function computePairwiseNetVsMe(
  meId: string,
  members: GroupMemberRow[],
  eligibleExpenses: GroupExpenseRow[],
  settlements: SettlementRow[],
): PairwiseNetRow[] {
  const counterparties = buildCounterpartyRows(meId, members, eligibleExpenses);

  const ledger = computeLedger({
    currentUserId: meId,
    expenses: eligibleExpenses,
    settlements,
  });

  const out: PairwiseNetRow[] = [];

  for (const m of counterparties) {
    const net = ledger.get(m.user_id) || 0;
    if (net !== 0) {
      out.push({
        member: m,
        netIOCents: net,
      });
    }
  }

  out.sort((a, b) => Math.abs(b.netIOCents) - Math.abs(a.netIOCents));
  return out;
}