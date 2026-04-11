import type { FeatureInterestPayload, FeatureInterestResult } from '../types/billing.types';

const INTEREST_LOG_KEY = 'splitly_feature_interest_log';
/** Idempotent index: one entry per user + feature (persists across sessions). */
const INTEREST_DEDUPE_KEY = 'splitly_feature_interest_seen_v1';

function compositeKey(userId: string, featureKey: string): string {
  return `${userId}::${featureKey}`;
}

/**
 * Whether the current device already recorded interest for this user+feature (same index as submit dedupe).
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

/**
 * Registers interest for an unreleased feature. Idempotent per `userId` + `featureKey` (localStorage index).
 * Replace with Supabase upsert on `feature_interest (user_id, feature_key)` when the table exists.
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

  try {
    if (typeof window !== 'undefined') {
      const rawSeen = window.localStorage.getItem(INTEREST_DEDUPE_KEY);
      const seen = rawSeen ? (JSON.parse(rawSeen) as Record<string, boolean>) : {};
      if (seen[key]) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.info('[featureInterest] deduped skip', key);
        }
        return { ok: true, deduped: true };
      }
      seen[key] = true;
      window.localStorage.setItem(INTEREST_DEDUPE_KEY, JSON.stringify(seen));
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info('[featureInterest]', payload);
    }

    if (typeof window !== 'undefined') {
      const prev = window.localStorage.getItem(INTEREST_LOG_KEY);
      const list = prev ? (JSON.parse(prev) as unknown[]) : [];
      list.push({ ...payload, at: new Date().toISOString() });
      window.localStorage.setItem(INTEREST_LOG_KEY, JSON.stringify(list.slice(-50)));
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to submit';
    return { ok: false, error: msg };
  }
}
