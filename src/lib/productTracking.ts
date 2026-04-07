import { supabase } from './supabase';

const PRODUCT_TRACKING_SESSION_KEY = 'splitly_product_tracking_session_id';
const PRODUCT_TRACKING_ONCE_PREFIX = 'splitly_product_tracking_once';
const PRODUCT_TRACKING_LAST_EVENT_KEY = 'splitly_product_tracking_last_event';
const pendingOnceKeys = new Set<string>();

type TrackProductEventOptions = {
  page?: string;
  entity_type?: string;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  user_id?: string | null;
  /** Optional key to ensure this event is tracked only once per user/device. */
  once_key?: string;
};

type ProductEventRow = {
  user_id: string;
  session_id: string;
  event_name: string;
  page: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
};

function getOrCreateTrackingSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const existing = localStorage.getItem(PRODUCT_TRACKING_SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(PRODUCT_TRACKING_SESSION_KEY, created);
  return created;
}

function wasTrackedOnce(userId: string, onceKey: string): boolean {
  if (typeof window === 'undefined') return false;
  const k = `${PRODUCT_TRACKING_ONCE_PREFIX}:${userId}:${onceKey}`;
  return localStorage.getItem(k) === '1';
}

function markTrackedOnce(userId: string, onceKey: string): void {
  if (typeof window === 'undefined') return;
  const k = `${PRODUCT_TRACKING_ONCE_PREFIX}:${userId}:${onceKey}`;
  localStorage.setItem(k, '1');
}

function setLastTrackedDebugEvent(row: ProductEventRow): void {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return;
  try {
    localStorage.setItem(PRODUCT_TRACKING_LAST_EVENT_KEY, JSON.stringify({ ...row, at: new Date().toISOString() }));
  } catch {
    // ignore debug storage failures
  }
}

async function insertProductEvent(row: ProductEventRow): Promise<{ error: unknown | null }> {
  // Keep this untyped so tracking remains resilient even if generated DB types lag behind.
  const client = supabase as unknown as {
    from: (table: string) => { insert: (values: unknown) => Promise<{ error: unknown | null }> };
  };
  return client.from('product_events').insert(row);
}

/**
 * Lightweight internal analytics using Supabase (product_events).
 * Fail-silent by design so user flows are never blocked.
 */
export async function trackProductEvent(
  eventName: string,
  options?: TrackProductEventOptions,
): Promise<void> {
  let resolvedUserId: string | null = null;
  let resolvedOnceKey: string | null = null;
  try {
    const sessionId = getOrCreateTrackingSessionId();
    const page = options?.page ?? (typeof window !== 'undefined' ? window.location.pathname : null);
    let userId = options?.user_id ?? null;

    if (!userId) {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    }
    if (!userId) return;

    const onceKey = options?.once_key;
    resolvedUserId = userId;
    resolvedOnceKey = onceKey ?? null;
    const onceStorageKey = onceKey ? `${userId}:${onceKey}` : null;
    if (onceKey && wasTrackedOnce(userId, onceKey)) return;
    if (onceStorageKey && pendingOnceKeys.has(onceStorageKey)) return;
    if (onceStorageKey) pendingOnceKeys.add(onceStorageKey);

    const row: ProductEventRow = {
      user_id: userId,
      session_id: sessionId,
      event_name: eventName,
      page,
      entity_type: options?.entity_type ?? null,
      entity_id: options?.entity_id ?? null,
      metadata: options?.metadata ?? {},
    };

    const { error } = await insertProductEvent(row);
    if (!error) {
      if (onceKey) markTrackedOnce(userId, onceKey);
      setLastTrackedDebugEvent(row);
      if (import.meta.env.DEV) {
        console.info(`[tracking] ${eventName}`);
      }
    } else if (import.meta.env.DEV) {
      console.warn('[tracking] failed to insert product event');
    }
  } catch {
    if (import.meta.env.DEV) {
      console.warn('[tracking] failed to insert product event');
    }
  } finally {
    if (resolvedUserId && resolvedOnceKey) {
      pendingOnceKeys.delete(`${resolvedUserId}:${resolvedOnceKey}`);
    } else if (resolvedOnceKey) {
      // Unknown user id branch: clear any matching pending key suffix to avoid sticky locks.
      for (const key of pendingOnceKeys) {
        if (key.endsWith(`:${resolvedOnceKey}`)) pendingOnceKeys.delete(key);
      }
    }
  }
}

export function getTrackingDebugState(userId?: string): { lastEvent: string | null; onceFlags: string[] } {
  if (typeof window === 'undefined' || !import.meta.env.DEV) {
    return { lastEvent: null, onceFlags: [] };
  }
  let lastEvent: string | null = null;
  try {
    lastEvent = localStorage.getItem(PRODUCT_TRACKING_LAST_EVENT_KEY);
  } catch {
    lastEvent = null;
  }
  const onceFlags: string[] = [];
  if (!userId) return { lastEvent, onceFlags };
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const prefix = `${PRODUCT_TRACKING_ONCE_PREFIX}:${userId}:`;
      if (key.startsWith(prefix) && localStorage.getItem(key) === '1') {
        onceFlags.push(key.slice(prefix.length));
      }
    }
  } catch {
    // noop for debug path
  }
  return { lastEvent, onceFlags };
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { __splitlyTrackingDebug?: { getTrackingDebugState: typeof getTrackingDebugState } }).__splitlyTrackingDebug = {
    getTrackingDebugState,
  };
}

