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

export type AuthLoginOptions = {
  /** Post-SSO in-app path (stored locally, not sent as Auth Core return_url). */
  returnTo?: string;
  /**
   * Reserved for Auth Core account picker. Not sent until documented by Auth Core
   * (no `prompt=login` / `force_login` in current contract — use logout to switch accounts).
   */
  forceLogin?: boolean;
};

function resolveLoginOptions(returnToOrOptions?: string | AuthLoginOptions): AuthLoginOptions {
  if (typeof returnToOrOptions === 'string') {
    return { returnTo: returnToOrOptions };
  }
  return returnToOrOptions ?? {};
}

/** Auth Core login. `returnTo` is stored for post-callback navigation (not sent as `return_url`). */
export function getAuthLoginUrl(returnToOrOptions?: string | AuthLoginOptions): string {
  const options = resolveLoginOptions(returnToOrOptions);
  if (options.returnTo) storeSsoReturnTo(options.returnTo);
  return loginOrRegisterUrl('/auth/login');
}

export function getAuthRegisterUrl(returnTo?: string): string {
  if (returnTo) storeSsoReturnTo(returnTo);
  return loginOrRegisterUrl('/auth/register');
}

export function getAuthForgotPasswordUrl(): string {
  return buildAuthCoreUrl('/auth/forgot-password', {});
}

/**
 * Auth Core account profile (full page, not embedded).
 * `returnTo`: absolute `https://…` or path starting with `/` — relative paths become `origin + path`.
 *
 * Example:
 * `https://auth.codevertex.cc/account/profile?app=SPLITLY&return_to=https%3A%2F%2Fsplitly.codevertex.cc%2Fsettings`
 */
/** Current page URL for Auth/Help/Legal `return_to` (browser only). */
export function getCurrentAppUrl(): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    return window.location.href;
  }
  return '';
}

export function getAuthProfileManageUrl(returnTo?: string): string {
  const base = stripTrailingSlash(AUTH_BASE_URL);
  const raw = (returnTo ?? (getCurrentAppUrl() || '/settings')).trim() || '/settings';

  let absoluteReturnTo: string;
  if (/^https?:\/\//i.test(raw)) {
    absoluteReturnTo = raw;
  } else if (typeof window !== 'undefined' && window.location?.origin) {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    absoluteReturnTo = `${stripTrailingSlash(window.location.origin)}${path}`;
  } else {
    absoluteReturnTo = raw.startsWith('/') ? raw : `/${raw}`;
  }

  const url = new URL(`${base}/account/profile`);
  url.searchParams.set('app', APP_CODE);
  url.searchParams.set('return_to', absoluteReturnTo);
  url.searchParams.set('layout', 'standalone');
  return url.toString();
}

/**
 * Auth Core logout — clears central session, then redirects to `return_to` (Splitly origin).
 * Example: `…/logout?app=SPLITLY&return_to=https://splitly.codevertex.cc`
 */
export function getAuthLogoutUrl(returnTo?: string): string {
  const raw =
    returnTo ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  const target = stripTrailingSlash(raw);
  return buildAuthCoreUrl('/logout', {
    return_to: target,
  });
}
