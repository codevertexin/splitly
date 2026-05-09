import type { FeatureInterestPayload, FeatureInterestResult } from '../types/billing.types';
import { isSupabaseConfigured, supabase } from '../../../lib/supabase';

const INTEREST_LOG_KEY = 'splitly_feature_interest_log';
/** Idempotent index: one entry per user + feature (device cache; server is source of truth when configured). */
const INTEREST_DEDUPE_KEY = 'splitly_feature_interest_seen_v1';

/** Same-tab refresh when interest is recorded (e.g. hide promo cards without reload). */
export const FEATURE_INTEREST_CHANGED_EVENT = 'splitly:feature-interest-changed';

function compositeKey(userId: string, featureKey: string): string {
  return `${userId}::${featureKey}`;
}

function dispatchFeatureInterestChanged(userId: string, featureKey: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FEATURE_INTEREST_CHANGED_EVENT, {
      detail: { userId: userId.trim(), featureKey: featureKey.trim() },
    }),
  );
}

function markLocalInterestSeen(userId: string, featureKey: string): void {
  const uid = userId?.trim();
  const fk = featureKey?.trim();
  if (!uid || !fk) return;
  const key = compositeKey(uid, fk);
  if (typeof window === 'undefined') return;
  try {
    const rawSeen = window.localStorage.getItem(INTEREST_DEDUPE_KEY);
    const seen = rawSeen ? (JSON.parse(rawSeen) as Record<string, boolean>) : {};
    seen[key] = true;
    window.localStorage.setItem(INTEREST_DEDUPE_KEY, JSON.stringify(seen));
    dispatchFeatureInterestChanged(uid, fk);
  } catch {
    // ignore
  }
}

function appendLocalInterestLog(payload: FeatureInterestPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = window.localStorage.getItem(INTEREST_LOG_KEY);
    const list = prev ? (JSON.parse(prev) as unknown[]) : [];
    list.push({ ...payload, at: new Date().toISOString() });
    window.localStorage.setItem(INTEREST_LOG_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // ignore
  }
}

/**
 * Whether the current device already recorded interest for this user+feature (local cache only).
 * Prefer `fetchFeatureInterestRegistered` when online for cross-device accuracy.
 */
export function hasRegisteredFeatureInterest(userId: string, featureKey: string): boolean {
  const uid = userId?.trim();
  const fk = featureKey?.trim();
  if (!uid || !fk) return false;
  try {
    if (typeof window === 'undefined') return false;
    const rawSeen = window.localStorage.getItem(INTEREST_DEDUPE_KEY);
    const seen = rawSeen ? (JSON.parse(rawSeen) as Record<string, boolean>) : {};
    return !!seen[compositeKey(uid, fk)];
  } catch {
    return false;
  }
}

/** Server-side: whether this user already has a row for the feature. */
export async function fetchFeatureInterestRegistered(userId: string, featureKey: string): Promise<boolean> {
  const uid = userId?.trim();
  const fk = featureKey?.trim();
  if (!uid || !fk || !isSupabaseConfigured || !supabase) return false;

  const { data, error } = await supabase
    .from('feature_interest')
    .select('id')
    .eq('user_id', uid)
    .eq('feature_key', fk)
    .maybeSingle();

  if (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[featureInterest] fetch registered', error.message);
    }
    return false;
  }
  return !!data;
}

async function submitFeatureInterestLocalOnly(
  payload: FeatureInterestPayload,
  userId: string,
  featureKey: string,
): Promise<FeatureInterestResult> {
  const key = compositeKey(userId, featureKey);
  try {
    if (typeof window !== 'undefined') {
      const rawSeen = window.localStorage.getItem(INTEREST_DEDUPE_KEY);
      const seen = rawSeen ? (JSON.parse(rawSeen) as Record<string, boolean>) : {};
      if (seen[key]) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.info('[featureInterest] deduped skip (local)', key);
        }
        return { ok: true, deduped: true };
      }
    }

    markLocalInterestSeen(userId, featureKey);

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info('[featureInterest] local-only', payload);
    }

    appendLocalInterestLog(payload);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to submit';
    return { ok: false, error: msg };
  }
}

/**
 * Registers interest for an unreleased feature. Persists to `feature_interest` when Supabase is configured.
 */
export async function submitFeatureInterest(
  payload: FeatureInterestPayload,
): Promise<FeatureInterestResult> {
  if (!payload.featureKey?.trim()) {
    return { ok: false, error: 'Missing feature key' };
  }

  const userId = payload.userId?.trim();
  if (!userId) {
    return { ok: false, error: 'Missing user id' };
  }

  const featureKey = payload.featureKey.trim();
  const key = compositeKey(userId, featureKey);
  const emailNorm = payload.email?.trim() ? payload.email.trim() : null;
  const messageNorm = payload.message?.trim() ? payload.message.trim() : null;

  if (!isSupabaseConfigured || !supabase) {
    return submitFeatureInterestLocalOnly(payload, userId, featureKey);
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user || authData.user.id !== userId) {
    return { ok: false, error: 'AUTH_SESSION' };
  }

  const { data: existing, error: selErr } = await supabase
    .from('feature_interest')
    .select('email, message')
    .eq('user_id', authData.user.id)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (selErr) {
    return { ok: false, error: selErr.message };
  }

  const sameContent =
    !!existing &&
    (existing.email ?? null) === emailNorm &&
    (existing.message ?? null) === messageNorm;

  if (sameContent) {
    markLocalInterestSeen(userId, featureKey);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info('[featureInterest] deduped (server)', key);
    }
    return { ok: true, deduped: true };
  }

  const { error: upErr } = await supabase.from('feature_interest').upsert(
    {
      user_id: authData.user.id,
      feature_key: featureKey,
      email: emailNorm,
      message: messageNorm,
    },
    { onConflict: 'user_id,feature_key' },
  );

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  markLocalInterestSeen(authData.user.id, featureKey);
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[featureInterest] saved', { featureKey, userId: authData.user.id });
  }
  appendLocalInterestLog(payload);
  return { ok: true };
}
