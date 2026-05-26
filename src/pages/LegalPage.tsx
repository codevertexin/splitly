import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LegalLinkId } from '../lib/siteLinks';
import { SUPPORT_HELP_PATH } from '../lib/siteLinks';

const VALID_TOPICS = new Set<LegalLinkId>([
  'privacy',
  'terms',
  'cookies',
  'gdpr',
  'deleteData',
  'contact',
]);

const ROUTE_TO_TOPIC: Record<string, LegalLinkId> = {
  privacy: 'privacy',
  terms: 'terms',
  cookies: 'cookies',
  gdpr: 'gdpr',
  'delete-data': 'deleteData',
  contact: 'contact',
};

export function LegalPage() {
  const { topic } = useParams<{ topic: string }>();
  const { t, i18n } = useTranslation();

  const legalId = topic ? ROUTE_TO_TOPIC[topic] : undefined;

  if (!legalId || !VALID_TOPICS.has(legalId)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">{t('legal.notFoundTitle')}</h1>
        <p className="text-sm text-slate-600">{t('legal.notFoundBody')}</p>
        <Link to={SUPPORT_HELP_PATH} className="text-sm font-semibold text-blue-600 underline underline-offset-2">
          {t('layout.supportAndHelp')}
        </Link>
      </div>
    );
  }

  const bodyKey = `legal.pages.${legalId}.body`;
  const hasPoints = i18n.exists(`legal.pages.${legalId}.point1`);

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t(`legal.pages.${legalId}.title`)}</h1>
        {i18n.exists(`legal.pages.${legalId}.subtitle`) && (
          <p className="text-sm text-slate-600 sm:text-base">{t(`legal.pages.${legalId}.subtitle`)}</p>
        )}
      </header>

      <div className="prose prose-slate max-w-none text-sm leading-relaxed text-slate-700 sm:text-base">
        <p>{t(bodyKey)}</p>
        {hasPoints && (
          <ul className="mt-4 list-disc space-y-2 pl-5">
            {i18n.exists(`legal.pages.${legalId}.point1`) && <li>{t(`legal.pages.${legalId}.point1`)}</li>}
            {i18n.exists(`legal.pages.${legalId}.point2`) && <li>{t(`legal.pages.${legalId}.point2`)}</li>}
            {i18n.exists(`legal.pages.${legalId}.point3`) && <li>{t(`legal.pages.${legalId}.point3`)}</li>}
          </ul>
        )}
      </div>

      {legalId === 'deleteData' && (
        <p className="text-sm">
          <Link to="/settings" className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700">
            {t('legal.pages.deleteData.settingsLink')}
          </Link>
        </p>
      )}

      {legalId === 'contact' && (
        <p className="text-sm">
          <Link to={SUPPORT_HELP_PATH} className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700">
            {t('legal.pages.contact.helpLink')}
          </Link>
        </p>
      )}

      <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">
        <Link to={SUPPORT_HELP_PATH} className="font-medium text-slate-600 underline underline-offset-2 hover:text-slate-800">
          ← {t('layout.supportAndHelp')}
        </Link>
      </p>
    </article>
  );
}
