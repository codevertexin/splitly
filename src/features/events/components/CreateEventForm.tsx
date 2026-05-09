import React, { useState } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import type { Group } from '../../../dbAliases';

interface CreateEventFormProps {
  groups: Group[];
  onSubmit: (
    title: string,
    description: string,
    groupId: string,
    status: 'open' | 'draft',
    startsAt: string,
    endsAt?: string | null
  ) => Promise<{ success: boolean; error?: string; details?: string }>;
  onCancel: () => void;
  loading: boolean;
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function combineDateTime(date: string, time?: string) {
  if (!date) return null;
  if (!time) return new Date(`${date}T00:00:00`);
  return new Date(`${date}T${time}:00`);
}

export function CreateEventForm({ groups, onSubmit, onCancel, loading }: CreateEventFormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState(groups[0]?.id || '');
  const [status, setStatus] = useState<'open' | 'draft'>('open');
  const [startDate, setStartDate] = useState(toLocalDateInputValue(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [advancedSchedule, setAdvancedSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorDetails(null);
    const start = combineDateTime(startDate, advancedSchedule ? startTime : undefined);
    if (!start || Number.isNaN(start.getTime())) {
      setError(t('events.invalidStartDate'));
      return;
    }

    let endIso: string | null = null;
    if (endDate) {
      const end = combineDateTime(endDate, advancedSchedule ? endTime : undefined);
      if (!end || Number.isNaN(end.getTime())) {
        setError(t('events.invalidEndDate'));
        return;
      }
      if (end.getTime() < start.getTime()) {
        setError(t('events.endBeforeStart'));
        return;
      }
      endIso = end.toISOString();
    }

    const result = await onSubmit(title, description, groupId, status, start.toISOString(), endIso);
    if (result.success) {
      setTitle('');
      setDescription('');
      setStatus('open');
      setStartDate(toLocalDateInputValue(new Date()));
      setStartTime('');
      setEndDate('');
      setEndTime('');
      setAdvancedSchedule(false);
    } else {
      setError(result.error || t('events.createFailed'));
      setErrorDetails(result.details ?? null);
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
            label={t('events.formTitleLabel')}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('events.formTitlePlaceholder')}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700">
              {t('events.formGroupLabel')}
            </label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              required
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
        </div>
        
        <Input
          label={t('events.formDescriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('events.formDescriptionPlaceholder')}
        />

        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <label className="block text-sm font-semibold text-slate-700">
              {t('events.formStartDateLabel')}
            </label>
            <button
              type="button"
              onClick={() => setAdvancedSchedule((prev) => !prev)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              {advancedSchedule ? t('events.simpleSchedule') : t('events.advancedSchedule')}
            </button>
          </div>
          <div className={`grid gap-3 ${advancedSchedule ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {advancedSchedule && (
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            {t('events.formEndDateLabel')}
          </label>
          <div className={`grid gap-3 ${advancedSchedule ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {advancedSchedule && (
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-slate-700">
            {t('events.formStatusLabel')}
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'open' | 'draft')}
            className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          >
            <option value="open">{t('events.open')}</option>
            <option value="draft">{t('events.draft')}</option>
          </select>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold">{error}</p>
              {errorDetails && (
                <p className="mt-1 text-red-700 whitespace-pre-wrap break-words">{errorDetails}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="flex-1"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            loading={loading}
            className="flex-[2]"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('events.createNewEvent')}
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
