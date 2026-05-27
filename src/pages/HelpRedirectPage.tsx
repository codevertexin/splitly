import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getHelpUrl, mapPathnameToHelpContext } from '../lib/codevertexHelp';
import { shouldUseLocalHelp } from '../lib/codevertexConfig';
import { HelpPage } from './HelpPage';

/**
 * Production: redirect to Help Core. Dev without VITE_HELP_BASE_URL: local HelpPage.
 */
export function HelpRedirectPage() {
  const { i18n } = useTranslation();
  useEffect(() => {
    if (shouldUseLocalHelp()) return;
    const locale =
      i18n.language === 'pt-PT' || i18n.language === 'pt-BR' || i18n.language === 'es'
        ? i18n.language
        : 'en';
    const ctx = mapPathnameToHelpContext(
      typeof document !== 'undefined' && document.referrer
        ? new URL(document.referrer).pathname
        : '/dashboard',
    );
    const url = getHelpUrl({
      ...ctx,
      locale,
      returnTo: window.location.origin + '/settings',
    });
    window.location.replace(url);
  }, [i18n.language]);

  if (shouldUseLocalHelp()) {
    return <HelpPage />;
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
    </div>
  );
}
