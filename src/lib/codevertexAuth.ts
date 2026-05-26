/**
 * Auth Core (CodeVertex) URLs — Splitly always uses central auth (Startly-style).
 */

import { APP_CODE, AUTH_BASE_URL } from './codevertexConfig';
import { storeSsoReturnTo } from './ssoReturnTo';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Public callback URL where Auth Core redirects with `ticket` + `app`. */
export function getSsoCallbackUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/sso/callback`;
  }
  return '/sso/callback';
}

function buildAuthCoreUrl(path: string, params: Record<string, string>): string {
  const base = stripTrailingSlash(AUTH_BASE_URL);
  const search = new URLSearchParams({ app: APP_CODE, ...params });
  return `${base}${path}?${search.toString()}`;
}

/** Auth Core login. `returnTo` is stored for post-callback navigation (not sent as `return_url`). */
export function getAuthLoginUrl(returnTo?: string): string {
  if (returnTo) storeSsoReturnTo(returnTo);
  return buildAuthCoreUrl('/auth/login', {
    return_url: getSsoCallbackUrl(),
  });
}

export function getAuthRegisterUrl(returnTo?: string): string {
  if (returnTo) storeSsoReturnTo(returnTo);
  return buildAuthCoreUrl('/auth/register', {
    return_url: getSsoCallbackUrl(),
  });
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
