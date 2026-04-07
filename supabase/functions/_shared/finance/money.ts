export function sumCents(values: number[]): number {
    return values.reduce((acc, value) => acc + value, 0);
  }
  
  export function assertPositiveIntegerCents(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer in cents`);
    }
  }
  
  export function assertNonNegativeIntegerCents(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer in cents`);
    }
  }