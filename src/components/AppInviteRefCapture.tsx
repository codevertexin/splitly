import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_INVITE_REF_STORAGE_KEY, isUuid } from '../lib/appInviteRef';

/**
 * Persists ?ref=<inviter user id> for later linking in user_contacts (app_share).
 * Removes the param from the URL for a cleaner address bar.
 */
export function AppInviteRefCapture() {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get('ref');
    if (!ref || !isUuid(ref)) return;

    localStorage.setItem(APP_INVITE_REF_STORAGE_KEY, ref);
    params.delete('ref');
    const nextSearch = params.toString();
    const next = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`;
    window.history.replaceState(null, '', next);
  }, [location]);

  return null;
}
