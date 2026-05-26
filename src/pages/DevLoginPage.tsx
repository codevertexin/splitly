import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { BrandLogo } from '../components/BrandLogo';
import { getStoredAppInviteRef } from '../lib/appInviteRef';
import { trackProductEvent } from '../lib/productTracking';
import { LanguageSwitcherInline } from '../components/LanguageSwitcherInline';
import { getPendingGroupInviteToken } from '../lib/groupInviteToken';

/** Development-only local Supabase auth (not linked from main UI). */
export function DevLoginPage() {
  const { t } = useTranslation();

  if (!import.meta.env.DEV) {
    return <Navigate to="/" replace />;
  }

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [username, setUsername] = useState('');

  const redirectToPendingInviteIfAny = () => {
    const pendingInviteToken = getPendingGroupInviteToken();
    if (pendingInviteToken) {
      window.location.href = `/invite/${pendingInviteToken}`;
      return true;
    }
    return false;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const trimmedName = displayName.trim();
        const trimmedUsername = username.trim().toLowerCase();

        if (trimmedName.length < 2) {
          setMessage({ type: 'error', text: t('auth.displayNameTooShort') });
          setLoading(false);
          return;
        }

        if (trimmedUsername.length < 3) {
          setMessage({ type: 'error', text: t('auth.usernameTooShort') });
          setLoading(false);
          return;
        }

        if (!/^[a-z0-9._]+$/.test(trimmedUsername)) {
          setMessage({ type: 'error', text: t('auth.usernameInvalid') });
          setLoading(false);
          return;
        }

        const appInvitedBy = getStoredAppInviteRef();
        const currentLanguage = localStorage.getItem('app_lang') || 'en';

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: trimmedName,
              username: trimmedUsername,
              preferred_language: currentLanguage,
              ...(appInvitedBy ? { app_invited_by: appInvitedBy } : {}),
            },
          },
        });
        if (error) throw error;

        void trackProductEvent('signup_completed', {
          user_id: data.user?.id ?? null,
          once_key: 'signup_completed',
          metadata: { hasAppInviteRef: Boolean(appInvitedBy) },
        });

        setMessage({ type: 'success', text: t('auth.confirmEmail') });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        void trackProductEvent('login_completed', {
          user_id: data.user?.id ?? null,
          metadata: { method: 'password' },
        });

        if (redirectToPendingInviteIfAny()) {
          return;
        }
      }
    } catch (error: unknown) {
      console.error('Dev auth error:', error);
      const err = error as { message?: string; error_description?: string; msg?: string };
      setMessage({
        type: 'error',
        text:
          err?.message ||
          err?.error_description ||
          err?.msg ||
          t('auth.genericError'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-6 sm:py-10 bg-gradient-to-b from-amber-50/80 to-white">
      <div className="flex w-full max-w-md flex-col items-center">
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900">
          {t('auth.devLoginBanner')}
        </p>

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex w-full flex-col items-center"
        >
          <BrandLogo className="!h-20 w-auto max-w-[min(92vw,18rem)] object-contain" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full rounded-3xl border border-slate-100 bg-white p-7 shadow-xl"
        >
          <div className="mb-6 flex justify-end">
            <LanguageSwitcherInline />
          </div>

          <p className="mb-6 text-center text-sm text-slate-600">
            {isSignUp ? t('auth.taglineSignUp') : t('auth.taglineSignIn')}
          </p>

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t('auth.displayName')}
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {t('auth.username')}
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    autoComplete="username"
                    value={username}
                    onChange={(e) =>
                      setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t('auth.email')}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t('auth.password')}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-12 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {message && (
              <div
                className={`rounded-xl p-3 text-sm ${
                  message.type === 'success'
                    ? 'border border-green-100 bg-green-50 text-green-700'
                    : 'border border-red-100 bg-red-50 text-red-700'
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-5 w-5 animate-spin" />}
              {isSignUp ? t('auth.signUp') : t('auth.signIn')}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsSignUp((prev) => !prev);
              setMessage(null);
            }}
            className="mt-4 w-full text-sm text-blue-600 hover:text-blue-700"
          >
            {isSignUp ? t('auth.signIn') : t('auth.signUp')}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
