import type {
    CreateExpenseCanonicalInput,
    CreateExpenseCanonicalResult,
  } from '../types';
  import { createExpenseCanonical } from './createExpenseCanonical';
  
  export type UpdateExpenseCanonicalInput = CreateExpenseCanonicalInput & {
    expenseId: string;
  };
  
  export type UpdateExpenseCanonicalResult = CreateExpenseCanonicalResult & {
    expenseId: string;
  };
  
  export function updateExpenseCanonical(
    input: UpdateExpenseCanonicalInput
  ): UpdateExpenseCanonicalResult {
    const result = createExpenseCanonical(input);
  
    return {
      expenseId: input.expenseId,
      ...result,
    };
  }