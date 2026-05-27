/**
 * Billing Core URL builders — no Stripe SDK, no hardcoded price_id in Splitly.
 */

import { APP_CODE, BILLING_BASE_URL, ECOSYSTEM_CODE } from './codevertexConfig';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveAbsoluteReturnTo(returnTo?: string): string {
  const raw = (returnTo ?? window.location.pathname + window.location.search).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${stripTrailingSlash(window.location.origin)}${path}`;
}

/** Billing Core account / subscription management. */
export function getBillingAccountUrl(returnTo?: string): string {
  const base = stripTrailingSlash(BILLING_BASE_URL);
  const url = new URL(`${base}/account`);
  url.searchParams.set('app_code', APP_CODE);
  if (returnTo) {
    url.searchParams.set('return_to', resolveAbsoluteReturnTo(returnTo));
  }
  return url.toString();
}

/** Redirect user to Billing Core checkout (plans handled by Billing Core). */
export function getBillingCheckoutUrl(options?: {
  returnTo?: string;
  featureKey?: string;
  planCode?: string;
}): string {
  const base = stripTrailingSlash(BILLING_BASE_URL);
  const url = new URL(`${base}/checkout`);
  url.searchParams.set('app_code', APP_CODE);
  url.searchParams.set('ecosystem_code', ECOSYSTEM_CODE);
  url.searchParams.set('return_to', resolveAbsoluteReturnTo(options?.returnTo));
  if (options?.featureKey) {
    url.searchParams.set('feature_key', options.featureKey);
  }
  if (options?.planCode && options.planCode !== 'free') {
    url.searchParams.set('plan_code', options.planCode);
  }
  return url.toString();
}
