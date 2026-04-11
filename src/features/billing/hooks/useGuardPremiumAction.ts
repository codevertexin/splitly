import { useCallback, useRef, useState } from 'react';
import {
  BILLING_FEATURE_REGISTRY,
  PENDING_PREMIUM_ACTION_STORAGE_KEY,
} from '../constants/billing.constants';
import {
  clearPendingResumeFeatureAfterCheckout,
  createCheckoutSession,
  markSubscriptionActiveAfterCheckout,
  readValidPendingPremiumMeta,
  writePendingResumeFeatureAfterCheckout,
} from '../services/billing.service';
import { getPremiumResumeHandler } from '../services/premiumResumeRegistry';
import type { BillingFeatureDefinition, BillingFeatureKey, BillingPlanId } from '../types/billing.types';
import { useFeatureAccess } from './useFeatureAccess';

type PendingRun = () => void | Promise<void>;

function newPendingId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function writePendingMeta(id: string, featureKey: BillingFeatureKey) {
  try {
    const payload = JSON.stringify({
      id,
      featureKey,
      createdAt: Date.now(),
    });
    sessionStorage.setItem(PENDING_PREMIUM_ACTION_STORAGE_KEY, payload);
  } catch {
    // ignore
  }
}

function clearPendingMeta() {
  try {
    sessionStorage.removeItem(PENDING_PREMIUM_ACTION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Orchestrates: interest modal (unreleased), upgrade modal (gated), success modal + resume action.
 */
export function useGuardPremiumAction() {
  const featureAccess = useFeatureAccess();
  const { refresh } = featureAccess;

  const [interestModalOpen, setInterestModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [activeFeatureKey, setActiveFeatureKey] = useState<BillingFeatureKey | null>(null);
  /** Set when the interest modal opens (e.g. scan entry point) for analytics / modal copy. */
  const [interestEntrySource, setInterestEntrySource] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const pendingRef = useRef<{ id: string; run: PendingRun } | null>(null);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    clearPendingMeta();
    clearPendingResumeFeatureAfterCheckout();
    setActiveFeatureKey(null);
    setInterestEntrySource(null);
  }, []);

  const guardAndRun = useCallback(
    async (
      featureKey: BillingFeatureKey,
      action: PendingRun,
      opts?: { interestSource?: string },
    ) => {
      const resolution = featureAccess.resolveGate(featureKey);
      if (resolution.gate === 'allowed') {
        await action();
        return;
      }

      const id = newPendingId();
      pendingRef.current = { id, run: action };
      setActiveFeatureKey(featureKey);
      writePendingMeta(id, featureKey);

      if (resolution.gate === 'interest') {
        setInterestEntrySource(opts?.interestSource ?? null);
        setInterestModalOpen(true);
        return;
      }
      setInterestEntrySource(null);
      setUpgradeModalOpen(true);
    },
    [featureAccess],
  );

  const dismissInterestModal = useCallback(() => {
    setInterestModalOpen(false);
    clearPending();
  }, [clearPending]);

  const dismissUpgradeModal = useCallback(() => {
    setUpgradeModalOpen(false);
    clearPending();
  }, [clearPending]);

  const startCheckoutForActiveFeature = useCallback(async (planId: BillingPlanId) => {
    setCheckoutLoading(true);
    try {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const result = await createCheckoutSession({ successReturnPath: returnPath, planId });
      if (result.ok) {
        window.location.assign(result.checkoutUrl);
      }
    } finally {
      setCheckoutLoading(false);
    }
  }, []);

  /**
   * Call when the app detects a successful checkout return (`useCheckoutReturnEffect`).
   * Syncs subscription tier, restores the feature key from session, opens the success modal.
   */
  const handleCheckoutReturn = useCallback(
    async (opts?: { checkoutPlanId?: BillingPlanId }) => {
      markSubscriptionActiveAfterCheckout(opts?.checkoutPlanId);
      await refresh();
      const meta = readValidPendingPremiumMeta(PENDING_PREMIUM_ACTION_STORAGE_KEY);
      if (meta?.featureKey) {
        setActiveFeatureKey(meta.featureKey);
      }
      setUpgradeModalOpen(false);
      setSuccessModalOpen(true);
    },
    [refresh],
  );

  const dismissSuccessModal = useCallback(() => {
    setSuccessModalOpen(false);
    clearPendingResumeFeatureAfterCheckout();
    clearPending();
  }, [clearPending]);

  /**
   * After success modal: run the in-memory callback if still present, otherwise the resume registry,
   * otherwise persist the feature key for when the feature screen mounts (e.g. user landed on Dashboard).
   */
  const resumePendingAction = useCallback(async () => {
    const key = activeFeatureKey;
    const run =
      pendingRef.current?.run ?? (key != null ? getPremiumResumeHandler(key) : undefined);

    setSuccessModalOpen(false);
    pendingRef.current = null;
    clearPendingMeta();
    clearPendingResumeFeatureAfterCheckout();
    setActiveFeatureKey(null);

    if (run) {
      await run();
      return;
    }
    if (key) {
      writePendingResumeFeatureAfterCheckout(key);
    }
  }, [activeFeatureKey]);

  const activeFeature: BillingFeatureDefinition | undefined =
    activeFeatureKey != null ? BILLING_FEATURE_REGISTRY[activeFeatureKey] : undefined;

  return {
    ...featureAccess,
    interestModalOpen,
    upgradeModalOpen,
    successModalOpen,
    activeFeatureKey,
    activeFeature,
    interestEntrySource,
    checkoutLoading,
    guardAndRun,
    dismissInterestModal,
    dismissUpgradeModal,
    startCheckoutForActiveFeature,
    handleCheckoutReturn,
    dismissSuccessModal,
    resumePendingAction,
  };
}

export type BillingGuardApi = ReturnType<typeof useGuardPremiumAction>;
