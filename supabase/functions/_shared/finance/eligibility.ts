import type { EventStatus, ExpenseStatus } from './types';

/**
 * Resolve a intenção semântica final de affects_balances.
 *
 * Regras iniciais V2:
 * - draft => false
 * - reversed => false
 * - paid_on_the_spot => false (por agora)
 * - evento draft => false
 * - explicitIntent=false => false
 * - confirmed => true
 */
export function resolveAffectsBalances(params: {
  status: ExpenseStatus;
  eventStatus?: EventStatus | null;
  explicitIntent?: boolean | null;
}): boolean {
  const { status, eventStatus, explicitIntent } = params;

  if (status === 'draft') return false;
  if (status === 'reversed') return false;
  if (status === 'paid_on_the_spot') return false;
  if (eventStatus === 'draft') return false;
  if (explicitIntent === false) return false;

  return status === 'confirmed';
}

/**
 * Determina se a expense entra efetivamente no cálculo de balances.
 *
 * Mesmo quando affects_balances existe, mantemos esta função como ponto único
 * de leitura/defesa para evitar divergências entre superfícies.
 */
export function isExpenseEligibleForBalances(params: {
  status: ExpenseStatus;
  affectsBalances: boolean;
  eventStatus?: EventStatus | null;
}): boolean {
  const { status, affectsBalances, eventStatus } = params;

  if (!affectsBalances) return false;
  if (status !== 'confirmed') return false;
  if (eventStatus === 'draft') return false;

  return true;
}