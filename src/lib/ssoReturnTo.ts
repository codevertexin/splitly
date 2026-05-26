const STORAGE_KEY = 'splitly_sso_return_to';
const DEFAULT_RETURN = '/dashboard';

/**
 * Allow only same-origin relative paths. Reject protocol-relative, absolute URLs, and backslashes.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_RETURN;

  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return DEFAULT_RETURN;
  if (trimmed.startsWith('//')) return DEFAULT_RETURN;
  if (/^https?:\/\//i.test(trimmed)) return DEFAULT_RETURN;
  if (trimmed.includes('\\')) return DEFAULT_RETURN;

  return trimmed;
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
    return DEFAULT_RETURN;
  }
}

export function clearStoredSsoReturnTo(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
