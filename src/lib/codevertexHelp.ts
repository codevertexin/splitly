/**
 * Help Core URL builder (CodeVertex standard).
 * @see https://help.codevertex.cc/help?app_code=…&locale=…&module_code=…&screen_code=…
 */

import { APP_CODE, HELP_BASE_URL } from './codevertexConfig';

export type HelpSourceSurface = 'external_app_help' | 'in_app' | 'footer';

export type GetHelpUrlOptions = {
  moduleCode: string;
  screenCode: string;
  returnTo?: string;
  locale?: string;
  sourceSurface?: HelpSourceSurface;
};

const DEFAULT_SOURCE_SURFACE: HelpSourceSurface = 'external_app_help';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Splitly URL to return to after Help Core (referrer or dashboard). */
export function resolveHelpReturnTo(): string {
  if (typeof window === 'undefined') return '';
  try {
    const ref = document.referrer;
    if (ref) {
      const u = new URL(ref);
      if (
        u.origin === window.location.origin &&
        u.pathname.replace(/\/+$/, '') !== '/help'
      ) {
        return ref;
      }
    }
  } catch {
    // ignore
  }
  return `${stripTrailingSlash(window.location.origin)}/dashboard`;
}

function resolveAbsoluteReturnTo(returnTo?: string): string {
  const raw = (returnTo ?? '/').trim() || '/';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window !== 'undefined' && window.location?.origin) {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${stripTrailingSlash(window.location.origin)}${path}`;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function getHelpUrl(options: GetHelpUrlOptions): string {
  const base = stripTrailingSlash(HELP_BASE_URL);
  const url = new URL(`${base}/help`);
  url.searchParams.set('app_code', APP_CODE);
  url.searchParams.set('locale', options.locale?.trim() || 'en');
  url.searchParams.set('module_code', options.moduleCode.trim() || 'app');
  url.searchParams.set('screen_code', options.screenCode.trim() || 'dashboard');
  url.searchParams.set(
    'source_surface',
    options.sourceSurface ?? DEFAULT_SOURCE_SURFACE,
  );
  url.searchParams.set('return_to', resolveAbsoluteReturnTo(options.returnTo));
  return url.toString();
}

export type HelpContext = {
  moduleCode: string;
  screenCode: string;
};

/** Maps in-app pathname to Help Core module_code / screen_code. */
export function mapPathnameToHelpContext(pathname: string): HelpContext {
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const map: Record<string, HelpContext> = {
    dashboard: { moduleCode: 'app', screenCode: 'dashboard' },
    groups: { moduleCode: 'groups', screenCode: 'list' },
    expenses: { moduleCode: 'expenses', screenCode: 'list' },
    events: { moduleCode: 'events', screenCode: 'list' },
    reports: { moduleCode: 'reports', screenCode: 'overview' },
    settings: { moduleCode: 'settings', screenCode: 'general' },
    people: { moduleCode: 'contacts', screenCode: 'list' },
    contacts: { moduleCode: 'contacts', screenCode: 'list' },
    help: { moduleCode: 'app', screenCode: 'help' },
    legal: { moduleCode: 'app', screenCode: 'legal' },
  };
  return map[segment] ?? { moduleCode: 'app', screenCode: 'dashboard' };
}
