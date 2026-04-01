import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Profile } from '../types';
import type { SupportedLocale } from '../i18n';
import { isSupportedLocale, setAppLanguage } from '../i18n';

export const PROFILE_UPDATED_EVENT = 'splitly-profile-updated';

function notifyProfileUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsernameInput(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return s;
}

export function validateUsernameOrEmpty(username: string | null): true | 'USERNAME_INVALID' {
  if (username === null) return true;
  return USERNAME_RE.test(username) ? true : 'USERNAME_INVALID';
}

async function uploadAvatarFile(
  userId: string,
  file: File
): Promise<{ url: string } | { error: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: 'NOT_CONFIGURED' };

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return { error: 'INVALID_TYPE' };
  if (file.size > 2 * 1024 * 1024) return { error: 'TOO_LARGE' };

  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/gif'
          ? 'gif'
          : 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upError } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });

  if (upError) return { error: upError.message };

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: data.publicUrl };
}

export type ProfileSaveFields = {
  username: string;
  full_name: string;
  default_currency: string;
  timezone: string;
  avatar_url: string | null;
  avatarFile?: File | null;
};

export type ProfileSaveResult =
  | { success: true }
  | { success: false; error: string; code?: string };

export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { data, error: qError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (qError) throw qError;
      setProfile(data as Profile | null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load profile';
      console.error('useUserProfile:', msg);
      setError(msg);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    const handler = () => void fetchProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
  }, [fetchProfile]);

  const saveProfileFields = useCallback(
    async (fields: ProfileSaveFields): Promise<ProfileSaveResult> => {
      if (!userId) return { success: false, error: 'NO_USER' };
      if (!isSupabaseConfigured || !supabase) return { success: false, error: 'NOT_CONFIGURED' };

      const normalizedUser = normalizeUsernameInput(fields.username);
      const v = validateUsernameOrEmpty(normalizedUser);
      if (v !== true) return { success: false, error: v, code: 'USERNAME_INVALID' };

      setSaving(true);
      setError(null);
      try {
        let finalAvatarUrl = fields.avatar_url;

        if (fields.avatarFile) {
          const up = await uploadAvatarFile(userId, fields.avatarFile);
          if ('error' in up) {
            return { success: false, error: up.error, code: 'AVATAR_UPLOAD_FAILED' };
          }
          finalAvatarUrl = up.url;
        }

        const { error: uError } = await supabase
          .from('profiles')
          .update({
            username: normalizedUser,
            full_name: fields.full_name.trim() || null,
            default_currency: fields.default_currency.trim() || 'EUR',
            timezone: fields.timezone.trim() || 'UTC',
            avatar_url: finalAvatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (uError) {
          const code = (uError as { code?: string }).code;
          const msg = uError.message || 'Save failed';
          if (code === '23505' || msg.toLowerCase().includes('unique')) {
            return { success: false, error: msg, code: 'USERNAME_TAKEN' };
          }
          throw uError;
        }

        await fetchProfile();
        notifyProfileUpdated();
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Save failed';
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setSaving(false);
      }
    },
    [userId, fetchProfile]
  );

  const updatePreferredLanguageInDatabase = useCallback(
    async (lng: SupportedLocale) => {
      if (!userId) return { success: false as const, error: 'NO_USER' };
      if (!isSupabaseConfigured || !supabase) return { success: false as const, error: 'NOT_CONFIGURED' };

      try {
        const { error: uError } = await supabase
          .from('profiles')
          .update({
            preferred_language: lng,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (uError) throw uError;
        await fetchProfile();
        notifyProfileUpdated();
        return { success: true as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Language save failed';
        console.error('updatePreferredLanguageInDatabase:', msg);
        return { success: false as const, error: msg };
      }
    },
    [userId, fetchProfile]
  );

  return {
    profile,
    loading,
    error,
    saving,
    refetch: fetchProfile,
    saveProfileFields,
    updatePreferredLanguageInDatabase,
  };
}

/** Ao iniciar sessão: se o perfil tiver idioma guardado, aplica-o e sincroniza storage. */
export async function applyPreferredLanguageFromProfile(
  preferred: string | null | undefined
): Promise<void> {
  if (!preferred || !isSupportedLocale(preferred)) return;
  await setAppLanguage(preferred);
}
