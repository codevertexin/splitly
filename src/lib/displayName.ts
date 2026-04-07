import type { Profile } from '../types';

export type SocialNameParts = {
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/**
 * Nome legível para UI social: nome completo, @username, parte local do email, ou etiqueta anónima (nunca UUID completo).
 */
export function socialDisplayName(parts: SocialNameParts, userId: string): string {
  const fn = parts.full_name?.trim();
  if (fn && fn.length >= 2) return fn;
  const un = parts.username?.trim();
  if (un && un.length >= 1) return `@${un}`;
  const em = parts.email?.trim();
  if (em?.includes('@')) {
    const local = em.split('@')[0]?.trim();
    if (local && local.length > 0) return local;
  }
  const suffix = userId.length >= 4 ? userId.slice(-4) : userId;
  if (isUuidLike(userId)) {
    return `·${suffix}`;
  }
  return userId;
}

/** Perfil válido para interação social: nome com 2+ caracteres ou username definido. */
export function hasValidSocialDisplayName(profile: Pick<Profile, 'full_name' | 'username'> | null): boolean {
  if (!profile) return false;
  const fn = profile.full_name?.trim();
  if (fn && fn.length >= 2) return true;
  const un = profile.username?.trim();
  return Boolean(un && un.length >= 3);
}
