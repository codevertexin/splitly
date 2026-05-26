import { getPendingGroupInviteToken } from './groupInviteToken';

const STORAGE_KEY = 'splitly_sso_return_to';
export const DEFAULT_SSO_RETURN = '/dashboard';

/** sessionStorage keys marking a ticket as already consumed (avoid double SSO). */
export const SSO_TICKET_DONE_PREFIX = 'splitly_sso_ticket_done:';

export function ssoTicketDoneKey(ticket: string): string {
  return `${SSO_TICKET_DONE_PREFIX}${ticket}`;
}

/** Remove all SSO ticket consumption markers (sessionStorage). */
export function clearSsoTicketConsumptionMarkers(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(SSO_TICKET_DONE_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Return_to + ticket markers used by the SSO callback flow. */
export function clearSsoFlowSessionMarkers(): void {
  clearStoredSsoReturnTo();
  clearSsoTicketConsumptionMarkers();
}

/** Canonical SSO callback pathname (never use as post-login destination). */
export const SSO_CALLBACK_PATH = '/sso/callback';

/**
 * Paths that must not be used after SSO (would loop, 404, or re-hit ticket).
 */
export function isForbiddenSsoReturnPath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;

  const value = raw.trim();
  if (/[?&](ticket|app)=/i.test(value)) return true;

  const pathOnly = value.split('?')[0]?.split('#')[0]?.toLowerCase().replace(/\/+$/, '') || '/';

  if (pathOnly === '/callback' || pathOnly === '/sso/callback') return true;
  if (pathOnly === 'callback' || pathOnly === 'sso/callback') return true;
  if (pathOnly.endsWith('/callback') && !pathOnly.includes('/sso/')) return true;

  return false;
}

function normalizeInternalPath(raw: string): string | null {
  try {
    const url = new URL(raw, 'https://splitly.internal');
    if (url.origin !== 'https://splitly.internal') return null;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const search = url.search;
    const hash = url.hash;
    return `${path}${search}${hash}`;
  } catch {
    return null;
  }
}

/**
 * Allow only same-origin relative paths. Reject callback routes and SSO query params.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_SSO_RETURN;

  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return DEFAULT_SSO_RETURN;
  if (trimmed.startsWith('//')) return DEFAULT_SSO_RETURN;
  if (/^https?:\/\//i.test(trimmed)) return DEFAULT_SSO_RETURN;
  if (trimmed.includes('\\')) return DEFAULT_SSO_RETURN;
  if (isForbiddenSsoReturnPath(trimmed)) return DEFAULT_SSO_RETURN;

  const normalized = normalizeInternalPath(trimmed);
  if (!normalized || isForbiddenSsoReturnPath(normalized)) return DEFAULT_SSO_RETURN;

  return normalized;
}

/** Post-SSO destination when no explicit return_to was stored. */
export function resolveSsoReturnPath(): string {
  const pendingInvite = getPendingGroupInviteToken();
  if (pendingInvite) {
    const invitePath = `/invite/${pendingInvite}`;
    return sanitizeReturnTo(invitePath);
  }
  return DEFAULT_SSO_RETURN;
}

export function storeSsoReturnTo(path: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, sanitizeReturnTo(path));
  } catch {
    /* private mode / quota */
  }
}

export function getStoredSsoReturnTo(): string {
  try {
    return sanitizeReturnTo(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SSO_RETURN;
  }
}

export function clearStoredSsoReturnTo(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Safe in-app destination after SSO callback (never `/callback` or `/sso/callback`). */
export function resolveSafePostSsoDestination(): string {
  const pendingInvite = getPendingGroupInviteToken();
  if (pendingInvite) {
    return sanitizeReturnTo(`/invite/${encodeURIComponent(pendingInvite)}`);
  }
  return getStoredSsoReturnTo();
}
