export function buildEqualSharesCents(participantIds: string[], amountCents: number): Record<string, number> {
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

function isDev(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function sumShares(shares: Record<string, number>, participantIds: string[]): number {
  return participantIds.reduce((sum, id) => sum + (shares[id] || 0), 0);
}

function cloneShares(baseShares: Record<string, number>, participantIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of participantIds) out[id] = Math.max(0, baseShares[id] || 0);
  return out;
}

function warnInvariant(message: string, details?: unknown): void {
  if (isDev()) {
    console.warn(`[settlementSplit] ${message}`, details);
  }
}

export function canApplySettlementAwareEqualSplit(input: {
  splitMethod: 'equal' | 'manual' | 'percentage';
  participantIds: string[];
  payerId: string;
  debtsToPayer: Record<string, number>;
}): boolean {
  const { splitMethod, participantIds, payerId, debtsToPayer } = input;
  if (splitMethod !== 'equal') return false;
  if (participantIds.length < 2) return false;
  if (!participantIds.includes(payerId)) return false;
  return participantIds.some((id) => id !== payerId && (debtsToPayer[id] || 0) > 0);
}

export function suggestSettlementAwareEqualSplit(input: {
  amountCents: number;
  participantIds: string[];
  payerId: string;
  debtsToPayer: Record<string, number>;
  enabled: boolean;
  splitMethod: 'equal' | 'manual' | 'percentage';
}): {
  baseShares: Record<string, number>;
  adjustedShares: Record<string, number>;
  applied: boolean;
  transferable: number;
  extrasByDebtor: Record<string, number>;
  reason:
    | 'toggle_off'
    | 'unsupported_split'
    | 'payer_not_included'
    | 'not_enough_participants'
    | 'no_debtors'
    | 'no_transferable'
    | 'applied'
    | 'invariant_failed';
} {
  const { amountCents, participantIds, payerId, debtsToPayer, enabled, splitMethod } = input;
  const baseShares = buildEqualSharesCents(participantIds, amountCents);
  const baseCloned = cloneShares(baseShares, participantIds);
  const extrasByDebtor: Record<string, number> = {};

  if (!enabled) {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'toggle_off' };
  }
  if (splitMethod !== 'equal') {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'unsupported_split' };
  }
  if (participantIds.length < 2) {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'not_enough_participants' };
  }
  if (!participantIds.includes(payerId)) {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'payer_not_included' };
  }

  const debtors = participantIds
    .filter((id) => id !== payerId)
    .map((id) => ({ id, debt: Math.max(0, Math.trunc(debtsToPayer[id] || 0)) }))
    .filter((row) => row.debt > 0);
  if (!debtors.length) {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'no_debtors' };
  }

  const payerBaseShare = baseCloned[payerId] || 0;
  const totalEligibleDebt = debtors.reduce((sum, row) => sum + row.debt, 0);
  const transferable = Math.min(payerBaseShare, totalEligibleDebt);
  if (transferable <= 0) {
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor, reason: 'no_transferable' };
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
    warnInvariant('Invariant failed, falling back to base split', { input, weighted, adjustedShares });
    return { baseShares: baseCloned, adjustedShares: baseCloned, applied: false, transferable: 0, extrasByDebtor: {}, reason: 'invariant_failed' };
  }

  return { baseShares: baseCloned, adjustedShares, applied: extraTotal > 0, transferable: extraTotal, extrasByDebtor, reason: 'applied' };
}

export function applySettlementAwareShift(input: {
  participantIds: string[];
  currentUserId: string;
  equalShares: Record<string, number>;
  debtsToCurrentUser: Record<string, number>;
}): { adjustedShares: Record<string, number>; shift: number } {
  const { participantIds, currentUserId, equalShares, debtsToCurrentUser } = input;
  const amountCents = sumShares(equalShares, participantIds);
  const result = suggestSettlementAwareEqualSplit({
    amountCents,
    participantIds,
    payerId: currentUserId,
    debtsToPayer: debtsToCurrentUser,
    enabled: true,
    splitMethod: 'equal',
  });
  return { adjustedShares: result.adjustedShares, shift: result.transferable };
}

export function computeDebtsToCurrentUser(params: {
  members: Array<{ user_id: string }>;
  currentUserId: string;
  eligibleExpenses: Array<{
    paid_by_user_id: string;
    splits?: Array<{ user_id: string; share_cents: number }>;
  }>;
}): Record<string, number> {
  const { members, currentUserId, eligibleExpenses } = params;
  const debts: Record<string, number> = {};
  for (const person of members) {
    if (person.user_id === currentUserId) continue;
    let netIOwe = 0;
    for (const expense of eligibleExpenses) {
      const splits = expense.splits || [];
      const myShare = splits.find((s) => s.user_id === currentUserId)?.share_cents ?? 0;
      const theirShare = splits.find((s) => s.user_id === person.user_id)?.share_cents ?? 0;
      if (expense.paid_by_user_id === person.user_id) netIOwe += myShare;
      if (expense.paid_by_user_id === currentUserId) netIOwe -= theirShare;
    }
    const theyOweMe = Math.max(0, -netIOwe);
    if (theyOweMe > 0) debts[person.user_id] = theyOweMe;
  }
  return debts;
}

export const computeDebtsToPayer = computeDebtsToCurrentUser;

let hasRunSettlementSelfChecks = false;

export function runSettlementAwareSelfChecks(): void {
  if (!isDev() || hasRunSettlementSelfChecks) return;
  hasRunSettlementSelfChecks = true;

  const scenarios = [
    // 1) One debtor owes more than payer base share -> payer to zero
    suggestSettlementAwareEqualSplit({
      amountCents: 9000,
      participantIds: ['payer', 'a'],
      payerId: 'payer',
      debtsToPayer: { a: 10000 },
      enabled: true,
      splitMethod: 'equal',
    }),
    // 2) One debtor owes less than payer base share -> partial reduction
    suggestSettlementAwareEqualSplit({
      amountCents: 9000,
      participantIds: ['payer', 'a'],
      payerId: 'payer',
      debtsToPayer: { a: 1000 },
      enabled: true,
      splitMethod: 'equal',
    }),
    // 3) Two debtors with different debts -> proportional
    suggestSettlementAwareEqualSplit({
      amountCents: 10000,
      participantIds: ['payer', 'a', 'b'],
      payerId: 'payer',
      debtsToPayer: { a: 1000, b: 3000 },
      enabled: true,
      splitMethod: 'equal',
    }),
    // 4) No eligible debtors -> unchanged
    suggestSettlementAwareEqualSplit({
      amountCents: 10000,
      participantIds: ['payer', 'a', 'b'],
      payerId: 'payer',
      debtsToPayer: {},
      enabled: true,
      splitMethod: 'equal',
    }),
    // 5) Toggle off -> exact base split
    suggestSettlementAwareEqualSplit({
      amountCents: 10001,
      participantIds: ['payer', 'a', 'b'],
      payerId: 'payer',
      debtsToPayer: { a: 2000 },
      enabled: false,
      splitMethod: 'equal',
    }),
    // 6) Rounding-sensitive
    suggestSettlementAwareEqualSplit({
      amountCents: 101,
      participantIds: ['payer', 'a', 'b'],
      payerId: 'payer',
      debtsToPayer: { a: 100, b: 100 },
      enabled: true,
      splitMethod: 'equal',
    }),
  ];

  for (const result of scenarios) {
    const participantIds = Object.keys(result.baseShares);
    const baseTotal = sumShares(result.baseShares, participantIds);
    const adjustedTotal = sumShares(result.adjustedShares, participantIds);
    const nonNegative = participantIds.every((id) => (result.adjustedShares[id] || 0) >= 0);
    if (baseTotal !== adjustedTotal || !nonNegative) {
      warnInvariant('Self-check failed', result);
      break;
    }
  }
}
