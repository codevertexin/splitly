import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { CheckCircle2 } from 'lucide-react';

export interface UpgradeSuccessModalProps {
  isOpen: boolean;
  /** Primary: resume the action that was blocked before checkout */
  onContinue: () => void | Promise<void>;
  onDismiss?: () => void;
  loading?: boolean;
}

export function UpgradeSuccessModal({
  isOpen,
  onContinue,
  onDismiss,
  loading = false,
}: UpgradeSuccessModalProps) {
  const { t } = useTranslation();
  const handleSecondary = () => {
    onDismiss?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (onDismiss) onDismiss();
        else void onContinue();
      }}
      title={t('billing.upgradeSuccess.title')}
      size="md"
      closable
      stackClassName="z-[100]"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-700">
            {t('billing.upgradeSuccess.body')}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {onDismiss && (
            <Button type="button" variant="outline" onClick={handleSecondary} disabled={loading}>
              {t('billing.upgradeSuccess.later')}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            loading={loading}
            onClick={() => void onContinue()}
          >
            {t('billing.upgradeSuccess.continue')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
