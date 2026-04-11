/** Public exports for the billing / premium gating module. */

export {
  BILLING_FEATURE_REGISTRY,
  DEFAULT_RECOMMENDED_BILLING_PLAN_ID,
  PENDING_PREMIUM_ACTION_STORAGE_KEY,
  PRODUCT_EVENT_BILLING_INTEREST_MODAL_OPENED,
  PRODUCT_EVENT_BILLING_INTEREST_REPEAT_OPEN,
  PRODUCT_EVENT_BILLING_INTEREST_SUBMITTED,
  PRODUCT_EVENT_BILLING_SCAN_RECEIPT_CLICK,
  SCAN_RECEIPT_FEATURE_KEY,
} from './constants/billing.constants';
export type * from './types/billing.types';

export * from './services/billing.service';
export * from './services/featureInterest.service';

export { useFeatureAccess } from './hooks/useFeatureAccess';
export { useUpgrade, useCheckoutReturnEffect } from './hooks/useUpgrade';
export { useGuardPremiumAction } from './hooks/useGuardPremiumAction';
export type { BillingGuardApi } from './hooks/useGuardPremiumAction';

export { BillingGuardProvider, useBillingGuard } from './BillingGuardProvider';

export { registerPremiumResumeHandler, getPremiumResumeHandler } from './services/premiumResumeRegistry';

export { UpgradeModal } from './components/UpgradeModal';
export { FeatureInterestModal } from './components/FeatureInterestModal';
export { UpgradeSuccessModal } from './components/UpgradeSuccessModal';
