import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../../components/ui/Button';

export function InvitePage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);

  useEffect(() => {
    const acceptInvite = async () => {
      if (!token) {
        setError(t('invite.missingToken'));
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('accept-invite', {
          body: { token },
        });

        if (error) throw error;
        if (!data?.group_id) throw new Error(t('invite.groupIdMissing'));

        setJoinedGroupId(data.group_id);

        setTimeout(() => {
          navigate(`/groups/${data.group_id}`);
        }, 2000);
      } catch (err: any) {
        console.error('Error accepting invite:', err);
        setError(err.message || t('invite.joinFailed'));
      } finally {
        setLoading(false);
      }
    };

    acceptInvite();
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
      <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('invite.successTitle')}</h2>
      <p className="text-slate-500 mb-8">{t('invite.successBody')}</p>

      <div className="space-y-3">
        <Button
          onClick={() => joinedGroupId && navigate(`/groups/${joinedGroupId}`)}
          className="w-full"
        >
          {t('invite.viewGroup')} <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/dashboard')}
          className="w-full"
        >
          {t('invite.goToDashboard')}
        </Button>
      </div>
    </motion.div>
  );
}