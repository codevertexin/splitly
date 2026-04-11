import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../../components/ui/Button';
import { trackProductEvent } from '../../lib/productTracking';
import {
  storePendingGroupInviteToken,
  clearPendingGroupInviteToken,
} from '../../lib/groupInviteToken';

type AcceptInviteResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  group_id?: string;
  status?: string;
};

/**
 * `functions.invoke` sets `data` to null on non-2xx; the JSON body is still available
 * on `FunctionsHttpError.context` (Response), unread.
 */
async function resolveAcceptInvitePayload(
  data: unknown,
  fnError: unknown,
): Promise<AcceptInviteResponse | null> {
  if (data && typeof data === 'object') {
    return data as AcceptInviteResponse;
  }
  if (fnError && typeof fnError === 'object' && 'context' in fnError) {
    const res = (fnError as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      try {
        return (await res.json()) as AcceptInviteResponse;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function mapInviteError(
  t: (k: string, o?: Record<string, string>) => string,
  code: string | undefined,
  fallback: string,
): string {
  switch (code) {
    case 'invite_expired':
      return t('invite.errorExpired');
    case 'invite_used':
      return t('invite.errorUsed');
    case 'invalid_invite':
      return t('invite.errorInvalid');
    case 'missing_token':
      return t('invite.missingToken');
    case 'invalid_body':
      return t('invite.joinFailed');
    case 'unauthorized':
    case 'missing_auth':
      return t('invite.errorAuth');
    case 'lookup_failed':
    case 'join_failed':
    case 'server_error':
      return t('invite.errorServer');
    default:
      return fallback || t('invite.joinFailed');
  }
}

export function InvitePage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    const acceptInvite = async () => {
      if (!token) {
        setError(t('invite.missingToken'));
        setLoading(false);
        return;
      }
  
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
  
      if (!user) {
        storePendingGroupInviteToken(token);
        navigate('/auth');
        return;
      }
  
      try {
        const { data, error: fnError } = await supabase.functions.invoke('accept-invite', {
          body: { token },
        });
  
        const payload = await resolveAcceptInvitePayload(data, fnError);
  
        if (fnError) {
          const msg =
            payload?.error ||
            (fnError instanceof Error ? fnError.message : String(fnError));
          setError(mapInviteError(t, payload?.code, msg));
          setLoading(false);
          return;
        }
  
        if (payload?.error && !payload.success) {
          setError(mapInviteError(t, payload.code, payload.error));
          setLoading(false);
          return;
        }
  
        if (!payload?.success || !payload.group_id) {
          setError(t('invite.groupIdMissing'));
          setLoading(false);
          return;
        }
  
        clearPendingGroupInviteToken();
  
        setJoinedGroupId(payload.group_id);
        setAlreadyMember(payload.status === 'already_member');
  
        void trackProductEvent('invite_accepted', {
          entity_type: 'group',
          entity_id: payload.group_id,
          metadata: { status: payload.status ?? 'joined' },
        });
  
        setTimeout(() => {
          navigate(`/groups/${payload.group_id}`);
        }, 2000);
      } catch (err: unknown) {
        console.error('Error accepting invite:', err);
        setError(err instanceof Error ? err.message : t('invite.joinFailed'));
      } finally {
        setLoading(false);
      }
    };
  
    void acceptInvite();
  }, [token, navigate, t]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
        <h2 className="text-xl font-bold text-slate-900">{t('invite.joiningTitle')}</h2>
        <p className="text-slate-500">{t('invite.joiningBody')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto p-8 bg-white rounded-3xl shadow-sm border border-slate-100 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('invite.errorTitle')}</h2>
        <p className="text-slate-500 mb-8">{error}</p>
        <Button onClick={() => navigate('/dashboard')} className="w-full">
          {t('invite.goToDashboard')}
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-md mx-auto p-8 bg-white rounded-3xl shadow-sm border border-slate-100 text-center"
    >
      <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <CheckCircle2 className="w-8 h-8 text-green-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">
        {alreadyMember ? t('invite.successAlreadyMemberTitle') : t('invite.successTitle')}
      </h2>
      <p className="text-slate-500 mb-8">
        {alreadyMember ? t('invite.successAlreadyMemberBody') : t('invite.successBody')}
      </p>

      <div className="space-y-3">
        <Button
          onClick={() => joinedGroupId && navigate(`/groups/${joinedGroupId}`)}
          className="w-full"
        >
          {t('invite.viewGroup')} <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        <Button variant="outline" onClick={() => navigate('/dashboard')} className="w-full">
          {t('invite.goToDashboard')}
        </Button>
      </div>
    </motion.div>
  );
}
