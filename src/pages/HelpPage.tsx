import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

type HelpItem = {
  id: 'balances' | 'draft' | 'groups' | 'events' | 'settle' | 'privacy' | 'expenses';
  action?: { to: string; labelKey: string };
};

const HELP_SECTIONS: Array<{ id: 'gettingStarted' | 'expensesBalances' | 'groupsEvents'; items: HelpItem[] }> = [
  {
    id: 'gettingStarted',
    items: [
      { id: 'groups', action: { to: '/groups', labelKey: 'help.actions.goToGroups' } },
      { id: 'events', action: { to: '/events', labelKey: 'help.actions.goToEvents' } },
    ],
  },
  {
    id: 'expensesBalances',
    items: [
      { id: 'balances', action: { to: '/expenses', labelKey: 'help.actions.addExpense' } },
      { id: 'draft', action: { to: '/events', labelKey: 'help.actions.goToEvents' } },
      { id: 'expenses', action: { to: '/expenses', labelKey: 'help.actions.addExpense' } },
      { id: 'settle', action: { to: '/expenses', labelKey: 'help.actions.goToExpenses' } },
    ],
  },
  {
    id: 'groupsEvents',
    items: [{ id: 'privacy' }],
  },
];

export function HelpPage() {
  const { t, i18n } = useTranslation();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('help.title')}</h1>
        <p className="text-sm text-slate-600 sm:text-base">{t('help.subtitle')}</p>
      </header>

      {HELP_SECTIONS.map((section) => (
        <section key={section.id} className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            {t(`help.sections.${section.id}`)}
          </h2>
          <div className="space-y-4">
            {section.items.map((item) => (
              <details
                key={item.id}
                id={item.id}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <summary className="cursor-pointer list-none pr-6 text-base font-semibold text-slate-900 marker:content-['']">
                  {t(`help.questions.${item.id}.question`)}
                </summary>
                <p className="pt-3 text-sm leading-relaxed text-slate-700 sm:text-base">
                  {item.id === 'expenses'
                    ? t('accounting.whatCountsTowardBalances')
                    : t(`help.questions.${item.id}.answer`)}
                </p>
                {(i18n.exists(`help.questions.${item.id}.point1`) || i18n.exists(`help.questions.${item.id}.point2`)) && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {i18n.exists(`help.questions.${item.id}.point1`) && (
                      <li>{t(`help.questions.${item.id}.point1`)}</li>
                    )}
                    {i18n.exists(`help.questions.${item.id}.point2`) && (
                      <li>{t(`help.questions.${item.id}.point2`)}</li>
                    )}
                  </ul>
                )}
                {item.action && (
                  <div className="mt-3">
                    <Link
                      to={item.action.to}
                      className="text-sm font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700"
                    >
                      {t(item.action.labelKey)}
                    </Link>
                  </div>
                )}
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
