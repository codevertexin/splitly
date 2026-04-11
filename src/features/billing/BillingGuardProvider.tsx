import React, { createContext, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { useGuardPremiumAction } from './hooks/useGuardPremiumAction';
import type { BillingGuardApi } from './hooks/useGuardPremiumAction';
import { useCheckoutReturnEffect } from './hooks/useUpgrade';
import { BillingGlobalModals } from './components/BillingGlobalModals';

const BillingGuardContext = createContext<BillingGuardApi | null>(null);

export function BillingGuardProvider({
  children,
  defaultEmail = '',
  interestUserId = '',
}: {
  children: React.ReactNode;
  /** Pre-filled email for interest modal (e.g. session user). */
  defaultEmail?: string;
  /** Logged-in user id for idempotent feature-interest registration. */
  interestUserId?: string;
}) {
  const billing = useGuardPremiumAction();
  const { search } = useLocation();

  useCheckoutReturnEffect(search, billing.handleCheckoutReturn);

  return (
    <BillingGuardContext.Provider value={billing}>
      <BillingGlobalModals defaultEmail={defaultEmail} interestUserId={interestUserId} />
      {children}
    </BillingGuardContext.Provider>
  );
}

export function useBillingGuard(): BillingGuardApi {
  const ctx = useContext(BillingGuardContext);
  if (!ctx) {
    throw new Error('useBillingGuard must be used within BillingGuardProvider');
  }
  return ctx;
}
