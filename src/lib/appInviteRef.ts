/** Query param ?ref=<user id> on app URL — stored until new user links with inviter via accept-app-invite. */
export const APP_INVITE_REF_STORAGE_KEY = 'splitly_app_invite_ref';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

export function getStoredAppInviteRef(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(APP_INVITE_REF_STORAGE_KEY);
  return raw && isUuid(raw) ? raw : null;
}

export function clearStoredAppInviteRef() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(APP_INVITE_REF_STORAGE_KEY);
}
