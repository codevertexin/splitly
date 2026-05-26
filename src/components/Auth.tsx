import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandLogo } from './BrandLogo';
import { getStoredAppInviteRef } from '../lib/appInviteRef';
import { trackProductEvent } from '../lib/productTracking';
import { LanguageSwitcherInline } from './LanguageSwitcherInline';
import { getPendingGroupInviteToken } from '../lib/groupInviteToken';
import {
  getAuthForgotPasswordUrl,
  getAuthLoginUrl,
  getAuthRegisterUrl,
  isAuthCoreEnabled,
} from '../lib/codevertexAuth';

function resolveSsoReturnTo(): string {
  const pendingInvite = getPendingGroupInviteToken();
  if (pendingInvite) return `/invite/${pendingInvite}`;
  return '/dashboard';
}

export function Auth() {
  const { t } = useTranslation();
  const authCoreEnabled = isAuthCoreEnabled();
  const [showLocalAuth, setShowLocalAuth] = useState(!authCoreEnabled);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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
    } catch (error: any) {
      console.error('Auth error:', error);

      const message =
        error?.message ||
        error?.error_description ||
        error?.msg ||
        t('auth.genericError');
    
      setMessage({ type: 'error', text: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-6 sm:py-10 bg-gradient-to-b from-slate-50 to-white">
      <div className="flex w-full max-w-md flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-5 sm:mb-6 flex w-full flex-col items-center gap-2"
        >
          <BrandLogo className="!h-24 w-auto sm:!h-28 md:!h-32 max-w-[min(92vw,22rem)] mx-auto object-contain" />
          <p className="text-sm text-slate-500 text-center">{t('auth.brandingHint')}</p>
        </motion.div>

        <motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.35, delay: 0.05 }}
  className="w-full p-7 bg-white border border-slate-100 shadow-xl rounded-3xl"
>
  <div className="mb-6 flex justify-end">
    <LanguageSwitcherInline />
  </div>

  <p className="text-slate-600 text-center text-sm sm:text-base mb-6 leading-relaxed">
    {authCoreEnabled && !showLocalAuth
      ? t('auth.taglineAuthCore')
      : isSignUp
        ? t('auth.taglineSignUp')
        : t('auth.taglineSignIn')}
  </p>

        {authCoreEnabled && !showLocalAuth ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = getAuthLoginUrl(resolveSsoReturnTo());
              }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all"
            >
              {t('auth.signInWithAuthCore')}
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = getAuthRegisterUrl(resolveSsoReturnTo());
              }}
              className="w-full py-3 border border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 text-slate-800 font-semibold rounded-xl transition-all"
            >
              {t('auth.signUpWithAuthCore')}
            </button>
            <div className="text-center">
              <a
                href={getAuthForgotPasswordUrl()}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('auth.forgotPassword')}
              </a>
            </div>
            <button
              type="button"
              onClick={() => setShowLocalAuth(true)}
              className="w-full pt-2 text-sm text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline"
            >
              {t('auth.useLocalAuth')}
            </button>
          </div>
        ) : (
        <>
        {authCoreEnabled && (
          <button
            type="button"
            onClick={() => {
              setShowLocalAuth(false);
              setMessage(null);
            }}
            className="mb-4 w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {t('auth.backToAuthCore')}
          </button>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
        {isSignUp && (
  <>
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {t('auth.displayName')}
      </label>
      <input
        type="text"
        required
        minLength={2}
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 transition-all outline-none"
        placeholder={t('auth.displayNamePlaceholder')}
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {t('auth.username')}
      </label>
      <input
        type="text"
        required
        minLength={3}
        autoComplete="username"
        value={username}
        onChange={(e) =>
          setUsername(
            e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '')
          )
        }
        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 transition-all outline-none"
        placeholder={t('auth.usernamePlaceholder')}
      />
    </div>
  </>
)}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('auth.email')}</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 transition-all outline-none"
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('auth.password')}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full pl-10 pr-12 py-3 bg-slate-50 border rounded-xl placeholder:text-slate-400 hover:border-slate-300 focus:bg-white transition-all outline-none ${
                  message?.type === 'error'
                    ? 'border-red-200 focus:ring-4 focus:ring-red-500/15 focus:border-red-500'
                    : 'border-slate-200 focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500'
                }`}
                placeholder={t('auth.passwordPlaceholder')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {!isSignUp && (
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                {t('auth.rememberMe')}
              </label>
              {authCoreEnabled ? (
                <a
                  href={getAuthForgotPasswordUrl()}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {t('auth.forgotPassword')}
                </a>
              ) : (
                <button
                  type="button"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  onClick={() => setMessage({ type: 'error', text: t('auth.forgotPasswordHint') })}
                >
                  {t('auth.forgotPassword')}
                </button>
              )}
            </div>
          )}

          {message && (
            <div className={`p-3 rounded-xl text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {isSignUp ? t('auth.loadingSignUp') : t('auth.loadingSignIn')}
              </>
            ) : isSignUp ? t('auth.signUp') : t('auth.signIn')}
          </button>
        </form>

        <div className="mt-5 text-center space-y-3">
        <button
  type="button"
  onClick={() => {
    setIsSignUp((prev) => !prev);
    setMessage(null);
    setDisplayName('');
    setUsername('');
    setPassword('');
  }}
  className="w-full py-3 border border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 text-slate-800 font-semibold rounded-xl transition-all"
>
  {isSignUp ? t('auth.signIn') : t('auth.signUp')}
</button>
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            {t('auth.trustHint')}
          </div>
        </div>
        </>
        )}
        </motion.div>
      </div>
    </div>
  );
}
