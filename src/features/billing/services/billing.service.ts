import {
  CHECKOUT_SUCCESS_QUERY_PARAM,
  PENDING_PREMIUM_ACTION_TTL_MS,
  PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY,
  SESSION_CHECKOUT_PREMIUM_KEY,
} from '../constants/billing.constants';
import type {
  BillingFeatureKey,
  BillingPlanId,
  CheckoutIntentResult,
  FeatureAccessTier,
  PendingPremiumActionPayload,
  SubscriptionStatusResult,
  SubscriptionTier,
} from '../types/billing.types';

const SESSION_CHECKOUT_TIER_KEY = 'splitly_checkout_subscription_tier_v1';

/**
 * Subscription source — replace with Supabase/Stripe when wired.
 * Dev: `splitly_dev_subscription_tier` = free | pro | premium, or legacy `splitly_dev_premium` = "1" => premium.
 */
const DEV_SUBSCRIPTION_TIER_KEY = 'splitly_dev_subscription_tier';
const LEGACY_PREMIUM_DEV_OVERRIDE_KEY = 'splitly_dev_premium';

function readDevSubscriptionTierOverride(): SubscriptionTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(DEV_SUBSCRIPTION_TIER_KEY)?.trim().toLowerCase();
    if (v === 'free' || v === 'pro' || v === 'premium') {
      return v;
    }
    if (window.localStorage.getItem(LEGACY_PREMIUM_DEV_OVERRIDE_KEY) === '1') {
      return 'premium';
    }
  } catch {
    // ignore
  }
  return null;
}

function readCheckoutSessionTier(): SubscriptionTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const legacy = sessionStorage.getItem(SESSION_CHECKOUT_PREMIUM_KEY);
    if (legacy === '1') {
      return 'premium';
    }
    const t = sessionStorage.getItem(SESSION_CHECKOUT_TIER_KEY)?.trim().toLowerCase();
    if (t === 'pro' || t === 'premium') {
      return t;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Call when checkout completes successfully (return URL or webhook handler).
 * Stub: persists tier from selected plan until tab ends.
 */
export function markSubscriptionActiveAfterCheckout(planId?: BillingPlanId): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_CHECKOUT_PREMIUM_KEY);
    if (planId === 'free') {
      sessionStorage.removeItem(SESSION_CHECKOUT_TIER_KEY);
      return;
    }
    if (planId === 'pro' || planId === 'premium') {
      sessionStorage.setItem(SESSION_CHECKOUT_TIER_KEY, planId);
      return;
    }
    sessionStorage.setItem(SESSION_CHECKOUT_TIER_KEY, 'premium');
  } catch {
    // ignore
  }
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

export function subscriptionTierMeetsRequired(
  current: SubscriptionTier,
  required: FeatureAccessTier,
): boolean {
  const rank: Record<SubscriptionTier, number> = { free: 0, pro: 1, premium: 2 };
  const req: Record<FeatureAccessTier, number> = { free: 0, pro: 1, premium: 2 };
  return rank[current] >= req[required];
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatusResult> {
  const dev = readDevSubscriptionTierOverride();
  if (dev) {
    return { tier: dev };
  }
  const sessionTier = readCheckoutSessionTier();
  if (sessionTier) {
    return { tier: sessionTier };
  }
  return { tier: 'free' };
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
 * Starts checkout for premium — stub redirects back with `checkout_success=1` on the return URL.
 */
const CHECKOUT_PLAN_QUERY_PARAM = 'plan';

export async function createCheckoutSession(options?: {
  successReturnPath?: string;
  /** Passed through for Stripe/edge wiring; stub appends to return URL. */
  planId?: BillingPlanId;
}): Promise<CheckoutIntentResult> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Checkout is only available in the browser' };
  }

  const url = options?.successReturnPath
    ? new URL(options.successReturnPath, window.location.origin)
    : new URL(window.location.href);
  url.searchParams.set(CHECKOUT_SUCCESS_QUERY_PARAM, '1');
  if (options?.planId) {
    url.searchParams.set(CHECKOUT_PLAN_QUERY_PARAM, options.planId);
  }

  // Stub: in production, replace with Stripe Checkout Session URL from edge function
  return {
    ok: true,
    checkoutUrl: url.toString(),
  };
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
