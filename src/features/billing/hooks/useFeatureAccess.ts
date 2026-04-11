import { useCallback, useEffect, useState } from 'react';
import { BILLING_FEATURE_REGISTRY } from '../constants/billing.constants';
import { getSubscriptionStatus, subscriptionTierMeetsRequired } from '../services/billing.service';
import type {
  BillingFeatureKey,
  FeatureGateResolution,
  SubscriptionTier,
} from '../types/billing.types';

/**
 * Resolves subscription tier and per-feature gating (interest vs upgrade vs allowed).
 */
export function useFeatureAccess() {
  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { tier: next } = await getSubscriptionStatus();
      setTier(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPremium = tier === 'premium';
  const isProOrHigher = tier === 'pro' || tier === 'premium';

  const resolveGate = useCallback(
    (featureKey: BillingFeatureKey): FeatureGateResolution => {
      const def = BILLING_FEATURE_REGISTRY[featureKey];
      if (!def) {
        return { gate: 'allowed' };
      }

      if (def.releaseStatus === 'unreleased') {
        return { gate: 'interest', feature: def };
      }

      if (def.releaseStatus === 'released' && !subscriptionTierMeetsRequired(tier, def.tier)) {
        return { gate: 'upgrade', feature: def };
      }

      return { gate: 'allowed' };
    },
    [tier],
  );

  const canUseFeature = useCallback(
    (featureKey: BillingFeatureKey) => resolveGate(featureKey).gate === 'allowed',
    [resolveGate],
  );

  return {
    tier,
    isPremium,
    isProOrHigher,
    loading,
    resolveGate,
    canUseFeature,
    refresh,
  };
}
