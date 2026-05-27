import type { BillingFeatureDefinition, BillingPlanId } from '../types/billing.types';

/** sessionStorage key for pending action metadata (callback lives in memory + registry). */
export const PENDING_PREMIUM_ACTION_STORAGE_KEY = 'splitly_pending_premium_action_v1';

/** Max age for pending premium action payload (checkout return + resume). */
export const PENDING_PREMIUM_ACTION_TTL_MS = 30 * 60 * 1000;

/** Query param to detect return from payment provider (extend as needed). */
export const CHECKOUT_SUCCESS_QUERY_PARAM = 'checkout_success';

/**
 * sessionStorage: when the user taps “Continue” after checkout but no resume handler is mounted
 * (e.g. landed on Dashboard), the target feature key is stored so the feature screen can resume once.
 */
export const PENDING_RESUME_FEATURE_AFTER_CHECKOUT_KEY = 'splitly_pending_resume_feature_v1';

/** Default plan highlighted as “recommended” in upgrade modals; checkout uses the user’s selection. */
export const DEFAULT_RECOMMENDED_BILLING_PLAN_ID: BillingPlanId = 'pro';

/** Scan receipt (OCR) — toggle `releaseStatus` / `tier` when shipping. */
export const SCAN_RECEIPT_FEATURE_KEY = 'scan_receipt';

/** `product_events.event_name` — scan receipt / feature interest funnel (metadata carries featureKey, source, tier, etc.). */
export const PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK = 'billing_scan_receipt_interest_click';
export const PRODUCT_EVENT_BILLING_INTEREST_MODAL_OPENED = 'billing_interest_modal_opened';
export const PRODUCT_EVENT_BILLING_INTEREST_SUBMITTED = 'billing_interest_submitted';
export const PRODUCT_EVENT_BILLING_INTEREST_REPEAT_OPEN = 'billing_interest_repeat_registered_open';

/**
 * Registry of billable / gated features.
 * Extend this map as products are defined; UI can override labels per locale.
 */
export const BILLING_FEATURE_REGISTRY: Record<string, BillingFeatureDefinition> = {
  [SCAN_RECEIPT_FEATURE_KEY]: {
    key: SCAN_RECEIPT_FEATURE_KEY,
    releaseStatus: 'unreleased',
    tier: 'pro',
    entitlementKey: SCAN_RECEIPT_FEATURE_KEY,
    label: 'Scan receipt',
  },
  example_unreleased_premium: {
    key: 'example_unreleased_premium',
    releaseStatus: 'unreleased',
    tier: 'premium',
    label: 'Example unreleased premium',
  },
  example_gated_premium: {
    key: 'example_gated_premium',
    releaseStatus: 'released',
    tier: 'premium',
    label: 'Example premium feature',
  },
};
