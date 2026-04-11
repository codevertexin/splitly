import type { CanonicalSplit } from '../types.ts';

function sumShares(shares: Record<string, number>, participantIds: string[]): number {
  return participantIds.reduce((sum, id) => sum + (shares[id] || 0), 0);
}

function cloneShares(baseShares: Record<string, number>, participantIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of participantIds) out[id] = Math.max(0, baseShares[id] || 0);
  return out;
}

export function buildEqualSharesCents(
  participantIds: string[],
  amountCents: number,
): Record<string, number> {
  if (!participantIds.length || amountCents <= 0) return {};

  const base = Math.floor(amountCents / participantIds.length);
  let remainder = amountCents - base * participantIds.length;
  const out: Record<string, number> = {};

  for (const id of participantIds) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }

  return out;
}

export function suggestSettlementAwareEqualSplit(input: {
  amountCents: number;
  participantIds: string[];
  payerId: string;
  debtsToPayer: Record<string, number>;
}): {
  baseShares: Record<string, number>;
  adjustedShares: Record<string, number>;
  applied: boolean;
  transferable: number;
  extrasByDebtor: Record<string, number>;
  reason:
    | 'payer_not_included'
    | 'not_enough_participants'
    | 'no_debtors'
    | 'no_transferable'
    | 'applied'
    | 'invariant_failed';
} {
  const { amountCents, participantIds, payerId, debtsToPayer } = input;

  const baseShares = buildEqualSharesCents(participantIds, amountCents);
  const baseCloned = cloneShares(baseShares, participantIds);
  const extrasByDebtor: Record<string, number> = {};

  if (participantIds.length < 2) {
    return {
      baseShares: baseCloned,
      adjustedShares: baseCloned,
      applied: false,
      transferable: 0,
      extrasByDebtor,
      reason: 'not_enough_participants',
    };
  }

  if (!participantIds.includes(payerId)) {
    return {
      baseShares: baseCloned,
      adjustedShares: baseCloned,
      applied: false,
      transferable: 0,
      extrasByDebtor,
      reason: 'payer_not_included',
    };
  }

  const debtors = participantIds
    .filter((id) => id !== payerId)
    .map((id) => ({ id, debt: Math.max(0, Math.trunc(debtsToPayer[id] || 0)) }))
    .filter((row) => row.debt > 0);

  if (!debtors.length) {
    return {
      baseShares: baseCloned,
      adjustedShares: baseCloned,
      applied: false,
      transferable: 0,
      extrasByDebtor,
      reason: 'no_debtors',
    };
  }

  const payerBaseShare = baseCloned[payerId] || 0;
  const totalEligibleDebt = debtors.reduce((sum, row) => sum + row.debt, 0);
  const transferable = Math.min(payerBaseShare, totalEligibleDebt);

  if (transferable <= 0) {
    return {
      baseShares: baseCloned,
      adjustedShares: baseCloned,
      applied: false,
      transferable: 0,
      extrasByDebtor,
      reason: 'no_transferable',
    };
  }

  const weighted = debtors.map((row, idx) => {
    const raw = (transferable * row.debt) / totalEligibleDebt;
    const floorShare = Math.min(row.debt, Math.floor(raw));
    return { ...row, idx, floorShare, frac: raw - floorShare };
  });

  let allocated = weighted.reduce((sum, row) => sum + row.floorShare, 0);
  let remaining = transferable - allocated;

  weighted.sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    if (b.debt !== a.debt) return b.debt - a.debt;
    return a.idx - b.idx;
  });

  while (remaining > 0) {
    let progressed = false;

    for (const row of weighted) {
      if (remaining <= 0) break;
      if (row.floorShare >= row.debt) continue;
      row.floorShare += 1;
      remaining -= 1;
      progressed = true;
    }

    if (!progressed) break;
  }

  const adjustedShares = cloneShares(baseCloned, participantIds);
  const extraTotal = weighted.reduce((sum, row) => sum + row.floorShare, 0);

  adjustedShares[payerId] = Math.max(0, adjustedShares[payerId] - extraTotal);

  for (const row of weighted) {
    extrasByDebtor[row.id] = row.floorShare;
    adjustedShares[row.id] = (adjustedShares[row.id] || 0) + row.floorShare;
  }

  const invariantsOk =
    sumShares(adjustedShares, participantIds) === amountCents &&
    participantIds.every((id) => (adjustedShares[id] || 0) >= 0) &&
    extraTotal <= payerBaseShare &&
    weighted.every((row) => row.floorShare <= row.debt);

  if (!invariantsOk) {
    return {
      baseShares: baseCloned,
      adjustedShares: baseCloned,
      applied: false,
      transferable: 0,
      extrasByDebtor: {},
      reason: 'invariant_failed',
    };
  }

  return {
    baseShares: baseCloned,
    adjustedShares,
    applied: extraTotal > 0,
    transferable: extraTotal,
    extrasByDebtor,
    reason: 'applied',
  };
}

export function buildSettlementAwareSplits(input: {
  amountCents: number;
  participantIds: string[];
  payerId: string;
  debtsToPayer: Record<string, number>;
}): {
  splits: CanonicalSplit[];
  applied: boolean;
  reason: string;
  transferable: number;
} {
  const result = suggestSettlementAwareEqualSplit(input);

  return {
    splits: input.participantIds.map((userId) => ({
      userId,
      amountCents: result.adjustedShares[userId] || 0,
    })),
    applied: result.applied,
    reason: result.reason,
    transferable: result.transferable,
  };
}

export function computeDebtsToPayer(params: {
  members: Array<{ user_id: string }>;
  payerId: string;
  eligibleExpenses: Array<{
    paid_by_user_id: string;
    splits?: Array<{ user_id: string; share_cents: number }>;
  }>;
}): Record<string, number> {
  const { members, payerId, eligibleExpenses } = params;
  const debts: Record<string, number> = {};

  for (const person of members) {
    if (person.user_id === payerId) continue;

    let netIOwe = 0;

    for (const expense of eligibleExpenses) {
      const splits = expense.splits || [];
      const payerShare = splits.find((s) => s.user_id === payerId)?.share_cents ?? 0;
      const theirShare = splits.find((s) => s.user_id === person.user_id)?.share_cents ?? 0;

      if (expense.paid_by_user_id === person.user_id) netIOwe += payerShare;
      if (expense.paid_by_user_id === payerId) netIOwe -= theirShare;
    }

    const theyOwePayer = Math.max(0, -netIOwe);
    if (theyOwePayer > 0) debts[person.user_id] = theyOwePayer;
  }

  return debts;
}