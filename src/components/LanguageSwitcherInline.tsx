import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const LANGS = [
  { code: 'pt-PT', label: 'PT' },
  { code: 'pt-BR', label: 'BR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
];

export function LanguageSwitcherInline() {
  const { i18n } = useTranslation();

  const changeLang = async (lang: string) => {
    await i18n.changeLanguage(lang);
    localStorage.setItem('app_lang', lang);

    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return;

    await supabase.auth.updateUser({
      data: {
        ...user.user_metadata,
        preferred_language: lang,
      },
    });

    await supabase
      .from('profiles')
      .update({ preferred_language: lang })
      .eq('id', user.id);
  };

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <span className="opacity-70">🌐</span>
      <div className="flex items-center gap-1">
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => changeLang(l.code)}
            className={`px-2 py-1 rounded-md text-xs transition-colors ${
              i18n.language === l.code
                ? 'bg-blue-50 text-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}