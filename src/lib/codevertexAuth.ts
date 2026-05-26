/**
 * Auth Core (CodeVertex) URLs — Splitly always uses central auth (Startly-style).
 */

import { APP_CODE, AUTH_BASE_URL } from './codevertexConfig';
import { SSO_CALLBACK_PATH, storeSsoReturnTo } from './ssoReturnTo';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Absolute SSO callback URL for Auth Core `return_url`.
 * Must always be `{origin}/sso/callback` — never a relative `callback` segment.
 */
export function getSsoCallbackUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = stripTrailingSlash(window.location.origin);
    return `${origin}${SSO_CALLBACK_PATH}`;
  }

  const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  if (siteUrl) {
    return `${stripTrailingSlash(siteUrl)}${SSO_CALLBACK_PATH}`;
  }

  throw new Error(
    'Cannot build SSO callback URL: missing window.location.origin and VITE_SITE_URL',
  );
}

function buildAuthCoreUrl(path: string, params: Record<string, string>): string {
  const base = stripTrailingSlash(AUTH_BASE_URL);
  const search = new URLSearchParams({ app: APP_CODE, ...params });
  return `${base}${path}?${search.toString()}`;
}

function loginOrRegisterUrl(path: '/auth/login' | '/auth/register'): string {
  const returnUrl = getSsoCallbackUrl();
  if (!returnUrl.startsWith('http://') && !returnUrl.startsWith('https://')) {
    throw new Error(`return_url must be absolute, got: ${returnUrl}`);
  }
  return buildAuthCoreUrl(path, { return_url: returnUrl });
}

/** Auth Core login. `returnTo` is stored for post-callback navigation (not sent as `return_url`). */
export function getAuthLoginUrl(returnTo?: string): string {
  if (returnTo) storeSsoReturnTo(returnTo);
  return loginOrRegisterUrl('/auth/login');
}

export function getAuthRegisterUrl(returnTo?: string): string {
  if (returnTo) storeSsoReturnTo(returnTo);
  return loginOrRegisterUrl('/auth/register');
}

export function getAuthForgotPasswordUrl(): string {
  return buildAuthCoreUrl('/auth/forgot-password', {});
}

/** Auth Core logout; `returnTo` defaults to current origin. */
export function getAuthLogoutUrl(returnTo?: string): string {
  const target =
    returnTo ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  return buildAuthCoreUrl('/logout', {
    return_to: target,
  });
}
