import type { Profile } from '../dbAliases';

export type SocialNameParts = {
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/**
 * Nome legível para UI social.
 *
 * Regra atual:
 * 1. full_name
 * 2. username
 * 3. local-part do email
 * 4. fallback técnico curto (nunca UUID completo)
 *
 * A UI deve preferir sempre full_name.
 */
export function socialDisplayName(parts: SocialNameParts, userId: string): string {
  const fn = parts.full_name?.trim();
  if (fn && fn.length >= 2) return fn;

  const un = parts.username?.trim();
  if (un && un.length >= 3) return un;

  const em = parts.email?.trim();
  if (em?.includes('@')) {
    const local = em.split('@')[0]?.trim();
    if (local && local.length > 0) return local;
  }

  const suffix = userId.length >= 4 ? userId.slice(-4) : userId;
  if (isUuidLike(userId)) {
    return `user-${suffix}`;
  }

  return userId;
}

/**
 * Nome visível suficiente para UI.
 * Útil em renderização/fallback.
 */
export function hasUsableDisplayName(
  profile: Pick<Profile, 'full_name' | 'username'> | null
): boolean {
  if (!profile) return false;

  const fn = profile.full_name?.trim();
  if (fn && fn.length >= 2) return true;

  const un = profile.username?.trim();
  return Boolean(un && un.length >= 3);
}

/**
 * Perfil completo segundo a regra atual do produto:
 * - full_name obrigatório
 * - username obrigatório
 */
export function hasCompleteSocialIdentity(
  profile: Pick<Profile, 'full_name' | 'username'> | null
): boolean {
  if (!profile) return false;

  const fn = profile.full_name?.trim();
  const un = profile.username?.trim();

  return Boolean(fn && fn.length >= 2 && un && un.length >= 3);
}