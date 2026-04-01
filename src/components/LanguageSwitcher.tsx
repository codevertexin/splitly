import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import type { SupportedLocale } from '../i18n';
import { isSupportedLocale } from '../i18n';

const OPTIONS: { value: SupportedLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'pt-PT', label: 'Português (PT)' },
  { value: 'pt-BR', label: 'Português (BR)' },
  { value: 'es', label: 'Español' },
];

interface LanguageSwitcherProps {
  className?: string;
  /** Depois de `changeLanguage` (i18n + localStorage). Ex.: gravar `profiles.preferred_language`. */
  afterLanguageChange?: (locale: SupportedLocale) => void | Promise<void>;
}

export function LanguageSwitcher({ className = '', afterLanguageChange }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const value = OPTIONS.some((o) => o.value === i18n.language)
    ? (i18n.language as SupportedLocale)
    : 'en';

  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
        <Globe className="w-4 h-4 text-slate-500" aria-hidden />
        {t('settings.language')}
      </span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (!isSupportedLocale(v)) return;
          void (async () => {
            await i18n.changeLanguage(v);
            await afterLanguageChange?.(v);
          })();
        }}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-slate-500">{t('settings.languageDescription')}</span>
    </label>
  );
}
