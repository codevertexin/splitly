import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';

interface CreateGroupFormProps {
  onSubmit: (
    name: string,
    description: string,
    initialCycleTitle?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
  loading: boolean;
}

export function CreateGroupForm({ onSubmit, onCancel, loading }: CreateGroupFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [initialCycleTitle, setInitialCycleTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await onSubmit(name, description, initialCycleTitle.trim() || undefined);
    if (result.success) {
      setName('');
      setDescription('');
      setInitialCycleTitle('');
    } else {
      setError(result.error || t('createGroup.createFailed'));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="space-y-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t('createGroup.nameLabel')}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('createGroup.namePlaceholder')}
          />
          <Input
            label={t('createGroup.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('createGroup.descriptionPlaceholder')}
          />
        </div>
        <Input
          label={t('createGroup.initialCycleTitleLabel')}
          value={initialCycleTitle}
          onChange={(e) => setInitialCycleTitle(e.target.value)}
          placeholder={t('createGroup.initialCycleTitlePlaceholder')}
          helperText={t('createGroup.initialCycleTitleHint')}
        />

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="flex-1"
          >
            {t('createGroup.cancel')}
          </Button>
          <Button
            type="submit"
            loading={loading}
            className="flex-[2]"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('createGroup.submit')}
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
