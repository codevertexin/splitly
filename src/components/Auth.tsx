import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandLogo } from './BrandLogo';
import { getStoredAppInviteRef } from '../lib/appInviteRef';

export function Auth() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const appInvitedBy = getStoredAppInviteRef();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          ...(appInvitedBy
            ? { options: { data: { app_invited_by: appInvitedBy } } }
            : {}),
        });
        if (error) throw error;
        setMessage({ type: 'success', text: t('auth.confirmEmail') });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
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
          <p className="text-slate-600 text-center text-sm sm:text-base mb-6 leading-relaxed">
            {isSignUp ? t('auth.taglineSignUp') : t('auth.taglineSignIn')}
          </p>

        <form onSubmit={handleAuth} className="space-y-4">
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
              <button
                type="button"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
                onClick={() => setMessage({ type: 'error', text: t('auth.forgotPasswordHint') })}
              >
                {t('auth.forgotPassword')}
              </button>
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
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full py-3 border border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 text-slate-800 font-semibold rounded-xl transition-all"
          >
            {isSignUp ? t('auth.signIn') : t('auth.signUp')}
          </button>
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            {t('auth.trustHint')}
          </div>
        </div>
        </motion.div>
      </div>
    </div>
  );
}
