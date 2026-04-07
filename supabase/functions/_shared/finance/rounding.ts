export function splitEvenly(totalCents: number, count: number): number[] {
    if (!Number.isInteger(totalCents) || totalCents < 0) {
      throw new Error('totalCents must be a non-negative integer');
    }
  
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error('count must be a positive integer');
    }
  
    const base = Math.floor(totalCents / count);
    const remainder = totalCents % count;
  
    return Array.from({ length: count }, (_, index) => {
      return base + (index < remainder ? 1 : 0);
    });
  }