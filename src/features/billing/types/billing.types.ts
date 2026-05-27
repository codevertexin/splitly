/**
 * Billing / premium gating — types only (no runtime imports).
 */

export type SubscriptionTier = 'free' | 'pro' | 'premium';

/** Release lifecycle for a monetized capability. */
export type FeatureReleaseStatus = 'unreleased' | 'released';

/** Minimum subscription needed to use a released feature (pro ⊂ premium). */
export type FeatureAccessTier = 'free' | 'pro' | 'premium';

export type BillingFeatureKey = string;

/** Active entitlement from Billing Core. */
export interface CodeVertexEntitlement {
  entitlement_key: string;
  active: boolean;
  expires_at?: string | null;
}

export interface BillingFeatureDefinition {
  /** Stable id (e.g. `export_csv`). */
  key: BillingFeatureKey;
  releaseStatus: FeatureReleaseStatus;
  /** When `released`, minimum subscription tier required (`free` = no paid tier). */
  tier: FeatureAccessTier;
  /**
   * Billing Core entitlement key for released features.
   * Defaults to `key` when omitted. Gating uses entitlements, not tier alone.
   */
  entitlementKey?: string;
  /** Short label for modals (optional; can override in UI). */
  label?: string;
}

/** Result of evaluating whether the user may use a feature. */
export type FeatureGateResolution =
  | { gate: 'allowed' }
  | { gate: 'interest'; feature: BillingFeatureDefinition }
  | { gate: 'upgrade'; feature: BillingFeatureDefinition };

export interface PendingPremiumActionPayload {
  id: string;
  featureKey: BillingFeatureKey;
  createdAt: number;
}

export type CheckoutIntentResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

export interface SubscriptionStatusResult {
  /** Display-only hint from entitlements; gating uses `entitlements`. */
  tier: SubscriptionTier;
  entitlements: CodeVertexEntitlement[];
}

export interface FeatureInterestPayload {
  featureKey: BillingFeatureKey;
  /** Required for idempotent deduplication per user + feature. */
  userId?: string;
  email?: string;
  message?: string;
}

export interface FeatureInterestResult {
  ok: boolean;
  error?: string;
  /** True when this user+feature was already recorded (no duplicate write). */
  deduped?: boolean;
}

/** Checkout / sellable plan identifiers (aligned with subscription product tiers). */
export type BillingPlanId = 'free' | 'pro' | 'premium';

export interface UpgradePlanOption {
  id: BillingPlanId;
  /** Short label (e.g. translated plan name). */
  name: string;
  /** Price line shown prominently. */
  price: string;
  /** Optional secondary line (e.g. billing period note). */
  detail?: string;
}

export interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal header (e.g. feature-specific title). */
  title: string;
  subtitle: string;
  benefits: string[];
  plans: UpgradePlanOption[];
  /** Which plan is visually highlighted as recommended. */
  recommendedPlanId: BillingPlanId;
  /** Label for the recommended badge (translated). */
  recommendedBadgeLabel: string;
  onCheckout: (planId: BillingPlanId) => void | Promise<void>;
  primaryCtaLabel: string;
  secondaryCtaLabel: string;
  loading?: boolean;
  error?: string | null;
  /** Initial selection when the modal opens; defaults to `recommendedPlanId`. */
  defaultSelectedPlanId?: BillingPlanId;
}
