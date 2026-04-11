import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import type { BillingPlanId, UpgradeModalProps } from '../types/billing.types';

export type { UpgradeModalProps };

export function UpgradeModal({
  isOpen,
  onClose,
  title,
  subtitle,
  benefits,
  plans,
  recommendedPlanId,
  recommendedBadgeLabel,
  onCheckout,
  primaryCtaLabel,
  secondaryCtaLabel,
  loading = false,
  error = null,
  defaultSelectedPlanId,
}: UpgradeModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<BillingPlanId>(recommendedPlanId);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPlanId(defaultSelectedPlanId ?? recommendedPlanId);
  }, [isOpen, defaultSelectedPlanId, recommendedPlanId]);

  const radiogroupId = 'upgrade-modal-plans';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="xl"
      stackClassName="z-[100]"
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">{subtitle}</p>

        {benefits.length > 0 && (
          <ul className="space-y-2">
            {benefits.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-slate-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                  <Check className="h-3 w-3" aria-hidden />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p id={`${radiogroupId}-label`} className="sr-only">
            {title}
          </p>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            role="radiogroup"
            aria-labelledby={`${radiogroupId}-label`}
          >
            {plans.map((plan) => {
              const isRecommended = plan.id === recommendedPlanId;
              const isSelected = plan.id === selectedPlanId;
              return (
                <button
                  key={plan.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={loading}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={[
                    'relative flex flex-col rounded-2xl border p-4 text-left transition-all',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
                    isSelected
                      ? 'border-sky-500 bg-sky-50/90 shadow-sm ring-2 ring-sky-500/30'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                    isRecommended && !isSelected ? 'ring-1 ring-sky-200' : '',
                  ].join(' ')}
                >
                  {isRecommended && (
                    <span className="absolute -top-2.5 left-3 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {recommendedBadgeLabel}
                    </span>
                  )}
                  <span className="mt-1 text-sm font-semibold text-slate-900">{plan.name}</span>
                  <span className="mt-2 text-lg font-bold tracking-tight text-slate-900">{plan.price}</span>
                  {plan.detail ? (
                    <span className="mt-1 text-xs text-slate-500">{plan.detail}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading} className="w-full sm:w-auto">
            {secondaryCtaLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={loading}
            className="w-full sm:w-auto"
            onClick={() => void onCheckout(selectedPlanId)}
          >
            {primaryCtaLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
