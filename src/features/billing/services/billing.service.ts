import { supabase } from '../../../lib/supabase';
import { getBillingCheckoutUrl } from '../../../lib/codevertexBilling';
import {
  CHECKOUT_SUCCESS_QUERY_PARAM,
  PENDING_PREMIUM_ACTION_TTL_MS,
  PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY,
} from '../constants/billing.constants';
import type {
  BillingFeatureKey,
  BillingPlanId,
  CheckoutIntentResult,
  CodeVertexEntitlement,
  PendingPremiumActionPayload,
  SubscriptionStatusResult,
  SubscriptionTier,
} from '../types/billing.types';

/**
 * Dev-only: override entitlements via localStorage (never used in production builds).
 * `splitly_dev_subscription_tier` = free | pro | premium
 */
const DEV_SUBSCRIPTION_TIER_KEY = 'splitly_dev_subscription_tier';
const LEGACY_PREMIUM_DEV_OVERRIDE_KEY = 'splitly_dev_premium';

const TIER_ENTITLEMENT_KEYS: Record<SubscriptionTier, string[]> = {
  free: [],
  pro: ['splitly.tier.pro', 'tier_pro', 'pro'],
  premium: ['splitly.tier.premium', 'tier_premium', 'premium'],
};

function readDevSubscriptionTierOverride(): SubscriptionTier | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(DEV_SUBSCRIPTION_TIER_KEY)?.trim().toLowerCase();
    if (v === 'free' || v === 'pro' || v === 'premium') return v;
    if (window.localStorage.getItem(LEGACY_PREMIUM_DEV_OVERRIDE_KEY) === '1') {
      return 'premium';
    }
  } catch {
    // ignore
  }
  return null;
}

function devEntitlementsForTier(tier: SubscriptionTier): CodeVertexEntitlement[] {
  if (tier === 'free') return [];
  return TIER_ENTITLEMENT_KEYS[tier].map((entitlement_key) => ({
    entitlement_key,
    active: true,
  }));
}

function inferTierFromEntitlements(entitlements: CodeVertexEntitlement[]): SubscriptionTier {
  const activeKeys = new Set(
    entitlements.filter((e) => e.active).map((e) => e.entitlement_key.toLowerCase()),
  );
  const has = (keys: string[]) => keys.some((k) => activeKeys.has(k.toLowerCase()));
  if (has(TIER_ENTITLEMENT_KEYS.premium)) return 'premium';
  if (has(TIER_ENTITLEMENT_KEYS.pro)) return 'pro';
  return 'free';
}

export function hasActiveEntitlement(
  entitlements: CodeVertexEntitlement[],
  entitlementKey: string,
): boolean {
  const key = entitlementKey.trim().toLowerCase();
  const alt = key.startsWith('splitly.') ? key.slice('splitly.'.length) : `splitly.${key}`;
  return entitlements.some(
    (e) =>
      e.active &&
      (e.entitlement_key.toLowerCase() === key ||
        e.entitlement_key.toLowerCase() === alt),
  );
}

interface PendingResumePayload {
  featureKey: BillingFeatureKey;
  createdAt: number;
}

export function writePendingResumeFeatureAfterCheckout(featureKey: BillingFeatureKey): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PendingResumePayload = { featureKey, createdAt: Date.now() };
    sessionStorage.setItem(PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readPendingResumeFeatureAfterCheckout(): BillingFeatureKey | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY);
    if (!raw) return null;
    let featureKey: BillingFeatureKey | null = null;
    let createdAt = Date.now();
    try {
      const parsed = JSON.parse(raw) as Partial<PendingResumePayload>;
      if (parsed?.featureKey && typeof parsed.featureKey === 'string') {
        featureKey = parsed.featureKey;
        createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now();
      }
    } catch {
      featureKey = raw;
      createdAt = Date.now();
    }
    if (!featureKey) return null;
    if (Date.now() - createdAt > PENDING_PREMIUM_ACTION_TTL_MS) {
      sessionStorage.removeItem(PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY);
      return null;
    }
    return featureKey;
  } catch {
    return null;
  }
}

export function clearPendingResumeFeatureAfterCheckout(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY);
  } catch {
    // ignore
  }
}

/** @deprecated Checkout success is confirmed via Billing Core + entitlements refresh. */
export function markSubscriptionActiveAfterCheckout(_planId?: BillingPlanId): void {
  // No-op: sessionStorage premium stub removed for CodeVertex compliance.
}

export async function fetchEntitlementsFromBillingCore(): Promise<CodeVertexEntitlement[]> {
  const { data, error } = await supabase.functions.invoke('billing-entitlements', {
    body: {},
  });
  if (error) {
    console.warn('[billing] entitlements fetch failed', error.message);
    return [];
  }
  const list = (data as { entitlements?: CodeVertexEntitlement[] } | null)?.entitlements;
  return Array.isArray(list) ? list : [];
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatusResult> {
  const dev = readDevSubscriptionTierOverride();
  if (dev) {
    const entitlements = devEntitlementsForTier(dev);
    return { tier: dev, entitlements };
  }

  const entitlements = await fetchEntitlementsFromBillingCore();
  const tier = inferTierFromEntitlements(entitlements);
  return { tier, entitlements };
}

/** Reads pending premium meta if present, not expired, and clears stale payloads. */
export function readValidPendingPremiumMeta(storageKey: string): PendingPremiumActionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPremiumActionPayload>;
    if (!parsed?.id || !parsed?.featureKey || typeof parsed.featureKey !== 'string') {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : 0;
    if (Date.now() - createdAt > PENDING_PREMIUM_ACTION_TTL_MS) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return {
      id: parsed.id,
      featureKey: parsed.featureKey,
      createdAt,
    };
  } catch {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Redirect to Billing Core checkout (no Stripe SDK, no price_id in Splitly).
 */
export async function createCheckoutSession(options?: {
  successReturnPath?: string;
  planId?: BillingPlanId;
  featureKey?: string;
}): Promise<CheckoutIntentResult> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Checkout is only available in the browser' };
  }

  const returnPath = options?.successReturnPath ?? `${window.location.pathname}${window.location.search}`;
  const returnUrl = new URL(returnPath, window.location.origin);
  returnUrl.searchParams.set(CHECKOUT_SUCCESS_QUERY_PARAM, '1');
  if (options?.planId) {
    returnUrl.searchParams.set('plan', options.planId);
  }

  const checkoutUrl = getBillingCheckoutUrl({
    returnTo: returnUrl.toString(),
    featureKey: options?.featureKey,
    planCode: options?.planId,
  });

  return { ok: true, checkoutUrl };
}

export function isCheckoutSuccessInUrl(search: string): boolean {
  const params = new URLSearchParams(search);
  return (
    params.get(CHECKOUT_SUCCESS_QUERY_PARAM) === '1' || params.get('checkout') === 'success'
  );
}

export function stripCheckoutSuccessParam(pathname: string, search: string): { path: string; search: string } {
  const params = new URLSearchParams(search);
  params.delete(CHECKOUT_SUCCESS_QUERY_PARAM);
  params.delete('checkout');
  params.delete('plan');
  const next = params.toString();
  return {
    path: pathname,
    search: next ? `?${next}` : '',
  };
}
