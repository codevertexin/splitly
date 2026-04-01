import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Calendar,
  Users,
  Check,
  Plus,
  AlertCircle,
  UserPlus,
  Settings,
  Clock,
  History,
  Receipt,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { MemberAvatar } from '../../../components/MemberAvatar';
import { CreateExpenseForm } from '../../expenses/components/CreateExpenseForm';
import { EventDetailData } from '../../../hooks/useEvents';
import { supabase } from '../../../lib/supabase';
import { formatEventDateLabel } from '../datePresentation';
import { formatCurrencyCents, formatDateOnly, formatFixedInput } from '../../../lib/dateTime';
import { iconForExpenseTitle } from '../../expenses/expenseSuggestions';

interface EventDetailProps {
  event: EventDetailData;
  onBack: () => void;
  onAddParticipant: (userId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onUpdateEvent: (input: {
    title: string;
    description: string | null;
    participantUserIds: string[];
    startsAt: string;
    endsAt?: string | null;
    recalculateDraftExpenses?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onCloseEvent: () => Promise<{ success: boolean; error?: string }>;
  onFinalizeEvent: () => Promise<{ success: boolean; error?: string }>;
  actionLoading: boolean;
  participantError?: string | null;
  session: Session;
}

function toDateInputValue(iso: string) {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimeInputValue(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function buildDateTime(date: string, time?: string) {
  if (!date) return null;
  return new Date(`${date}T${time || '00:00'}:00`);
}

function startOfLocalDayMs(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

type TimingPhase = 'upcoming' | 'ongoing' | 'past';

function getEventTimingPhase(startsAt: string, endsAt: string | null | undefined): TimingPhase {
  const start = new Date(startsAt).getTime();
  const now = Date.now();
  if (Number.isNaN(start)) return 'ongoing';
  if (now < start) return 'upcoming';
  const end = endsAt ? new Date(endsAt).getTime() : null;
  if (end != null && !Number.isNaN(end) && now > end) return 'past';
  return 'ongoing';
}

function computeUserEventNetCents(
  expenses: EventDetailData['expenses'],
  userId: string,
): number {
  let paid = 0;
  let share = 0;
  for (const e of expenses) {
    if (e.paid_by_user_id === userId) paid += e.amount_cents;
    const sp = e.splits?.find((s) => s.user_id === userId);
    if (sp) share += sp.share_cents;
  }
  return paid - share;
}

function userInvolvedInConfirmedExpenses(expenses: EventDetailData['expenses'], userId: string): boolean {
  for (const e of expenses) {
    if (e.paid_by_user_id === userId) return true;
    if (e.splits?.some((s) => s.user_id === userId)) return true;
  }
  return false;
}

function groupExpensesByDay(
  items: EventDetailData['expenses'],
  locale: string,
  timelineToday: string,
  timelineYesterday: string,
): { label: string; items: EventDetailData['expenses'] }[] {
  const dayMap = new Map<number, EventDetailData['expenses']>();
  for (const exp of items) {
    const key = startOfLocalDayMs(new Date(exp.incurred_at));
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(exp);
  }
  const sortedKeys = [...dayMap.keys()].sort((a, b) => b - a);
  const todayStart = startOfLocalDayMs(new Date());
  const yesterdayStart = todayStart - 86400000;

  return sortedKeys.map((key) => {
    let label: string;
    if (key === todayStart) label = timelineToday;
    else if (key === yesterdayStart) label = timelineYesterday;
    else label = formatDateOnly(new Date(key), locale);

    const row = dayMap.get(key)!;
    row.sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
    return { label, items: row };
  });
}

export function EventDetail({ event, onBack, onAddParticipant, onRefresh, onUpdateEvent, onCloseEvent, onFinalizeEvent, actionLoading, participantError, session }: EventDetailProps) {
  const { t, i18n } = useTranslation();
  const draftSectionRef = useRef<HTMLDivElement | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showEditEvent, setShowEditEvent] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [showCloseBlocked, setShowCloseBlocked] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);
  const [editDescription, setEditDescription] = useState(event.description || '');
  const [editParticipantIds, setEditParticipantIds] = useState<string[]>(event.participants.map((p) => p.user_id));
  const [editStartDate, setEditStartDate] = useState(toDateInputValue(event.starts_at));
  const [editStartTime, setEditStartTime] = useState(toTimeInputValue(event.starts_at));
  const [editEndDate, setEditEndDate] = useState(event.ends_at ? toDateInputValue(event.ends_at) : '');
  const [editEndTime, setEditEndTime] = useState(event.ends_at ? toTimeInputValue(event.ends_at) : '');
  const [editAdvancedSchedule, setEditAdvancedSchedule] = useState(Boolean(event.ends_at));
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);
  const [showRemoveParticipantConfirm, setShowRemoveParticipantConfirm] = useState(false);
  const [confirmingExpense, setConfirmingExpense] = useState<EventDetailData['expenses'][number] | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmPayerId, setConfirmPayerId] = useState('');
  const [confirmParticipantIds, setConfirmParticipantIds] = useState<string[]>([]);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const daysRemaining = useMemo(() => {
    if (!event.ends_at) return null;
    const end = new Date(event.ends_at);
    if (Number.isNaN(end.getTime())) return null;
    const diffMs = end.getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [event.ends_at]);

  const participantIds = useMemo(() => new Set(event.participants.map((p) => p.user_id)), [event.participants]);
  const availableMembers = event.group.members.filter((m) => !participantIds.has(m.user_id));
  const expenseParticipants = useMemo(() => {
    if (event.participants.length > 0) {
      return event.participants.map((p) => ({
        user_id: p.user_id,
        full_name: p.profile?.full_name,
        avatar_url: p.profile?.avatar_url,
      }));
    }
    return event.group.members.map((m) => ({
      user_id: m.user_id,
      full_name: m.profile?.full_name,
      avatar_url: m.profile?.avatar_url,
    }));
  }, [event.participants, event.group.members]);
  const canEditEvent = event.created_by === session.user.id && event.status !== 'closed';

  useEffect(() => {
    setEditTitle(event.title);
    setEditDescription(event.description || '');
    setEditParticipantIds(event.participants.map((p) => p.user_id));
    setEditStartDate(toDateInputValue(event.starts_at));
    setEditStartTime(toTimeInputValue(event.starts_at));
    setEditEndDate(event.ends_at ? toDateInputValue(event.ends_at) : '');
    setEditEndTime(event.ends_at ? toTimeInputValue(event.ends_at) : '');
    setEditAdvancedSchedule(Boolean(event.ends_at));
    setEditError(null);
  }, [event]);

  const draftExpenses = event.expenses
    .filter((expense) => expense.status === 'draft')
    .sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
  const confirmedExpenses = event.expenses
    .filter((expense) => expense.status === 'confirmed')
    .sort((a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime());
  const hasAnyExpenses = event.expenses.length > 0;

  const timingPhase = useMemo(
    () => getEventTimingPhase(event.starts_at, event.ends_at),
    [event.starts_at, event.ends_at],
  );

  const yourNetInEventCents = useMemo(
    () => computeUserEventNetCents(confirmedExpenses, session.user.id),
    [confirmedExpenses, session.user.id],
  );

  const userInvolvedInConfirmed = useMemo(
    () => userInvolvedInConfirmedExpenses(confirmedExpenses, session.user.id),
    [confirmedExpenses, session.user.id],
  );

  const totalConfirmedCents = useMemo(
    () => confirmedExpenses.reduce((s, e) => s + e.amount_cents, 0),
    [confirmedExpenses],
  );

  const totalDraftCents = useMemo(() => draftExpenses.reduce((s, e) => s + e.amount_cents, 0), [draftExpenses]);

  const staleDraftSplitCount = useMemo(() => {
    const ids = new Set<string>();
    for (const e of draftExpenses) {
      for (const s of e.splits || []) {
        if (!participantIds.has(s.user_id)) ids.add(s.user_id);
      }
    }
    return ids.size;
  }, [draftExpenses, participantIds]);

  const draftTimelineGroups = useMemo(
    () =>
      groupExpensesByDay(draftExpenses, i18n.language, t('eventDetail.timelineToday'), t('eventDetail.timelineYesterday')),
    [draftExpenses, i18n.language, t],
  );

  const confirmedTimelineGroups = useMemo(
    () =>
      groupExpensesByDay(
        confirmedExpenses,
        i18n.language,
        t('eventDetail.timelineToday'),
        t('eventDetail.timelineYesterday'),
      ),
    [confirmedExpenses, i18n.language, t],
  );

  const handleSaveEvent = async () => {
    setEditError(null);
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setEditError(t('eventDetail.titleRequired'));
      return;
    }
    if (editParticipantIds.length === 0) {
      setEditError(t('eventDetail.participantsRequired'));
      return;
    }
    const start = buildDateTime(editStartDate, editAdvancedSchedule ? editStartTime : undefined);
    if (!start || Number.isNaN(start.getTime())) {
      setEditError(t('events.invalidStartDate'));
      return;
    }
    let endIso: string | null = null;
    if (editEndDate) {
      const end = buildDateTime(editEndDate, editAdvancedSchedule ? editEndTime : undefined);
      if (!end || Number.isNaN(end.getTime())) {
        setEditError(t('events.invalidEndDate'));
        return;
      }
      if (end.getTime() < start.getTime()) {
        setEditError(t('events.endBeforeStart'));
        return;
      }
      endIso = end.toISOString();
    }
    const result = await onUpdateEvent({
      title: trimmedTitle,
      description: editDescription.trim() ? editDescription.trim() : null,
      participantUserIds: editParticipantIds,
      startsAt: start.toISOString(),
      endsAt: endIso,
    });
    if (result.success) {
      setShowEditEvent(false);
    } else {
      setEditError(result.error || t('eventDetail.updateFailed'));
    }
  };

  const handleConfirmCloseEvent = async () => {
    setEditError(null);
    const result = await onCloseEvent();
    if (result.success) {
      setShowCloseConfirm(false);
    } else {
      setEditError(result.error || t('eventDetail.closeFailed'));
    }
  };

  const handleCloseEventClick = () => {
    setEditError(null);
    if (draftExpenses.length > 0) {
      setShowCloseBlocked(true);
      return;
    }
    setShowCloseConfirm(true);
  };

  const handleConfirmFinalizeEvent = async () => {
    setEditError(null);
    const result = await onFinalizeEvent();
    if (result.success) {
      setShowFinalizeConfirm(false);
    } else {
      setEditError(result.error || t('eventDetail.finalizeFailed'));
    }
  };

  const scrollToPlannedExpenses = () => {
    draftSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const eventStatusBadgeVariant = event.status === 'open' ? 'green' : event.status === 'draft' ? 'yellow' : 'slate';

  const participantStatusVariant = (status: string) => {
    if (status === 'going') return 'green' as const;
    if (status === 'pending') return 'yellow' as const;
    return 'slate' as const;
  };

  const openConfirmExpenseModal = (expense: EventDetailData['expenses'][number]) => {
    setConfirmingExpense(expense);
    setConfirmAmount(formatFixedInput(expense.amount_cents / 100));
    setConfirmPayerId(expense.paid_by_user_id);
    setConfirmParticipantIds((expense.splits || []).map((s) => s.user_id));
    setEditError(null);
  };

  const handleConfirmExpense = async () => {
    if (!confirmingExpense) return;
    const amountCents = Math.round(parseFloat(confirmAmount.replace(',', '.')) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setEditError(t('expenseForm.invalidAmount'));
      return;
    }
    if (!confirmPayerId) {
      setEditError(t('eventDetail.invalidPayer'));
      return;
    }
    if (confirmParticipantIds.length === 0) {
      setEditError(t('groupExpense.noParticipants'));
      return;
    }

    setConfirmLoading(true);
    setEditError(null);
    const { data, error } = await supabase.functions.invoke('update-expense', {
      body: {
        expense_id: confirmingExpense.id,
        title: confirmingExpense.title,
        description: confirmingExpense.description,
        amount_cents: amountCents,
        split_method: 'equal',
        participant_ids: confirmParticipantIds,
        status: 'confirmed',
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    setConfirmLoading(false);
    if (error || (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error)) {
      const msg = error?.message || String((data as { error?: unknown }).error || 'Failed to confirm expense');
      setEditError(msg);
      return;
    }
    setConfirmingExpense(null);
    await onRefresh();
  };

  const handleRemoveParticipantChoice = async (recalculateDraftExpenses: boolean) => {
    if (!removingParticipantId) return;
    const nextIds = event.participants
      .map((p) => p.user_id)
      .filter((id) => id !== removingParticipantId);

    const result = await onUpdateEvent({
      title: event.title,
      description: event.description,
      participantUserIds: nextIds,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      recalculateDraftExpenses,
    });
    if (!result.success) {
      setEditError(result.error || t('eventDetail.updateFailed'));
      return;
    }
    setShowRemoveParticipantConfirm(false);
    setRemovingParticipantId(null);
  };

  const eventDateLabel = formatEventDateLabel({
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    locale: i18n.language,
  });

  const formatMoney = (cents: number) => formatCurrencyCents(cents, { locale: i18n.language });

  const eventStatusLabel =
    event.status === 'draft'
      ? t('eventDetail.statusDraft')
      : event.status === 'open'
        ? t('eventDetail.statusOpen')
        : t('eventDetail.statusClosed');

  const participantStatusLabel = (status: string) => {
    if (status === 'going') return t('eventDetail.participantStatusGoing');
    if (status === 'pending') return t('eventDetail.participantStatusPending');
    return t('eventDetail.participantStatusNotGoing');
  };

  const toReceiveEvent = Math.max(0, yourNetInEventCents);
  const toPayEvent = Math.max(0, -yourNetInEventCents);

  const renderExpenseRow = (expense: EventDetailData['expenses'][number], variant: 'draft' | 'confirmed') => {
    const icon = iconForExpenseTitle(expense.title);
    const splitCount = expense.splits?.length ?? 0;
    const wrap =
      variant === 'draft'
        ? 'border-amber-100/90 bg-white/95 shadow-sm shadow-amber-900/5'
        : 'border-slate-100/90 bg-white shadow-sm';
    return (
      <div key={expense.id} className={`flex flex-wrap items-start gap-3 rounded-2xl border p-4 ${wrap}`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-bold text-slate-900">{expense.title}</p>
          <p className="text-xs font-medium text-slate-600">{formatDateOnly(expense.incurred_at, i18n.language)}</p>
          <p className="text-xs text-slate-600">
            {t('expenses.paidBy', { name: expense.profiles?.full_name || t('eventDetail.unknownUser') })}
          </p>
          <p className="text-xs text-slate-500">
            {splitCount > 0 ? t('eventDetail.expensePeople', { count: splitCount }) : t('eventDetail.participantsEmpty')}
          </p>
          <p className="pt-1">
            <Badge variant={variant === 'draft' ? 'yellow' : 'green'} size="sm">
              {variant === 'draft' ? t('eventDetail.plannedExpenseBadge') : t('eventDetail.finalExpenseBadge')}
            </Badge>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
          <p className="font-bold tabular-nums text-slate-900">{formatMoney(expense.amount_cents)}</p>
          {variant === 'draft' && (
            <Button type="button" variant="outline" size="sm" className="border-amber-200 text-amber-950 hover:bg-amber-50" onClick={() => openConfirmExpenseModal(expense)}>
              {t('eventDetail.confirmExpenseCta')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const timingChip =
    timingPhase === 'upcoming' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50/90 px-3 py-1 text-xs font-semibold text-blue-900">
        <Calendar className="h-3.5 w-3.5 shrink-0" />
        {t('eventDetail.timingUpcoming')}
      </span>
    ) : timingPhase === 'past' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
        <History className="h-3.5 w-3.5 shrink-0" />
        {t('eventDetail.timingPast')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/90 px-3 py-1 text-xs font-semibold text-emerald-900">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {t('eventDetail.timingOngoing')}
      </span>
    );

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6 pb-10"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-xl border border-slate-100 bg-white p-2 text-slate-500 transition-all hover:bg-slate-50"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-2xl font-bold text-slate-900">{event.title}</h1>
              <Badge variant={eventStatusBadgeVariant}>{eventStatusLabel}</Badge>
            </div>
            <p className="text-sm text-slate-600">{eventDateLabel}</p>
            <p className="text-sm text-slate-500">
              {t('eventDetail.partOf')}{' '}
              <span className="font-semibold text-slate-800">{event.group.name}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">{timingChip}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="font-semibold"
            onClick={() => setShowAddExpense(true)}
            disabled={event.status === 'closed'}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('eventDetail.quickAddExpense')}
          </Button>
          {event.status === 'draft' && hasAnyExpenses && (
            <div className="flex flex-col items-end gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="font-semibold"
                onClick={() => setShowFinalizeConfirm(true)}
                disabled={event.status !== 'draft'}
              >
                {t('eventDetail.finalizeEvent')}
              </Button>
              {confirmedExpenses.length > 0 && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                  {t('eventDetail.readyToFinalizeHint')}
                </span>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-semibold"
            onClick={() => setShowAddParticipant(true)}
            disabled={event.status === 'closed'}
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            {t('eventDetail.quickInvite')}
          </Button>
          {event.status === 'open' && hasAnyExpenses && (
            <Button
              type="button"
              variant="success"
              size="sm"
              className="font-semibold"
              onClick={handleCloseEventClick}
              disabled={!canEditEvent}
            >
              <Check className="mr-1.5 h-4 w-4" />
              {t('eventDetail.closeEvent')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl border border-slate-200/90 px-2.5"
            onClick={() => canEditEvent && setShowEditEvent(true)}
            disabled={!canEditEvent}
            title={t('eventDetail.editEvent')}
            aria-label={t('eventDetail.editEvent')}
          >
            <Settings className="h-4 w-4 text-slate-600" />
          </Button>
        </div>
      </div>

      {event.description?.trim() ? (
        <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('eventDetail.eventHeaderLabel')}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{event.description.trim()}</p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
            {event.participants.length > 0 && (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Users className="h-4 w-4 shrink-0 text-slate-400" />
                {t('eventDetail.participantCount', { count: event.participants.length })}
              </span>
            )}
            {daysRemaining !== null && timingPhase === 'upcoming' && (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <Calendar className="h-4 w-4 shrink-0" />
                {t('eventDetail.daysRemainingShort', { count: daysRemaining })}
              </span>
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('eventDetail.financialSummary')}</p>
        <div className="mt-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-500">{t('eventDetail.totalSpentConfirmed')}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-3xl">{formatMoney(totalConfirmedCents)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">{t('eventDetail.plannedDraft')}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-900/95">{formatMoney(totalDraftCents)}</p>
          </div>
          <div className="border-t border-slate-100 pt-5">
            <p className="text-xs font-semibold text-slate-500">{t('eventDetail.yourPositionConfirmed')}</p>
            {confirmedExpenses.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">{t('eventDetail.positionNoConfirmed')}</p>
            ) : !userInvolvedInConfirmed ? (
              <p className="mt-2 text-sm text-slate-700">{t('eventDetail.positionNotInExpenses')}</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-700">
                  {toReceiveEvent > 0
                    ? t('eventDetail.positionSummaryOwed', { amount: formatMoney(toReceiveEvent) })
                    : toPayEvent > 0
                      ? t('eventDetail.positionSummaryOwe', { amount: formatMoney(toPayEvent) })
                      : t('eventDetail.positionSummaryEven')}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-red-100/90 bg-red-50/70 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-800/90">{t('eventDetail.youOweInEvent')}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-red-800 sm:text-xl">{formatMoney(toPayEvent)}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100/90 bg-emerald-50/70 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/90">{t('eventDetail.youAreOwedInEvent')}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-emerald-800 sm:text-xl">{formatMoney(toReceiveEvent)}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {staleDraftSplitCount > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-amber-950">{t('eventDetail.draftStaleHint', { count: staleDraftSplitCount })}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100/80" onClick={scrollToPlannedExpenses}>
            {t('eventDetail.reviewDraftExpenses')}
          </Button>
        </div>
      )}

      {event.status === 'draft' && (
        <div className="rounded-2xl border-2 border-amber-300/80 bg-amber-100/50 p-4 shadow-sm ring-1 ring-amber-200/60 sm:p-5">
          <p className="text-base font-bold text-amber-950">{t('eventDetail.draftBannerTitle')}</p>
          <p className="mt-2 text-sm leading-relaxed text-amber-950/90">{t('eventDetail.draftBannerBody')}</p>
          <Link to="/help#draft" className="mt-3 inline-block text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">
            {t('eventDetail.learnPlanning')}
          </Link>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-bold text-slate-900">{t('eventDetail.participantsSection')}</h2>
        </div>
        {participantError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {participantError}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {event.participants.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 py-10 text-center sm:col-span-2">
              <Users className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">{t('eventDetail.participantsEmpty')}</p>
              <p className="mt-1 text-xs text-slate-500">{t('eventDetail.participantsEmptyHint')}</p>
              {event.status !== 'closed' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => setShowAddParticipant(true)}
                >
                  {t('eventDetail.invitePeopleCta')}
                </Button>
              )}
            </div>
          ) : (
            event.participants.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100/90 bg-white p-4 shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <MemberAvatar
                    userId={participant.user_id}
                    fullName={participant.profile?.full_name}
                    avatarUrl={participant.profile?.avatar_url}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{participant.profile?.full_name || t('eventDetail.unknownUser')}</p>
                    <Badge variant={participantStatusVariant(participant.status)} size="sm">
                      {participantStatusLabel(participant.status)}
                    </Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={participant.user_id === event.created_by || event.status === 'closed'}
                  onClick={() => {
                    if (participant.user_id === event.created_by) return;
                    const hasDraftWithParticipant = draftExpenses.some((expense) =>
                      (expense.splits || []).some((s) => s.user_id === participant.user_id),
                    );
                    setRemovingParticipantId(participant.user_id);
                    if (hasDraftWithParticipant) {
                      setShowRemoveParticipantConfirm(true);
                    } else {
                      void handleRemoveParticipantChoice(false);
                    }
                  }}
                >
                  {t('eventDetail.removeParticipant')}
                </Button>
              </div>
            ))
          )}
        </div>

        <AnimatePresence>
          {showAddParticipant && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
            >
              <h3 className="mb-3 font-bold text-slate-900">{t('eventDetail.inviteParticipant')}</h3>
              {availableMembers.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">{t('eventDetail.allMembersAlreadyInEvent')}</p>
              ) : (
                <div className="space-y-2">
                  {availableMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <MemberAvatar
                          userId={member.user_id}
                          fullName={member.profile?.full_name}
                          avatarUrl={member.profile?.avatar_url}
                          size="sm"
                        />
                        <span className="truncate text-sm font-medium text-slate-700">{member.profile?.full_name || t('eventDetail.unknownUser')}</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={async () => {
                          await onAddParticipant(member.user_id);
                          setShowAddParticipant(false);
                        }}
                        loading={actionLoading}
                      >
                        {t('eventDetail.addParticipant')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={() => setShowAddParticipant(false)}>
                {t('common.cancel')}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section id="event-planned-anchor" ref={draftSectionRef} className="scroll-mt-24 space-y-6">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-900">{t('eventDetail.expensesTimelineHeading')}</h2>
          <p className="text-sm text-slate-500">{t('eventDetail.expensesTimelineSub')}</p>
        </div>

        {!showAddExpense && event.status !== 'closed' && event.expenses.length > 0 && (
          <Button type="button" variant="outline" className="w-full border-2 border-dashed border-slate-200 py-3 font-semibold" onClick={() => setShowAddExpense(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('eventDetail.addExpenseToEvent')}
          </Button>
        )}

        {event.expenses.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200/90 bg-slate-50/30 py-14 text-center">
            <Receipt className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">{t('eventDetail.noEventExpenses')}</p>
            <Link to="/help" className="mt-2 inline-block text-sm text-slate-600 underline underline-offset-2 hover:text-slate-800">
              {t('eventDetail.helpGettingStarted')}
            </Link>
            {!showAddExpense && event.status !== 'closed' && (
              <div className="mt-5 flex justify-center">
                <Button
                  type="button"
                  size="lg"
                  className="px-8 py-3 text-base font-semibold"
                  onClick={() => setShowAddExpense(true)}
                >
                  <Plus className="mr-2 h-5 w-5" />
                  {t('eventDetail.addFirstExpense')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-10">
            <div className="rounded-3xl border border-amber-100/80 bg-amber-50/25 p-4 sm:p-5">
              <div className="mb-4 border-b border-amber-200/60 pb-3">
                <h3 className="text-lg font-extrabold tracking-tight text-amber-950">{t('eventDetail.plannedExpensesTitle')}</h3>
                <p className="mt-1.5 text-sm text-amber-900/85">{t('eventDetail.plannedExpensesSubtitle')}</p>
              </div>
              {draftExpenses.length === 0 ? (
                <p className="text-sm text-amber-900/70">{t('expenses.noDraftExpenses')}</p>
              ) : (
                <div className="space-y-6">
                  {draftTimelineGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-900/70">{group.label}</p>
                      <div className="space-y-2">{group.items.map((expense) => renderExpenseRow(expense, 'draft'))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200/90 bg-slate-50/40 p-4 sm:p-5">
              <div className="mb-4 border-b border-slate-200/80 pb-3">
                <h3 className="text-lg font-extrabold tracking-tight text-slate-900">{t('eventDetail.finalExpensesTitle')}</h3>
                <p className="mt-1.5 text-sm text-slate-600">{t('eventDetail.finalExpensesSubtitle')}</p>
              </div>
              {confirmedExpenses.length === 0 ? (
                <p className="text-sm text-slate-500">{t('expenses.noConfirmedExpenses')}</p>
              ) : (
                <div className="space-y-6">
                  {confirmedTimelineGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
                      <div className="space-y-2">{group.items.map((expense) => renderExpenseRow(expense, 'confirmed'))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </motion.div>

      <Modal
        isOpen={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        title={t('groupExpense.modalTitle')}
        size="lg"
      >
        <CreateExpenseForm
          groupId={event.group_id}
          eventId={event.id}
          initialStatus="draft"
          participants={expenseParticipants}
          session={session}
          onSuccess={async () => {
            setShowAddExpense(false);
            await onRefresh();
          }}
          onCancel={() => setShowAddExpense(false)}
        />
      </Modal>

      <Modal
        isOpen={showEditEvent}
        onClose={() => setShowEditEvent(false)}
        title={t('eventDetail.editEvent')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('events.formTitleLabel')}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder={t('events.formTitlePlaceholder')}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700">{t('events.formDescriptionLabel')}</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder={t('events.formDescriptionPlaceholder')}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm min-h-[96px] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <label className="block text-sm font-semibold text-slate-700">{t('events.formStartDateLabel')}</label>
              <button
                type="button"
                onClick={() => setEditAdvancedSchedule((prev) => !prev)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                {editAdvancedSchedule ? t('events.simpleSchedule') : t('events.advancedSchedule')}
              </button>
            </div>
            <div className={`grid gap-3 ${editAdvancedSchedule ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              <input
                type="date"
                required
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {editAdvancedSchedule && (
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              )}
            </div>
            <label className="block text-sm font-semibold text-slate-700">{t('events.formEndDateLabel')}</label>
            <div className={`grid gap-3 ${editAdvancedSchedule ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              <input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {editAdvancedSchedule && (
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="block w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.participantsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {event.group.members.map((member) => (
                <label
                  key={member.user_id}
                  className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer text-sm max-w-full"
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    checked={editParticipantIds.includes(member.user_id)}
                    onChange={() =>
                      setEditParticipantIds((prev) =>
                        prev.includes(member.user_id)
                          ? prev.filter((id) => id !== member.user_id)
                          : [...prev, member.user_id]
                      )
                    }
                  />
                  <MemberAvatar
                    userId={member.user_id}
                    fullName={member.profile?.full_name}
                    avatarUrl={member.profile?.avatar_url}
                    size="sm"
                  />
                  <span className="font-medium text-slate-800 truncate">
                    {member.profile?.full_name || t('eventDetail.unknownUser')}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {editError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4" />
              {editError}
            </div>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowEditEvent(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" className="flex-[2]" onClick={handleSaveEvent} loading={actionLoading}>
              {t('expenseForm.saveChanges')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showRemoveParticipantConfirm}
        onClose={() => {
          setShowRemoveParticipantConfirm(false);
          setRemovingParticipantId(null);
        }}
        title={t('eventDetail.removeParticipantDraftTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('eventDetail.removeParticipantDraftBody')}</p>
          <div className="grid grid-cols-1 gap-2">
            <Button
              type="button"
              onClick={() => void handleRemoveParticipantChoice(true)}
              loading={actionLoading}
            >
              {t('eventDetail.removeParticipantUpdateDraft')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRemoveParticipantChoice(false)}
              loading={actionLoading}
            >
              {t('eventDetail.removeParticipantReviewManual')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowRemoveParticipantConfirm(false);
                setRemovingParticipantId(null);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(confirmingExpense)}
        onClose={() => setConfirmingExpense(null)}
        title={t('expenses.confirmExpenseTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('expenseForm.amountLabel')}
            type="number"
            step="0.01"
            value={confirmAmount}
            onChange={(e) => setConfirmAmount(e.target.value)}
            placeholder="0.00"
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.paidByLabel')}</label>
            <select
              value={confirmPayerId}
              onChange={(e) => setConfirmPayerId(e.target.value)}
              className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm"
            >
              {event.participants.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.profile?.full_name || t('eventDetail.unknownUser')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.participantsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {event.participants.map((p) => (
                <label
                  key={p.user_id}
                  className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer text-sm max-w-full"
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    checked={confirmParticipantIds.includes(p.user_id)}
                    onChange={() =>
                      setConfirmParticipantIds((prev) =>
                        prev.includes(p.user_id) ? prev.filter((id) => id !== p.user_id) : [...prev, p.user_id],
                      )
                    }
                  />
                  <span className="font-medium text-slate-800 truncate">{p.profile?.full_name || t('eventDetail.unknownUser')}</span>
                </label>
              ))}
            </div>
          </div>
          {editError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4" />
              {editError}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirmingExpense(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" className="flex-[2]" onClick={() => void handleConfirmExpense()} loading={confirmLoading}>
              {t('expenses.confirmExpenseAction')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCloseBlocked}
        onClose={() => setShowCloseBlocked(false)}
        title={t('eventDetail.closeBlockedTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-600">{t('eventDetail.closeBlockedBody')}</p>
          <Button type="button" className="w-full" onClick={() => setShowCloseBlocked(false)}>
            {t('eventDetail.closeBlockedOk')}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        title={t('eventDetail.closeConfirmTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('eventDetail.closeConfirmBody')}</p>
          {editError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4" />
              {editError}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowCloseConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="success" className="flex-[2]" onClick={handleConfirmCloseEvent} loading={actionLoading}>
              {t('eventDetail.closeConfirmAction')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showFinalizeConfirm}
        onClose={() => setShowFinalizeConfirm(false)}
        title={t('eventDetail.finalizeConfirmTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('eventDetail.finalizeConfirmBody')}</p>
          {editError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4" />
              {editError}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowFinalizeConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" className="flex-[2]" onClick={handleConfirmFinalizeEvent} loading={actionLoading}>
              {t('eventDetail.finalizeEvent')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
