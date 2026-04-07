import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { InvitePage } from './InvitePage';
import { storePendingGroupInviteToken } from '../../lib/groupInviteToken';

interface InviteEntryPageProps {
  session: Session | null;
}

/**
 * Deep-link gate:
 * - unauthenticated: persist token and redirect to login
 * - authenticated: continue to InvitePage (which accepts invite and handles statuses)
 */
export function InviteEntryPage({ session }: InviteEntryPageProps) {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (session || !token) return;
    storePendingGroupInviteToken(token);
  }, [session, token]);

  if (!session) return <Navigate to="/" replace />;
  return (
    <div className="p-8">
      <InvitePage />
    </div>
  );
}

