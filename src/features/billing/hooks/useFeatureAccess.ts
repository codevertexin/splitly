import { useCallback, useEffect, useState } from 'react';
import { BILLING_FEATURE_REGISTRY } from '../constants/billing.constants';
import {
  getSubscriptionStatus,
  hasActiveEntitlement,
} from '../services/billing.service';
import type {
  BillingFeatureKey,
  CodeVertexEntitlement,
  FeatureGateResolution,
  SubscriptionTier,
} from '../types/billing.types';

/**
 * Resolves subscription tier and per-feature gating (interest vs upgrade vs allowed).
 * Released features are gated by Billing Core entitlements, not product_code.
 */
export function useFeatureAccess() {
  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [entitlements, setEntitlements] = useState<CodeVertexEntitlement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getSubscriptionStatus();
      setTier(status.tier);
      setEntitlements(status.entitlements);
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

      const entitlementKey = def.entitlementKey ?? def.key;
      if (!hasActiveEntitlement(entitlements, entitlementKey)) {
        return { gate: 'upgrade', feature: def };
      }

      return { gate: 'allowed' };
    },
    [entitlements],
  );

  const canUseFeature = useCallback(
    (featureKey: BillingFeatureKey) => resolveGate(featureKey).gate === 'allowed',
    [resolveGate],
  );

  return {
    tier,
    entitlements,
    isPremium,
    isProOrHigher,
    loading,
    resolveGate,
    canUseFeature,
    refresh,
  };
}
