import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  getHelpUrl,
  mapPathnameToHelpContext,
  resolveHelpReturnTo,
} from '../lib/codevertexHelp';
import { HelpPage } from './HelpPage';

/**
 * Production: always redirect to Help Core (never local FAQ).
 * Dev only: optional local FAQ via `import.meta.env.DEV`.
 */
export function HelpRedirectPage() {
  const { i18n } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) return;

    const locale =
      i18n.language === 'pt-PT' || i18n.language === 'pt-BR' || i18n.language === 'es'
        ? i18n.language
        : 'en';

    const hashScreen = location.hash.replace(/^#/, '').trim();
    const referrerPath = (() => {
      try {
        const ref = document.referrer;
        if (!ref) return null;
        const u = new URL(ref);
        if (u.origin !== window.location.origin) return null;
        if (u.pathname.replace(/\/+$/, '') === '/help') return null;
        return u.pathname;
      } catch {
        return null;
      }
    })();

    const ctx = hashScreen
      ? { moduleCode: 'app', screenCode: hashScreen }
      : mapPathnameToHelpContext(referrerPath ?? '/dashboard');

    const url = getHelpUrl({
      ...ctx,
      locale,
      returnTo: resolveHelpReturnTo(),
    });
    window.location.replace(url);
  }, [i18n.language, location.hash]);

  if (import.meta.env.DEV) {
    return <HelpPage />;
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
    </div>
  );
}
