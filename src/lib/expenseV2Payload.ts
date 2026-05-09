export type ExpenseSplitMethod = 'equal' | 'manual' | 'percentage' | 'settlement_aware';

type BuildExpenseV2PayloadInput = {
  groupId: string;
  eventId?: string | null;
  title: string;
  description?: string | null;
  currency?: string;
  amountCents: number;
  paidByUserId: string;
  participantIds: string[];
  splitMethod: ExpenseSplitMethod;
  status: 'draft' | 'confirmed';
  manualShares?: Array<{ userId: string; amountCents: number }>;
  percentageShares?: Array<{ userId: string; percentage: number }>;
  affectsBalancesIntent?: boolean | null;
  receiptPath?: string | null;
  receiptFilename?: string | null;
  receiptMimeType?: string | null;
  receiptSizeBytes?: number | null;
};

export function buildExpenseV2Payload(input: BuildExpenseV2PayloadInput) {
  return {
    group_id: input.groupId,
    event_id: input.eventId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    currency: input.currency ?? 'EUR',
    paid_by_user_id: input.paidByUserId,
    participants: input.participantIds,
    requested_split_method: input.splitMethod,
    amount_cents: input.amountCents,
    status_intent: input.status,
    manual_shares: input.manualShares ?? [],
    percentage_shares: input.percentageShares ?? [],
    affects_balances_intent: input.affectsBalancesIntent ?? null,
    receipt_path: input.receiptPath ?? null,
    receipt_filename: input.receiptFilename ?? null,
    receipt_mime_type: input.receiptMimeType ?? null,
    receipt_size_bytes: input.receiptSizeBytes ?? null,
  };
}

export type ExpenseSplitInput = {
  user_id: string;
  share_cents?: number;
  percentage?: number;
};

export type CreateExpenseV2PayloadInput = {
  groupId: string;
  eventId?: string | null;
  title: string;
  description?: string | null;
  amountCents: number;
  currency?: string;
  paidByUserId: string;
  participantIds: string[];
  splitMethod: ExpenseSplitMethod;
  splits?: ExpenseSplitInput[];
  status?: 'draft' | 'confirmed';
  affectsBalancesIntent?: boolean | null;
  receiptPath?: string | null;
  receiptFilename?: string | null;
  receiptMimeType?: string | null;
  receiptSizeBytes?: number | null;
};

export type CreateExpenseV2Payload = {
  group_id: string;
  event_id: string | null;
  title: string;
  description: string;
  currency: string;
  paid_by_user_id: string;
  participants: string[];
  requested_split_method: ExpenseSplitMethod;
  amount_cents: number;
  status_intent: 'draft' | 'confirmed';
  manual_shares: Array<{ userId: string; amountCents: number }>;
  percentage_shares: Array<{ userId: string; percentage: number }>;
  affects_balances_intent?: boolean | null;
  receipt_path?: string | null;
  receipt_filename?: string | null;
  receipt_mime_type?: string | null;
  receipt_size_bytes?: number | null;
};

function normalizeDescription(title: string, description?: string | null): string {
  const trimmedDescription = description?.trim();
  if (trimmedDescription) return trimmedDescription;

  return title.trim();
}

export function buildCreateExpenseV2Payload(
  input: CreateExpenseV2PayloadInput,
): CreateExpenseV2Payload {
  const payload: CreateExpenseV2Payload = {
    group_id: input.groupId,
    event_id: input.eventId ?? null,
    title: input.title.trim(),
    description: normalizeDescription(input.title, input.description),
    currency: input.currency ?? 'EUR',
    paid_by_user_id: input.paidByUserId,
    participants: [...input.participantIds],
    requested_split_method: input.splitMethod,
    amount_cents: input.amountCents,
    status_intent: input.status ?? 'confirmed',
    manual_shares:
      input.splitMethod === 'manual'
        ? (input.splits ?? []).map((split) => ({
            userId: split.user_id,
            amountCents: split.share_cents ?? 0,
          }))
        : [],
    percentage_shares:
      input.splitMethod === 'percentage'
        ? (input.splits ?? []).map((split) => ({
            userId: split.user_id,
            percentage: split.percentage ?? 0,
          }))
        : [],
  };

  if (input.affectsBalancesIntent !== undefined) {
    payload.affects_balances_intent = input.affectsBalancesIntent;
  }
  if (input.receiptPath !== undefined) {
    payload.receipt_path = input.receiptPath;
  }
  if (input.receiptFilename !== undefined) {
    payload.receipt_filename = input.receiptFilename;
  }
  if (input.receiptMimeType !== undefined) {
    payload.receipt_mime_type = input.receiptMimeType;
  }
  if (input.receiptSizeBytes !== undefined) {
    payload.receipt_size_bytes = input.receiptSizeBytes;
  }

  return payload;
}
