/**
 * Full logout: Supabase session (all tabs) + client storage + Auth Core redirect.
 * Use this instead of ad-hoc `signOut()` so the user never lands on the dashboard with a stale session.
 */

import { supabase } from './supabase';
import { getAuthLogoutUrl } from './codevertexAuth';
import { clearSsoFlowSessionMarkers } from './ssoReturnTo';
import { clearPendingGroupInviteToken } from './groupInviteToken';
import { clearStoredAppInviteRef } from './appInviteRef';

/**
 * Removes Supabase persisted session keys (`sb-<ref>-auth-token`) from both storages.
 * `signOut` usually clears these; this is a safety net if the client left orphans.
 */
function removeSupabaseAuthTokenKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const store of [localStorage, sessionStorage]) {
      const toRemove: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && /^sb-.*-auth-token$/i.test(k)) toRemove.push(k);
      }
      toRemove.forEach((k) => store.removeItem(k));
    }
  } catch {
    /* ignore */
  }
}

/** Keys starting with `splitly_` or `splitly:` in localStorage / sessionStorage. */
function removeSplitlyPrefixedKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const store of [localStorage, sessionStorage]) {
      const toRemove: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k) continue;
        if (k.startsWith('splitly_') || k.startsWith('splitly:')) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => store.removeItem(k));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Clears SSO markers, invite refs, last group id, Splitly-prefixed keys, then Supabase auth token keys.
 * Idempotent; safe to call after `signOut`.
 */
export function clearSplitlyClientStorageForLogout(): void {
  clearSsoFlowSessionMarkers();
  clearPendingGroupInviteToken();
  clearStoredAppInviteRef();
  try {
    localStorage.removeItem('splitly_last_group_id');
  } catch {
    /* ignore */
  }
  removeSplitlyPrefixedKeys();
  removeSupabaseAuthTokenKeys();
}

/**
 * 1) Sign out Supabase everywhere (`scope: 'global'`).
 * 2) Wipe client storage used by SSO / invites / persisted session.
 * 3) Redirect to Auth Core logout → user ends on real login without auto-dashboard.
 */
export async function logoutFromSplitlyAndCore(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    /* still scrub storage and leave the app */
  }

  clearSplitlyClientStorageForLogout();

  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await supabase.auth.signOut({ scope: 'global' });
      clearSplitlyClientStorageForLogout();
    }
  } catch {
    /* ignore */
  }

  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  window.location.replace(getAuthLogoutUrl(origin));
}
