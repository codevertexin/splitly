import React, { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ImagePlus, Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';

export type ExpenseReceiptSectionProps = {
  /** Hidden file input used for camera/gallery attachment only. */
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  receiptFile: File | null;
  /** Local object URL when the user picked a new file (takes precedence over stored). */
  receiptPreviewUrl: string | null;
  /** Signed URL for an already-saved receipt (edit mode). */
  storedReceiptPreviewUrl?: string | null;
  onAttachmentInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveReceipt: () => void;
  /** Opens billing interest flow for OCR; must not trigger the file input. */
  onOcrInterestClick: () => void;
  /** Disables add/replace/remove photo (e.g. while submitting). */
  disablePhoto?: boolean;
  /** Disables OCR / waitlist CTA (e.g. while submitting). */
  disableOcr?: boolean;
  /** When set, applies to both photo and OCR (overrides disablePhoto/disableOcr if those are omitted). */
  disabled?: boolean;
};

/**
 * Receipt UX: (A) attach photo now, (B) future OCR premium interest — shared by dashboard / event / group expense forms.
 */
export function ExpenseReceiptSection({
  attachmentInputRef,
  receiptFile,
  receiptPreviewUrl,
  storedReceiptPreviewUrl = null,
  onAttachmentInputChange,
  onRemoveReceipt,
  onOcrInterestClick,
  disablePhoto,
  disableOcr,
  disabled = false,
}: ExpenseReceiptSectionProps) {
  const { t } = useTranslation();
  const photoOff = disablePhoto ?? disabled;
  const ocrOff = disableOcr ?? disabled;

  const displayImageUrl = receiptPreviewUrl ?? storedReceiptPreviewUrl ?? null;
  const receiptLabel =
    receiptFile?.name?.trim() ||
    (displayImageUrl && !receiptPreviewUrl ? t('expenseForm.receiptSavedFileLabel') : '');

  const openAttachmentPicker = () => {
    attachmentInputRef.current?.click();
  };

  return (
    <div
      className="space-y-5 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 sm:p-5"
      data-testid="expense-receipt-section"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
        {t('expenseForm.receiptSectionHeading')}
      </p>

      {/* A — Available now: photo proof */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ImagePlus className="h-4 w-4 text-slate-600 shrink-0" aria-hidden />
          <span className="text-sm font-semibold text-slate-800">{t('expenseForm.receiptPhotoTitle')}</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">{t('expenseForm.receiptPhotoHint')}</p>

        <input
          ref={attachmentInputRef}
          type="file"
          className="sr-only"
          accept="image/*"
          capture="environment"
          onChange={onAttachmentInputChange}
          aria-hidden
        />

        {!displayImageUrl ? (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={openAttachmentPicker}
            disabled={photoOff}
          >
            <Camera className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            {t('expenseForm.receiptPhotoButton')}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
              <img
                src={displayImageUrl}
                alt=""
                className="max-h-48 w-full object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="truncate font-medium">{receiptLabel}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openAttachmentPicker} disabled={photoOff}>
                {t('expenseForm.receiptPhotoReplace')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={onRemoveReceipt}
                disabled={photoOff}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                {t('expenseForm.receiptPhotoRemove')}
              </Button>
            </div>
          </div>
        )}

        {receiptFile && (
          <p className="text-[11px] text-slate-400">{t('expenseForm.receiptPendingUploadNote')}</p>
        )}
      </div>

      <div className="border-t border-slate-200/80 pt-4 space-y-2">
        {/* B — Future: OCR */}
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600 shrink-0" aria-hidden />
          <span className="text-sm font-semibold text-slate-800">{t('expenseForm.receiptOcrTitle')}</span>
          <Badge variant="blue" size="sm">
            {t('expenseForm.receiptBadgePro')}
          </Badge>
          <Badge variant="yellow" size="sm">
            {t('expenseForm.receiptBadgeComingSoon')}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">{t('expenseForm.receiptOcrHint')}</p>
        <Button
          type="button"
          variant="outline"
          className="w-full border-violet-200 bg-white text-violet-900 hover:bg-violet-50 sm:w-auto"
          onClick={onOcrInterestClick}
          disabled={ocrOff}
        >
          <Sparkles className="mr-2 h-4 w-4 shrink-0" aria-hidden />
          {t('expenseForm.receiptOcrCta')}
        </Button>
      </div>
    </div>
  );
}
