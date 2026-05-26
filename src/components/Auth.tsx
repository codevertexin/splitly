import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandLogo } from './BrandLogo';
import { getAuthLoginUrl } from '../lib/codevertexAuth';
import { resolveSsoReturnPath } from '../lib/ssoReturnTo';

/**
 * Unauthenticated gate: auto-redirect to Auth Core (Startly-style).
 * Local email/password is only available at /dev-login in development.
 */
export function Auth() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace(getAuthLoginUrl(resolveSsoReturnPath()));
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col items-center gap-6"
      >
        <BrandLogo className="!h-24 w-auto sm:!h-28 max-w-[min(92vw,18rem)] object-contain" />
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
          <p className="text-center text-sm sm:text-base">{t('auth.redirectingToSecureLogin')}</p>
        </div>
      </motion.div>
    </div>
  );
}
