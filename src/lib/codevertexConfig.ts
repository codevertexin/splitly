/**
 * CodeVertex Core URLs and helpers (Splitly × ecosystem).
 * Phase 1: config + external Help/Legal only — no Auth session changes.
 */

const DEFAULT_APP_CODE = 'SPLITLY';
const DEFAULT_ECOSYSTEM_CODE = 'codevertex';
const DEFAULT_AUTH_BASE_URL = 'https://auth.codevertex.cc';
const DEFAULT_BILLING_BASE_URL = 'https://billing.codevertex.cc';
const DEFAULT_HELP_BASE_URL = 'https://help.codevertex.cc';
const DEFAULT_LEGAL_BASE_URL = 'https://legal.codevertex.cc';

function readEnv(key: string): string | undefined {
  const raw = import.meta.env[key] as string | undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function baseUrl(envKey: string, fallback: string): string {
  return readEnv(envKey) ?? fallback;
}

export const APP_CODE = readEnv('VITE_APP_CODE') ?? DEFAULT_APP_CODE;
export const ECOSYSTEM_CODE = readEnv('VITE_ECOSYSTEM_CODE') ?? DEFAULT_ECOSYSTEM_CODE;
export const AUTH_BASE_URL = baseUrl('VITE_AUTH_BASE_URL', DEFAULT_AUTH_BASE_URL);
export const BILLING_BASE_URL = baseUrl('VITE_BILLING_BASE_URL', DEFAULT_BILLING_BASE_URL);
export const HELP_BASE_URL = baseUrl('VITE_HELP_BASE_URL', DEFAULT_HELP_BASE_URL);
export const LEGAL_BASE_URL = baseUrl('VITE_LEGAL_BASE_URL', DEFAULT_LEGAL_BASE_URL);

/** In-app help route (dev / fallback only). */
export const LOCAL_HELP_PATH = '/help';

export type HelpScreen =
  | 'dashboard'
  | 'groups'
  | 'expenses'
  | 'events'
  | 'reports'
  | 'settlements'
  | 'settings'
  | 'billing'
  | 'account';

export type LegalPageKey =
  | 'privacy'
  | 'terms'
  | 'cookies'
  | 'gdpr'
  | 'delete-data'
  | 'contact';

const LEGAL_PATH_BY_KEY: Record<LegalPageKey, string> = {
  privacy: '/privacy',
  terms: '/terms',
  cookies: '/cookies',
  gdpr: '/gdpr',
  'delete-data': '/delete-request',
  contact: '/contact',
};

/** Footer id `deleteData` maps to Legal Core `delete-request`. */
export type LegalFooterPageKey = LegalPageKey | 'deleteData';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Dev fallback: use local /help when VITE_HELP_BASE_URL is unset.
 * Production always uses Help Core (default base URL applies).
 */
export function shouldUseLocalHelp(): boolean {
  if (readEnv('VITE_HELP_BASE_URL')) return false;
  return import.meta.env.DEV;
}

/**
 * Dev fallback: use in-app /legal/* when VITE_LEGAL_BASE_URL is unset.
 * Production always uses Legal Core (default base URL applies).
 */
export function shouldUseLocalLegal(): boolean {
  if (readEnv('VITE_LEGAL_BASE_URL')) return false;
  return import.meta.env.DEV;
}

export function mapPathnameToHelpScreen(pathname: string): HelpScreen {
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const map: Record<string, HelpScreen> = {
    dashboard: 'dashboard',
    groups: 'groups',
    expenses: 'expenses',
    events: 'events',
    reports: 'reports',
    settings: 'settings',
    people: 'account',
    contacts: 'account',
    help: 'dashboard',
    legal: 'dashboard',
  };
  return map[segment] ?? 'dashboard';
}

export function getHelpUrl(screen: string = 'dashboard', locale: string = 'en'): string {
  const base = stripTrailingSlash(HELP_BASE_URL);
  const app = encodeURIComponent(APP_CODE);
  const scr = encodeURIComponent(screen || 'dashboard');
  const loc = encodeURIComponent(locale || 'en');
  return `${base}/help/${APP_CODE}?app=${app}&screen=${scr}&locale=${loc}`;
}

export function getLegalUrl(page: LegalFooterPageKey): string {
  const pathKey: LegalPageKey = page === 'deleteData' ? 'delete-data' : page;
  const path = LEGAL_PATH_BY_KEY[pathKey];
  const base = stripTrailingSlash(LEGAL_BASE_URL);
  return `${base}${path}?app=${encodeURIComponent(APP_CODE)}`;
}

export function getAuthProfileUrl(): string {
  const base = stripTrailingSlash(AUTH_BASE_URL);
  return `${base}/account/profile?app=${encodeURIComponent(APP_CODE)}`;
}

export function getAuthSecurityUrl(): string {
  const base = stripTrailingSlash(AUTH_BASE_URL);
  return `${base}/account/security?app=${encodeURIComponent(APP_CODE)}`;
}

export function getBillingUrl(): string {
  const base = stripTrailingSlash(BILLING_BASE_URL);
  return `${base}/account?app=${encodeURIComponent(APP_CODE)}`;
}

export type LegalFooterLink = {
  id: LegalFooterPageKey;
  href: string;
  external: boolean;
};

const FOOTER_LEGAL_ORDER: LegalFooterPageKey[] = [
  'privacy',
  'terms',
  'cookies',
  'gdpr',
  'deleteData',
  'contact',
];

const LOCAL_LEGAL_PATH: Record<LegalFooterPageKey, string> = {
  privacy: '/legal/privacy',
  terms: '/legal/terms',
  cookies: '/legal/cookies',
  gdpr: '/legal/gdpr',
  deleteData: '/legal/delete-data',
  contact: '/legal/contact',
};

/** Footer legal links — Core in production; local paths only in dev without VITE_LEGAL_BASE_URL. */
export function getLegalFooterLinks(): LegalFooterLink[] {
  const useLocal = shouldUseLocalLegal();
  return FOOTER_LEGAL_ORDER.map((id) => {
    if (useLocal) {
      return { id, href: LOCAL_LEGAL_PATH[id], external: false };
    }
    return { id, href: getLegalUrl(id), external: true };
  });
}
