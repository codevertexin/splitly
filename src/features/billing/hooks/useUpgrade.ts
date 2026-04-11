import { useCallback, useEffect, useState } from 'react';
import {
  createCheckoutSession,
  isCheckoutSuccessInUrl,
  stripCheckoutSuccessParam,
} from '../services/billing.service';
import type { BillingPlanId } from '../types/billing.types';

/**
 * Standalone upgrade flow: upgrade modal, checkout redirect, success modal.
 * For full gated actions + resume, prefer `useGuardPremiumAction`.
 */
export function useUpgrade() {
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openUpgradeModal = useCallback(() => {
    setError(null);
    setUpgradeModalOpen(true);
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setUpgradeModalOpen(false);
  }, []);

  const openSuccessModal = useCallback(() => {
    setUpgradeModalOpen(false);
    setSuccessModalOpen(true);
  }, []);

  const closeSuccessModal = useCallback(() => {
    setSuccessModalOpen(false);
  }, []);

  const startCheckout = useCallback(async (successReturnPath?: string, planId?: BillingPlanId) => {
    setCheckoutLoading(true);
    setError(null);
    try {
      const result = await createCheckoutSession({
        successReturnPath: successReturnPath ?? `${window.location.pathname}${window.location.search}`,
        planId,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      window.location.assign(result.checkoutUrl);
    } finally {
      setCheckoutLoading(false);
    }
  }, []);

  return {
    upgradeModalOpen,
    successModalOpen,
    checkoutLoading,
    error,
    openUpgradeModal,
    closeUpgradeModal,
    openSuccessModal,
    closeSuccessModal,
    startCheckout,
    setError,
  };
}

export type CheckoutReturnSuccessPayload = {
  checkoutPlanId?: BillingPlanId;
};

/**
 * Watches `location.search` for checkout success params, clears them from the URL, then invokes callback.
 * Mount once at the app shell (inside `BillingGuardProvider`).
 */
export function useCheckoutReturnEffect(
  search: string,
  onSuccess: (payload?: CheckoutReturnSuccessPayload) => void | Promise<void>,
) {
  useEffect(() => {
    if (!isCheckoutSuccessInUrl(search)) return;
    const params = new URLSearchParams(search);
    const raw = params.get('plan');
    const checkoutPlanId =
      raw === 'free' || raw === 'pro' || raw === 'premium' ? (raw as BillingPlanId) : undefined;
    const stripped = stripCheckoutSuccessParam(window.location.pathname, search);
    window.history.replaceState({}, '', stripped.path + stripped.search);
    void Promise.resolve(onSuccess({ checkoutPlanId }));
  }, [search, onSuccess]);
}
