export type ExpenseStatus =
  | 'draft'
  | 'confirmed'
  | 'reversed'
  | 'paid_on_the_spot';

export type EventStatus =
  | 'draft'
  | 'open'
  | 'closed';

export type SplitMethod =
  | 'equal'
  | 'manual'
  | 'percentage'
  | 'settlement_aware';

export type CanonicalSplit = {
  userId: string;
  amountCents: number;
};

export type TraceStep = Record<string, unknown>;

export type CalculationTrace = {
  engineVersion: 'v2';
  splitMethod: SplitMethod;
  affectsBalances: boolean;
  eligibleForBalances: boolean;
  warnings: string[];
  steps: TraceStep[];
};

export type BalanceImpactSummary = {
  groupId: string;
  eventId?: string | null;
  affectsBalances: boolean;
  deltaByUser: Record<string, number>;
};

export type ManualShareInput = {
  userId: string;
  amountCents: number;
};

export type PercentageShareInput = {
  userId: string;
  percentage: number;
};

export type CreateExpenseIntent = {
  groupId: string;
  eventId?: string | null;
  paidByUserId: string;
  participants: string[];
  requestedSplitMethod: SplitMethod;
  amountCents: number;
  statusIntent: 'draft' | 'confirmed';
  manualShares?: ManualShareInput[];
  percentageShares?: PercentageShareInput[];
  description?: string;
  explicitAffectsBalancesIntent?: boolean | null;
};

export type CreateExpenseCanonicalInput = CreateExpenseIntent & {
  eventStatus?: EventStatus | null;
};

export type CreateExpenseCanonicalResult = {
  canonicalSplits: CanonicalSplit[];
  affectsBalances: boolean;
  eligibleForBalances: boolean;
  balanceImpactSummary: BalanceImpactSummary;
  calculationTrace: CalculationTrace;
};