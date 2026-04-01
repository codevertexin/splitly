import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { Group } from '../../../types';

type Phase = 'edit' | 'confirm-save' | 'confirm-delete';

interface ManageGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
  actionLoading: boolean;
  updateGroup: (
    groupId: string,
    name: string,
    description: string
  ) => Promise<{ success: boolean; error?: string }>;
  archiveGroup: (groupId: string) => Promise<{ success: boolean; error?: string }>;
  allBalancesZero: boolean;
  balancesLoading: boolean;
  balancesError: string | null;
  onUpdated: () => void;
  onArchived: () => void;
}

export function ManageGroupModal({
  isOpen,
  onClose,
  group,
  actionLoading,
  updateGroup,
  archiveGroup,
  allBalancesZero,
  balancesLoading,
  balancesError,
  onUpdated,
  onArchived,
}: ManageGroupModalProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('edit');
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(group.name);
    setDescription(group.description ?? '');
    setPhase('edit');
    setFormError(null);
    setActionError(null);
  }, [isOpen, group.id, group.name, group.description]);

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const unchanged =
    trimmedName === group.name.trim() && trimmedDesc === (group.description ?? '').trim();

  const handleClose = () => {
    if (actionLoading) return;
    onClose();
  };

  const goSaveConfirm = () => {
    setFormError(null);
    setActionError(null);
    if (trimmedName.length < 2) {
      setFormError(t('manageGroup.nameTooShort'));
      return;
    }
    if (unchanged) {
      setFormError(t('manageGroup.nothingChanged'));
      return;
    }
    setPhase('confirm-save');
  };

  const runUpdate = async () => {
    setActionError(null);
    const r = await updateGroup(group.id, name, description);
    if (r.success) {
      onUpdated();
      handleClose();
      return;
    }
    if (r.error === 'NAME_TOO_SHORT') {
      setActionError(t('manageGroup.nameTooShort'));
      setPhase('edit');
      return;
    }
    setActionError(r.error || t('manageGroup.updateFailed'));
  };

  const runArchive = async () => {
    setActionError(null);
    const r = await archiveGroup(group.id);
    if (r.success) {
      onArchived();
      handleClose();
      return;
    }
    setActionError(r.error || t('manageGroup.archiveFailed'));
  };

  const deleteDisabled =
    balancesLoading || !!balancesError || !allBalancesZero || actionLoading;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('manageGroup.title')} size="lg">
      {phase === 'edit' && (
        <div className="space-y-4">
          <Input
            id="manage-group-name"
            label={t('createGroup.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('createGroup.namePlaceholder')}
            disabled={actionLoading}
          />
          <Input
            id="manage-group-desc"
            label={t('createGroup.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('createGroup.descriptionPlaceholder')}
            disabled={actionLoading}
          />

          {formError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={handleClose}>
              {t('manageGroup.cancel')}
            </Button>
            <Button type="button" className="flex-1" onClick={goSaveConfirm} disabled={actionLoading}>
              {t('manageGroup.saveChanges')}
            </Button>
          </div>

          <div className="border-t border-slate-100 pt-4 mt-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {t('manageGroup.dangerZone')}
            </p>
            {balancesLoading && (
              <p className="text-xs text-slate-500">{t('manageGroup.deleteCheckingBalances')}</p>
            )}
            {balancesError && (
              <p className="text-xs text-red-600">{t('manageGroup.deleteBalanceCheckError')}</p>
            )}
            {!balancesLoading && !balancesError && !allBalancesZero && (
              <p className="text-xs text-slate-600">{t('manageGroup.deleteBlockedBalances')}</p>
            )}
            <Button
              type="button"
              variant="danger"
              className="w-full"
              disabled={deleteDisabled}
              onClick={() => {
                setActionError(null);
                setPhase('confirm-delete');
              }}
            >
              {t('manageGroup.deleteGroup')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'confirm-save' && (
        <div className="space-y-4">
          <p className="text-sm font-bold text-slate-900">{t('manageGroup.confirmSaveTitle')}</p>
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-sm space-y-2">
            <p>
              <span className="text-slate-500">{t('createGroup.nameLabel')}: </span>
              <span className="font-semibold text-slate-900">{trimmedName}</span>
            </p>
            <p>
              <span className="text-slate-500">{t('createGroup.descriptionLabel')}: </span>
              <span className="text-slate-900">{trimmedDesc || t('manageGroup.noDescription')}</span>
            </p>
          </div>
          <p className="text-xs text-slate-600">{t('manageGroup.confirmSaveBody')}</p>

          {actionError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setActionError(null);
                setPhase('edit');
              }}
              disabled={actionLoading}
            >
              {t('manageGroup.backToEdit')}
            </Button>
            <Button type="button" className="flex-1" loading={actionLoading} onClick={() => void runUpdate()}>
              {t('manageGroup.confirmSaveButton')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'confirm-delete' && (
        <div className="space-y-4">
          <p className="text-sm font-bold text-red-900">{t('manageGroup.confirmDeleteTitle')}</p>
          <p className="text-sm text-slate-700">{t('manageGroup.confirmDeleteBody')}</p>

          {actionError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {actionError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setActionError(null);
                setPhase('edit');
              }}
              disabled={actionLoading}
            >
              {t('manageGroup.backToEdit')}
            </Button>
            <Button type="button" variant="danger" className="flex-1" loading={actionLoading} onClick={() => void runArchive()}>
              {t('manageGroup.confirmDeleteButton')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
