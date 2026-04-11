import type { BillingFeatureKey } from '../types/billing.types';

type ResumeFn = () => void | Promise<void>;

const handlers = new Map<BillingFeatureKey, ResumeFn>();

/**
 * Register the in-memory callback to run after a successful upgrade when the user taps “Continue”.
 * Survives React re-renders; does not survive a full page reload — use session pending meta + this registry.
 */
export function registerPremiumResumeHandler(featureKey: BillingFeatureKey, fn: ResumeFn): () => void {
  handlers.set(featureKey, fn);
  return () => {
    if (handlers.get(featureKey) === fn) {
      handlers.delete(featureKey);
    }
  };
}

export function getPremiumResumeHandler(featureKey: BillingFeatureKey): ResumeFn | undefined {
  return handlers.get(featureKey);
}
