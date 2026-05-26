/**
 * Auth Core (CodeVertex) URLs — Phase 2A.
 * Gated by VITE_AUTH_CORE_ENABLED; local Supabase auth remains when disabled.
 */

import { APP_CODE, AUTH_BASE_URL } from './codevertexConfig';
import { storeSsoReturnTo } from './ssoReturnTo';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function readEnvFlag(key: string): boolean {
  const raw = import.meta.env[key] as string | undefined;
  return raw?.trim().toLowerCase() === 'true';
}

/** `true` only when `VITE_AUTH_CORE_ENABLED=true`. */
export function isAuthCoreEnabled(): boolean {
  return readEnvFlag('VITE_AUTH_CORE_ENABLED');
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

/**
 * Auth Core login. `returnTo` is stored locally for post-callback navigation (not sent as `return_url`).
 */
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

/**
 * Auth Core logout. `returnTo` is the Splitly origin (or path) after central logout.
 */
export function getAuthLogoutUrl(returnTo?: string): string {
  const target =
    returnTo ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  return buildAuthCoreUrl('/logout', {
    return_to: target,
  });
}
