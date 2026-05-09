import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../../lib/supabase';
import {
  FEATURE_INTEREST_CHANGED_EVENT,
  fetchFeatureInterestRegistered,
  hasRegisteredFeatureInterest,
} from '../services/featureInterest.service';

/**
 * True when the user has a `feature_interest` row (or local cache) for `featureKey`.
 */
export function useFeatureInterestRegistered(
  userId: string | null | undefined,
  featureKey: string,
): boolean {
  const uid = userId?.trim() ?? '';
  const fk = featureKey?.trim() ?? '';

  const [registered, setRegistered] = useState(() => {
    if (!uid || !fk) return false;
    return hasRegisteredFeatureInterest(uid, fk);
  });

  useEffect(() => {
    if (!uid || !fk) {
      setRegistered(false);
      return;
    }

    const local = hasRegisteredFeatureInterest(uid, fk);
    if (local) {
      setRegistered(true);
      return;
    }

    setRegistered(false);

    if (!isSupabaseConfigured) {
      return;
    }

    let cancelled = false;
    void fetchFeatureInterestRegistered(uid, fk).then((server) => {
      if (!cancelled) setRegistered(server);
    });

    return () => {
      cancelled = true;
    };
  }, [uid, fk]);

  useEffect(() => {
    if (!uid || !fk) return;

    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ userId?: string; featureKey?: string }>;
      const d = e.detail;
      if (d?.userId === uid && d?.featureKey === fk) {
        setRegistered(true);
      }
    };

    window.addEventListener(FEATURE_INTEREST_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FEATURE_INTEREST_CHANGED_EVENT, handler);
  }, [uid, fk]);

  return registered;
}
