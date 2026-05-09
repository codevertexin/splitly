import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type { ProfileSaveFields, ProfileSaveResult } from '../hooks/useUserProfile';
import type { Profile } from '../dbAliases';

interface ProfileNameGateProps {
  profile: Profile | null;
  loading: boolean;
  saving: boolean;
  saveProfileFields: (fields: ProfileSaveFields) => Promise<ProfileSaveResult>;
}

export function ProfileNameGate({ profile, loading, saving, saveProfileFields }: ProfileNameGateProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Gate apenas para utilizadores antigos que já têm username,
  // mas ainda não têm full_name válido.
  const needsName = Boolean(
    profile &&
      (!profile.full_name?.trim() || profile.full_name.trim().length < 2) &&
      profile.username?.trim() &&
      profile.username.trim().length >= 3
  );

  const open = !loading && needsName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t('profileNameGate.nameTooShort'));
      return;
    }

    if (!profile) return;

    if (!profile.username?.trim()) {
      setError(t('profileNameGate.saveFailed'));
      return;
    }

    const result = await saveProfileFields({
      username: profile.username.trim(),
      full_name: trimmed,
      default_currency: profile.default_currency || 'EUR',
      timezone: profile.timezone || 'UTC',
      avatar_url: profile.avatar_url,
    });

    if (!result.success) {
      setError('error' in result ? result.error : t('profileNameGate.saveFailed'));
      return;
    }
  };

  if (!open) return null;

  return (
    <Modal isOpen title={t('profileNameGate.title')} onClose={() => {}} closable={false} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">{t('profileNameGate.body')}</p>
        <Input
          label={t('profileNameGate.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('profileNameGate.namePlaceholder')}
          autoComplete="name"
          autoFocus
          required
          minLength={2}
        />
        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving} loading={saving}>
          {t('profileNameGate.continue')}
        </Button>
      </form>
    </Modal>
  );
}