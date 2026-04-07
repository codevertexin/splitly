import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, UserPlus, Plus, Calendar } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

type GroupOnboardingHeroProps = {
  hasDrafts: boolean;
  onAddExpense: () => void;
  onInvite: () => void;
  onCreateEvent?: () => void;
};

export function GroupOnboardingHero({
  hasDrafts,
  onAddExpense,
  onInvite,
  onCreateEvent,
}: GroupOnboardingHeroProps) {
  const { t } = useTranslation();

  return (
    <section className="mb-8 overflow-hidden rounded-3xl border border-blue-100/90 bg-gradient-to-br from-blue-50/90 via-white to-slate-50/80 p-6 shadow-sm ring-1 ring-blue-100/60 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-900/20">
          <Sparkles className="h-7 w-7" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-xl font-bold tracking-tight text-slate-900">{t('groupOnboarding.title')}</h3>
          <p className="text-sm leading-relaxed text-slate-600">{t('groupOnboarding.subtitle')}</p>
          {hasDrafts && (
            <p className="rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">{t('groupOnboarding.draftsHint')}</p>
          )}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="primary" size="lg" className="w-full py-3.5 text-base font-bold shadow-lg sm:w-auto sm:min-w-[200px]" onClick={onAddExpense}>
          <Plus className="mr-2 h-5 w-5" />
          {t('groupOnboarding.ctaFirstExpense')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full border-slate-300 py-3.5 text-base font-semibold sm:w-auto"
          onClick={onInvite}
        >
          <UserPlus className="mr-2 h-4 w-4 shrink-0" />
          {t('groupOnboarding.ctaInvite')}
        </Button>
        {onCreateEvent && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full py-3.5 text-base font-semibold text-slate-600 ring-1 ring-slate-200/90 ring-inset hover:bg-slate-50 sm:w-auto"
            onClick={onCreateEvent}
          >
            <Calendar className="mr-2 h-4 w-4 shrink-0" />
            {t('groupOnboarding.ctaEvent')}
          </Button>
        )}
      </div>
    </section>
  );
}
