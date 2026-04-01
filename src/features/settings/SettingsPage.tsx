import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Settings as SettingsIcon, AlertCircle, Loader2, Upload, ImageIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { MemberAvatar } from '../../components/MemberAvatar';
import {
  useUserProfile,
  normalizeUsernameInput,
  validateUsernameOrEmpty,
} from '../../hooks/useUserProfile';
import { AVATAR_PRESET_PATHS } from '../../lib/avatarPresets';

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

const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function useTimezoneOptions(): string[] {
  return useMemo(() => {
    try {
      if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
        return [...Intl.supportedValuesOf('timeZone')].sort((a, b) => a.localeCompare(b));
      }
    } catch {
      /* ignore */
    }
    return FALLBACK_TIMEZONES;
  }, []);
}

function pathsMatchAvatar(stored: string | null | undefined, presetPath: string): boolean {
  if (!stored) return false;
  if (stored === presetPath) return true;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(stored, origin);
    return u.pathname === presetPath;
  } catch {
    return stored.endsWith(presetPath);
  }
}

interface SettingsPageProps {
  session: Session;
}

export function SettingsPage({ session }: SettingsPageProps) {
  const { t } = useTranslation();
  const userId = session.user.id;
  const {
    profile,
    loading,
    error,
    saving,
    saveProfileFields,
    updatePreferredLanguageInDatabase,
  } = useUserProfile(userId);

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [timezone, setTimezone] = useState('UTC');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [blobPreview, setBlobPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saveMessage, setSaveMessage] = useState<'ok' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [langPersistError, setLangPersistError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [recentActivityDays, setRecentActivityDays] = useState<'7' | '30' | '90'>('7');

  const timezoneOptions = useTimezoneOptions();

  const revokeBlob = (url: string | null) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  useEffect(() => {
    return () => revokeBlob(blobPreview);
  }, [blobPreview]);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? '');
    setFullName(profile.full_name ?? '');
    setCurrency(profile.default_currency?.trim() || 'EUR');
    setAvatarUrl(profile.avatar_url ?? null);
    setPendingFile(null);
    setBlobPreview((prev) => {
      revokeBlob(prev);
      return null;
    });

    const tz = profile.timezone?.trim();
    if (tz) {
      setTimezone(tz);
      return;
    }
    try {
      const guess =
        typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      setTimezone(guess && timezoneOptions.includes(guess) ? guess : 'UTC');
    } catch {
      setTimezone('UTC');
    }
  }, [profile, timezoneOptions]);

  useEffect(() => {
    const raw = localStorage.getItem('splitly_recent_activity_days');
    if (raw === '7' || raw === '30' || raw === '90') {
      setRecentActivityDays(raw);
    }
  }, []);

  const previewAvatarUrl = blobPreview || avatarUrl;
  const hasCustomPhoto =
    !!previewAvatarUrl &&
    !AVATAR_PRESET_PATHS.some((p) => pathsMatchAvatar(previewAvatarUrl, p));
  const usernameDraftError = useMemo(() => {
    const n = normalizeUsernameInput(username);
    if (n === null) return null;
    return validateUsernameOrEmpty(n) === true ? null : t('settings.usernameInvalid');
  }, [username, t]);

  const selectPreset = (path: string) => {
    revokeBlob(blobPreview);
    setBlobPreview(null);
    setPendingFile(null);
    setAvatarUrl(path);
  };

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    revokeBlob(blobPreview);
    const url = URL.createObjectURL(f);
    setBlobPreview(url);
    setPendingFile(f);
  };

  const clearAvatar = () => {
    revokeBlob(blobPreview);
    setBlobPreview(null);
    setPendingFile(null);
    setAvatarUrl(null);
  };

  const handleSave = async () => {
    setSaveMessage(null);
    setSaveError(null);
    const n = normalizeUsernameInput(username);
    if (n !== null && validateUsernameOrEmpty(n) !== true) {
      setSaveError(t('settings.usernameInvalid'));
      return;
    }

    localStorage.setItem('splitly_recent_activity_days', recentActivityDays);

    const result = await saveProfileFields({
      username,
      full_name: fullName,
      default_currency: currency,
      timezone,
      avatar_url: avatarUrl,
      avatarFile: pendingFile ?? undefined,
    });

    if (result.success) {
      setSaveMessage('ok');
      setPendingFile(null);
      setBlobPreview((prev) => {
        revokeBlob(prev);
        return null;
      });
      return;
    }

    if (result.code === 'USERNAME_INVALID') setSaveError(t('settings.usernameInvalid'));
    else if (result.code === 'USERNAME_TAKEN') setSaveError(t('settings.usernameTaken'));
    else if (result.code === 'AVATAR_UPLOAD_FAILED') {
      if (result.error === 'INVALID_TYPE') setSaveError(t('settings.avatarInvalidType'));
      else if (result.error === 'TOO_LARGE') setSaveError(t('settings.avatarTooLarge'));
      else setSaveError(t('settings.avatarUploadFailed'));
    } else setSaveError(result.error ?? t('settings.saveError'));
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
          <Card className="p-6 space-y-6">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {t('settings.profileSection')}
            </h4>

            <div className="flex flex-col items-center gap-3">
              <MemberAvatar
                userId={userId}
                fullName={fullName || session.user.email}
                avatarUrl={previewAvatarUrl}
                size="lg"
                className="!w-20 !h-20 text-base"
              />
              <p className="text-xs text-slate-500 text-center">{t('settings.avatarHint')}</p>
            </div>

            {!hasCustomPhoto && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowPresets((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                    showPresets ? 'text-blue-700' : 'text-slate-700'
                  } hover:text-blue-800`}
                >
                  <ImageIcon className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                  <span>{t('settings.avatarPresets')}</span>
                </button>
                {showPresets && (
                  <div className="flex items-center justify-between gap-2">
                    {AVATAR_PRESET_PATHS.map((path, index) => {
                      const active =
                        !pendingFile && pathsMatchAvatar(avatarUrl, path) && !blobPreview;
                      return (
                        <button
                          key={path}
                          type="button"
                          onClick={() => selectPreset(path)}
                          className={`rounded-2xl border-2 overflow-hidden w-10 h-10 sm:w-12 sm:h-12 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                            active
                              ? 'border-blue-600 ring-2 ring-blue-500/30 bg-blue-50/40'
                              : 'border-slate-100 hover:border-slate-200 bg-white'
                          }`}
                          aria-label={t('settings.avatarPresetPick', { n: index + 1 })}
                        >
                          <img src={path} alt="" className="w-full h-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="flex-1 min-w-[8rem]"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {t('settings.avatarUpload')}
                </Button>
                {(avatarUrl || pendingFile) && (
                  <Button type="button" variant="ghost" size="md" onClick={clearAvatar}>
                    {t('settings.avatarClear')}
                  </Button>
                )}
              </div>
              <span className="text-xs text-slate-500">{t('settings.avatarUploadHint')}</span>
            </div>

            <Input
              id="settings-username"
              label={t('settings.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder={t('settings.usernamePlaceholder')}
              autoComplete="username"
              error={usernameDraftError ?? undefined}
              helperText={t('settings.usernameHint')}
            />

            <Input
              id="settings-full-name"
              label={t('settings.fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('settings.fullNamePlaceholder')}
              autoComplete="name"
            />
          </Card>

          <Card className="p-6 space-y-6">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {t('settings.regionalSection')}
            </h4>

            <LanguageSwitcher
              afterLanguageChange={async (lng) => {
                setLangPersistError(null);
                const r = await updatePreferredLanguageInDatabase(lng);
                if (!r.success) setLangPersistError(r.error ?? t('settings.languageSaveError'));
              }}
            />
            {langPersistError && (
              <p className="text-xs text-red-600">{langPersistError}</p>
            )}

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
              <span className="text-sm font-medium text-slate-700">{t('settings.timezone')}</span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                {!timezoneOptions.includes(timezone) ? (
                  <option value={timezone}>{timezone}</option>
                ) : null}
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">{t('settings.timezoneDescription')}</span>
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
