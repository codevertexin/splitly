import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLegalFooterLinks } from '../lib/codevertexConfig';

export function LegalFooterLinks() {
  const { t } = useTranslation();
  const links = getLegalFooterLinks();

  return (
    <nav
      aria-label={t('legal.footerNav')}
      className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-slate-500"
    >
      {links.map((link, index) => (
        <span key={link.id} className="inline-flex items-center gap-1.5">
          {index > 0 && (
            <span className="text-slate-300 select-none" aria-hidden>
              |
            </span>
          )}
          {link.external ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-700 underline-offset-2 hover:underline"
            >
              {t(`legal.links.${link.id}`)}
            </a>
          ) : (
            <Link to={link.href} className="hover:text-slate-700 underline-offset-2 hover:underline">
              {t(`legal.links.${link.id}`)}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
