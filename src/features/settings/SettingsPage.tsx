import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useUserProfile } from '../../hooks/useUserProfile';
import { getAuthProfileManageUrl } from '../../lib/codevertexAuth';

const CURRENCIES: { code: string; label: string }[] = [
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
  { code: 'NOK', label: 'NOK — Norwegian Krone' },
  { code: 'DKK', label: 'DKK — Danish Krone' },
  { code: 'PLN', label: 'PLN — Polish Złoty' },
  { code: 'MXN', label: 'MXN — Mexican Peso' },
];

interface SettingsPageProps {
  session: Session;
}

export function SettingsPage({ session }: SettingsPageProps) {
  const { t } = useTranslation();
  const userId = session.user.id;
  const { profile, loading, error, saving, saveProfileFields } = useUserProfile(userId);

  const [currency, setCurrency] = useState('EUR');
  const [saveMessage, setSaveMessage] = useState<'ok' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recentActivityDays, setRecentActivityDays] = useState<'7' | '30' | '90'>('7');

  useEffect(() => {
    if (!profile) return;
    setCurrency(profile.default_currency?.trim() || 'EUR');
  }, [profile]);

  useEffect(() => {
    const raw = localStorage.getItem('splitly_recent_activity_days');
    if (raw === '7' || raw === '30' || raw === '90') {
      setRecentActivityDays(raw);
    }
  }, []);

  const handleManageProfile = () => {
    window.location.assign(getAuthProfileManageUrl('/settings'));
  };

  const handleSave = async () => {
    setSaveMessage(null);
    setSaveError(null);

    localStorage.setItem('splitly_recent_activity_days', recentActivityDays);

    if (!profile) return;

    const result = await saveProfileFields({
      username: profile.username ?? '',
      full_name: profile.full_name ?? '',
      default_currency: currency,
      timezone: profile.timezone?.trim() || 'UTC',
      avatar_url: profile.avatar_url ?? null,
    });

    if (result.success) {
      setSaveMessage('ok');
    } else {
      setSaveError('error' in result ? result.error : t('settings.saveError'));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-stretch max-w-lg mx-auto py-8 md:py-12 space-y-8"
    >
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-4">
          <SettingsIcon className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">{t('settings.title')}</h3>
        <p className="text-slate-500 text-sm">{t('settings.subtitle')}</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-8">
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          {t('settings.loadingProfile')}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-800">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          <Card className="p-6 space-y-5">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {t('settings.profileSection')}
            </h4>

            <div className="space-y-3 text-center sm:text-left">
              <h5 className="text-base font-semibold text-slate-900">
                {t('settings.codevertexProfileTitle')}
              </h5>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t('settings.codevertexProfileDescription')}
              </p>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={handleManageProfile}
            >
              {t('settings.manageProfile')}
              <ExternalLink className="ml-2 h-4 w-4 shrink-0" aria-hidden />
            </Button>
          </Card>

          <Card className="p-6 space-y-6">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {t('settings.appSection')}
            </h4>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t('settings.currency')}</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
                {currency && !CURRENCIES.some((c) => c.code === currency) ? (
                  <option value={currency}>{currency}</option>
                ) : null}
              </select>
              <span className="text-xs text-slate-500">{t('settings.currencyDescription')}</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t('settings.recentActivityWindow')}</span>
              <select
                value={recentActivityDays}
                onChange={(e) => setRecentActivityDays(e.target.value as '7' | '30' | '90')}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="7">{t('settings.recentActivityWindow7')}</option>
                <option value="30">{t('settings.recentActivityWindow30')}</option>
                <option value="90">{t('settings.recentActivityWindow90')}</option>
              </select>
              <span className="text-xs text-slate-500">{t('settings.recentActivityWindowDescription')}</span>
            </label>

            {saveError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {saveError}
              </div>
            )}
            {saveMessage === 'ok' && (
              <p className="text-xs font-medium text-green-700">{t('settings.saveSuccess')}</p>
            )}

            <Button type="button" className="w-full" loading={saving} onClick={() => void handleSave()}>
              {t('settings.save')}
            </Button>
          </Card>
        </>
      )}
    </motion.div>
  );
}
