const GROUP_INVITE_TOKEN_KEY = 'splitly_pending_group_invite_token';

export function storePendingGroupInviteToken(token: string): void {
  if (typeof window === 'undefined') return;
  const normalized = token.trim();
  if (!normalized) return;
  localStorage.setItem(GROUP_INVITE_TOKEN_KEY, normalized);
}

export function getPendingGroupInviteToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(GROUP_INVITE_TOKEN_KEY);
  const normalized = raw?.trim() || '';
  return normalized || null;
}

export function clearPendingGroupInviteToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(GROUP_INVITE_TOKEN_KEY);
}

