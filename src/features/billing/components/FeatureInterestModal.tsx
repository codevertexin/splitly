import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Mail } from 'lucide-react';
import { trackProductEvent } from '../../../lib/productTracking';
import {
  PRODUCT_EVENT_BILLING_INTEREST_MODAL_OPENED,
  PRODUCT_EVENT_BILLING_INTEREST_REPEAT_OPEN,
  PRODUCT_EVENT_BILLING_INTEREST_SUBMITTED,
  SCAN_RECEIPT_FEATURE_KEY,
} from '../constants/billing.constants';
import { hasRegisteredFeatureInterest, submitFeatureInterest } from '../services/featureInterest.service';
import type { SubscriptionTier } from '../types/billing.types';

export interface FeatureInterestModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureKey: string;
  featureLabel?: string;
  /** Pre-filled email (e.g. from session) */
  defaultEmail?: string;
  /** Required for idempotent interest registration per user + feature. */
  userId?: string;
  onSubmitted?: () => void;
  /** Entry context from `guardAndRun(..., { interestSource })` for analytics. */
  flowSource?: string | null;
  subscriptionTier: SubscriptionTier;
  featureUnreleased: boolean;
}

function interestMetadataBase(opts: {
  featureKey: string;
  flowSource: string | null | undefined;
  subscriptionTier: SubscriptionTier;
  featureUnreleased: boolean;
  alreadyRegistered?: boolean;
}) {
  return {
    featureKey: opts.featureKey,
    source: opts.flowSource ?? 'unknown',
    subscription_tier: opts.subscriptionTier,
    feature_unreleased: opts.featureUnreleased,
    ...(opts.alreadyRegistered !== undefined ? { already_registered: opts.alreadyRegistered } : {}),
  };
}

export function FeatureInterestModal({
  isOpen,
  onClose,
  featureKey,
  featureLabel,
  defaultEmail = '',
  userId,
  onSubmitted,
  flowSource = null,
  subscriptionTier,
  featureUnreleased,
}: FeatureInterestModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  /** One init + analytics pass per modal open (avoid duplicate events if tier/source props change while open). */
  const openedCycleRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      openedCycleRef.current = false;
      return;
    }
    if (openedCycleRef.current) return;
    openedCycleRef.current = true;

    setEmail(defaultEmail);
    setMessage('');
    setError(null);
    setDone(false);

    const uid = userId?.trim();
    const already = uid ? hasRegisteredFeatureInterest(uid, featureKey) : false;
    setAlreadyRegistered(already);

    const meta = interestMetadataBase({
      featureKey,
      flowSource,
      subscriptionTier,
      featureUnreleased,
      alreadyRegistered: already,
    });

    void trackProductEvent(PRODUCT_EVENT_BILLING_INTEREST_MODAL_OPENED, { metadata: meta });

    if (already) {
      void trackProductEvent(PRODUCT_EVENT_BILLING_INTEREST_REPEAT_OPEN, { metadata: meta });
    }
  }, [isOpen, defaultEmail, featureKey, userId, flowSource, subscriptionTier, featureUnreleased]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await submitFeatureInterest({
      featureKey,
      userId: userId?.trim() || undefined,
      email: email.trim() || undefined,
      message: message.trim() || undefined,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t('billing.interestModal.submitError'));
      return;
    }
    if (result.deduped) {
      setAlreadyRegistered(true);
      return;
    }

    void trackProductEvent(PRODUCT_EVENT_BILLING_INTEREST_SUBMITTED, {
      metadata: interestMetadataBase({
        featureKey,
        flowSource,
        subscriptionTier,
        featureUnreleased,
      }),
    });
    setDone(true);
    onSubmitted?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={featureLabel || t('billing.interestModal.titleFallback')}
      size="md"
      stackClassName="z-[100]"
    >
      {alreadyRegistered ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm font-medium text-sky-950">
            {t('billing.interestModal.alreadyRegisteredBanner')}
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            {t('billing.interestModal.alreadyRegisteredBody')}
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              {t('billing.interestModal.close')}
            </Button>
          </div>
        </div>
      ) : done ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-700">
            {t('billing.interestModal.successBody')}
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              {t('billing.interestModal.close')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/80 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm">
              <Mail className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm leading-relaxed text-slate-700">
              {featureKey === SCAN_RECEIPT_FEATURE_KEY
                ? t('billing.interestModal.bodyScanReceipt')
                : t('billing.interestModal.body')}
            </p>
          </div>
          <Input
            id="interest-email"
            type="email"
            label={t('billing.interestModal.emailLabel')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('billing.interestModal.emailPlaceholder')}
            autoComplete="email"
          />
          <div className="space-y-1.5">
            <label htmlFor="interest-msg" className="block text-sm font-semibold text-slate-700">
              {t('billing.interestModal.messageLabel')}
            </label>
            <textarea
              id="interest-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="block w-full resize-none rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder={t('billing.interestModal.messagePlaceholder')}
            />
          </div>
          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              {t('billing.interestModal.notifyMe')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
