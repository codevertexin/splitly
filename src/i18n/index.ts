import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ptPT from '../locales/pt-PT.json';
import ptBR from '../locales/pt-BR.json';
import es from '../locales/es.json';

export const I18N_STORAGE_KEY = 'splitly_i18nextLng';

export const SUPPORTED_LOCALES = ['en', 'pt-PT', 'pt-BR', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Se válido, aplica i18n (dispara languageChanged → localStorage e lang no documento). */
export async function setAppLanguage(lng: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(lng);
}

function getInitialLng(): string {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(I18N_STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) return stored;
  } catch {
    /* ignore */
  }
  const n = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  if (n.toLowerCase().startsWith('pt-br')) return 'pt-BR';
  if (n.toLowerCase().startsWith('pt')) return 'pt-PT';
  if (n.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

function applyHtmlLang(lng: string) {
  document.documentElement.lang =
    lng === 'pt-BR' ? 'pt-BR' : lng === 'pt-PT' ? 'pt-PT' : lng === 'es' ? 'es' : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'pt-PT': { translation: ptPT },
    'pt-BR': { translation: ptBR },
    es: { translation: es },
  },
  lng: getInitialLng(),
  fallbackLng: {
    'pt-BR': ['pt-PT', 'en'],
    default: ['en'],
  },
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
});

applyHtmlLang(i18n.language);
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(I18N_STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
  applyHtmlLang(lng);
});

export default i18n;
