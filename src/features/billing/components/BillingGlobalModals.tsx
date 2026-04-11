import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BILLING_FEATURE_REGISTRY,
  DEFAULT_RECOMMENDED_BILLING_PLAN_ID,
  SCAN_RECEIPT_FEATURE_KEY,
} from '../constants/billing.constants';
import { FeatureInterestModal } from './FeatureInterestModal';
import { UpgradeModal } from './UpgradeModal';
import { UpgradeSuccessModal } from './UpgradeSuccessModal';
import { useBillingGuard } from '../BillingGuardProvider';

export function BillingGlobalModals({
  defaultEmail,
  interestUserId,
}: {
  defaultEmail: string;
  interestUserId: string;
}) {
  const { t } = useTranslation();
  const billing = useBillingGuard();

  const upgradePlans = useMemo(
    () => [
      {
        id: 'free' as const,
        name: t('billing.planTierFree'),
        price: t('billing.priceTierFree'),
      },
      {
        id: 'pro' as const,
        name: t('billing.planTierPro'),
        price: t('billing.priceTierPro'),
        detail: t('billing.detailTierPro'),
      },
      {
        id: 'premium' as const,
        name: t('billing.planTierPremium'),
        price: t('billing.priceTierPremium'),
      },
    ],
    [t],
  );

  const upgradeBenefits = useMemo(
    () => [t('billing.upgradeBenefit1'), t('billing.upgradeBenefit2'), t('billing.upgradeBenefit3')],
    [t],
  );

  const resolvedFeatureLabel = useMemo(() => {
    const key = billing.activeFeatureKey ?? SCAN_RECEIPT_FEATURE_KEY;
    return t(`billing.featureLabels.${key}`, {
      defaultValue: billing.activeFeature?.label ?? t('billing.interestModal.titleFallback'),
    });
  }, [t, billing.activeFeatureKey, billing.activeFeature?.label]);

  const interestFeatureUnreleased = useMemo(() => {
    const key = billing.activeFeatureKey ?? SCAN_RECEIPT_FEATURE_KEY;
    const def = billing.activeFeature ?? BILLING_FEATURE_REGISTRY[key];
    return def?.releaseStatus === 'unreleased';
  }, [billing.activeFeature, billing.activeFeatureKey]);

  return (
    <>
      <FeatureInterestModal
        isOpen={billing.interestModalOpen}
        onClose={billing.dismissInterestModal}
        featureKey={billing.activeFeatureKey ?? SCAN_RECEIPT_FEATURE_KEY}
        featureLabel={resolvedFeatureLabel}
        defaultEmail={defaultEmail}
        userId={interestUserId}
        flowSource={billing.interestEntrySource}
        subscriptionTier={billing.tier}
        featureUnreleased={interestFeatureUnreleased}
      />
      <UpgradeModal
        isOpen={billing.upgradeModalOpen}
        onClose={billing.dismissUpgradeModal}
        title={t('billing.upgradeTitle', {
          feature: resolvedFeatureLabel,
        })}
        subtitle={t('billing.upgradeSubtitle')}
        benefits={upgradeBenefits}
        plans={upgradePlans}
        recommendedPlanId={DEFAULT_RECOMMENDED_BILLING_PLAN_ID}
        recommendedBadgeLabel={t('billing.recommendedBadge')}
        onCheckout={(planId) => void billing.startCheckoutForActiveFeature(planId)}
        primaryCtaLabel={t('billing.ctaCheckout')}
        secondaryCtaLabel={t('billing.ctaDismiss')}
        loading={billing.checkoutLoading}
      />
      <UpgradeSuccessModal
        isOpen={billing.successModalOpen}
        onContinue={() => void billing.resumePendingAction()}
        onDismiss={billing.dismissSuccessModal}
      />
    </>
  );
}
