import {
  type CanonicalSplit,
  type CreateExpenseCanonicalInput,
  type CreateExpenseCanonicalResult,
} from '../types.ts';

import {
  resolveAffectsBalances,
  isExpenseEligibleForBalances,
} from '../eligibility.ts';

import { buildSettlementAwareSplits } from './settlementAware.ts';

/**
 * Utilitário interno: valida amount/participants básicos.
 */
function validateBaseInput(input: CreateExpenseCanonicalInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }

  if (!Array.isArray(input.participants) || input.participants.length === 0) {
    throw new Error('participants must contain at least one user');
  }

  const uniqueParticipants = new Set(input.participants);
  if (uniqueParticipants.size !== input.participants.length) {
    throw new Error('participants must not contain duplicates');
  }

  if (!uniqueParticipants.has(input.paidByUserId)) {
    throw new Error('paidByUserId must be included in participants');
  }
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/**
 * Divide um total por N participantes distribuindo restos em cêntimos.
 * Ex: 1000 / 3 -> [334, 333, 333]
 */
function splitEvenly(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  return Array.from({ length: count }, (_, index) => {
    return base + (index < remainder ? 1 : 0);
  });
}

function buildEqualSplits(
  participants: string[],
  amountCents: number
): CanonicalSplit[] {
  const values = splitEvenly(amountCents, participants.length);

  return participants.map((userId, index) => ({
    userId,
    amountCents: values[index],
  }));
}

function buildManualSplits(input: CreateExpenseCanonicalInput): CanonicalSplit[] {
  const manualShares = input.manualShares ?? [];

  if (manualShares.length !== input.participants.length) {
    throw new Error('manualShares must match participants length');
  }

  const allowedParticipants = new Set(input.participants);

  for (const share of manualShares) {
    if (!allowedParticipants.has(share.userId)) {
      throw new Error('manualShares contain a user outside participants');
    }
    if (!Number.isInteger(share.amountCents) || share.amountCents < 0) {
      throw new Error('manual share amount must be a non-negative integer');
    }
  }

  const uniqueUsers = new Set(manualShares.map((s) => s.userId));
  if (uniqueUsers.size !== manualShares.length) {
    throw new Error('manualShares contain duplicate users');
  }

  const total = sum(manualShares.map((s) => s.amountCents));
  if (total !== input.amountCents) {
    throw new Error('manualShares must sum exactly to amountCents');
  }

  return manualShares.map((share) => ({
    userId: share.userId,
    amountCents: share.amountCents,
  }));
}

function buildPercentageSplits(input: CreateExpenseCanonicalInput): CanonicalSplit[] {
  const percentageShares = input.percentageShares ?? [];

  if (percentageShares.length !== input.participants.length) {
    throw new Error('percentageShares must match participants length');
  }

  const allowedParticipants = new Set(input.participants);

  for (const share of percentageShares) {
    if (!allowedParticipants.has(share.userId)) {
      throw new Error('percentageShares contain a user outside participants');
    }
    if (!Number.isFinite(share.percentage) || share.percentage < 0) {
      throw new Error('percentage must be a non-negative number');
    }
  }

  const uniqueUsers = new Set(percentageShares.map((s) => s.userId));
  if (uniqueUsers.size !== percentageShares.length) {
    throw new Error('percentageShares contain duplicate users');
  }

  const totalPercentage = percentageShares.reduce((acc, item) => acc + item.percentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.0001) {
    throw new Error('percentageShares must sum to exactly 100');
  }

  const raw = percentageShares.map((share) => ({
    userId: share.userId,
    exact: (input.amountCents * share.percentage) / 100,
  }));

  const floored = raw.map((item) => ({
    userId: item.userId,
    amountCents: Math.floor(item.exact),
    remainder: item.exact - Math.floor(item.exact),
  }));

  let remaining = input.amountCents - floored.reduce((acc, item) => acc + item.amountCents, 0);

  floored.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.userId.localeCompare(b.userId);
  });

  for (let i = 0; i < floored.length && remaining > 0; i += 1, remaining -= 1) {
    floored[i].amountCents += 1;
  }

  return floored.map((item) => ({
    userId: item.userId,
    amountCents: item.amountCents,
  }));
}

function calculateDeltaByUser(params: {
  participants: string[];
  paidByUserId: string;
  amountCents: number;
  canonicalSplits: CanonicalSplit[];
  eligibleForBalances: boolean;
}): Record<string, number> {
  const { participants, paidByUserId, amountCents, canonicalSplits, eligibleForBalances } = params;
  const deltaByUser: Record<string, number> = {};

  for (const userId of participants) {
    deltaByUser[userId] = 0;
  }

  if (!eligibleForBalances) {
    return deltaByUser;
  }

  deltaByUser[paidByUserId] = (deltaByUser[paidByUserId] ?? 0) + amountCents;

  for (const split of canonicalSplits) {
    deltaByUser[split.userId] = (deltaByUser[split.userId] ?? 0) - split.amountCents;
  }

  return deltaByUser;
}

/**
 * Engine canónico de criação de expense.
 */
export function createExpenseCanonical(
  input: CreateExpenseCanonicalInput
): CreateExpenseCanonicalResult {
  validateBaseInput(input);

  let canonicalSplits: CanonicalSplit[];
  let settlementAwareMeta:
    | { applied: boolean; reason: string; transferable: number }
    | null = null;

  switch (input.requestedSplitMethod) {
    case 'equal':
      canonicalSplits = buildEqualSplits(input.participants, input.amountCents);
      break;

    case 'manual':
      canonicalSplits = buildManualSplits(input);
      break;

    case 'percentage':
      canonicalSplits = buildPercentageSplits(input);
      break;

    case 'settlement_aware': {
      const settlementAware = buildSettlementAwareSplits({
        amountCents: input.amountCents,
        participantIds: input.participants,
        payerId: input.paidByUserId,
        debtsToPayer: input.debtsToPayer ?? {},
      });

      canonicalSplits = settlementAware.splits;
      settlementAwareMeta = {
        applied: settlementAware.applied,
        reason: settlementAware.reason,
        transferable: settlementAware.transferable,
      };
      break;
    }

    default: {
      const exhaustiveCheck: never = input.requestedSplitMethod;
      throw new Error(`Unsupported split method: ${String(exhaustiveCheck)}`);
    }
  }

  const totalFromSplits = sum(canonicalSplits.map((split) => split.amountCents));
  if (totalFromSplits !== input.amountCents) {
    throw new Error('Canonical splits do not sum exactly to amountCents');
  }

  const affectsBalances = resolveAffectsBalances({
    status: input.statusIntent,
    eventStatus: input.eventStatus ?? null,
    explicitIntent: input.explicitAffectsBalancesIntent ?? null,
  });

  const eligibleForBalances = isExpenseEligibleForBalances({
    status: input.statusIntent,
    affectsBalances,
    eventStatus: input.eventStatus ?? null,
  });

  const deltaByUser = calculateDeltaByUser({
    participants: input.participants,
    paidByUserId: input.paidByUserId,
    amountCents: input.amountCents,
    canonicalSplits,
    eligibleForBalances,
  });

  return {
    canonicalSplits,
    affectsBalances,
    eligibleForBalances,
    balanceImpactSummary: {
      groupId: input.groupId,
      eventId: input.eventId ?? null,
      affectsBalances,
      deltaByUser,
    },
    calculationTrace: {
      engineVersion: 'v2',
      splitMethod: input.requestedSplitMethod,
      affectsBalances,
      eligibleForBalances,
      warnings:
        input.requestedSplitMethod === 'settlement_aware' &&
        !(input.debtsToPayer && Object.keys(input.debtsToPayer).length)
          ? ['settlement_aware requested with no debtsToPayer; result may match equal split']
          : [],
      steps: [
        {
          phase: 'input_validation',
          amountCents: input.amountCents,
          participantCount: input.participants.length,
          statusIntent: input.statusIntent,
          eventStatus: input.eventStatus ?? null,
        },
        {
          phase: 'split_calculation',
          splitMethod: input.requestedSplitMethod,
          canonicalSplits,
          settlementAwareMeta,
        },
        {
          phase: 'eligibility_resolution',
          affectsBalances,
          eligibleForBalances,
        },
        {
          phase: 'balance_impact',
          deltaByUser,
        },
      ],
    },
  };
}