import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Search, Filter, Calendar, Users, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session } from '@supabase/supabase-js';
import { useSearchParams } from 'react-router-dom';
import { ExpenseListRow, useExpenses } from '../../hooks/useExpenses';
import { useGroups } from '../../hooks/useGroups';
import { supabase } from '../../lib/supabase';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { classifyExpenseTitle } from './expenseSuggestions';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { formatCentsAsDecimal, formatCurrencyCents, formatDateOnly, formatDecimal, formatFixedInput } from '../../lib/dateTime';
import { isAccountingEligibleExpenseRow } from '../../lib/accountingExpenses';
import {
  buildEqualSharesCents,
  canApplySettlementAwareEqualSplit,
  computeDebtsToCurrentUser,
  suggestSettlementAwareEqualSplit,
} from '../../lib/settlementSplit';

interface ExpensesPageProps {
  session: Session;
}

export function ExpensesPage({ session }: ExpensesPageProps) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const { expenses, loading: expensesLoading, error: expensesError, actionLoading, updateExpense } = useExpenses(session);
  const { groups, loading: groupsLoading } = useGroups(session);

  const locale = useMemo(() => {
    if (i18n.language === 'pt-PT') return 'pt-PT';
    if (i18n.language === 'pt-BR') return 'pt-BR';
    if (i18n.language === 'es') return 'es-ES';
    return 'en-IE';
  }, [i18n.language]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'draft' | 'confirmed'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListRow | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editParticipantIds, setEditParticipantIds] = useState<string[]>([]);
  const [editSplitMethod, setEditSplitMethod] = useState<'equal' | 'manual' | 'percentage'>('equal');
  const [editSettleAwareEnabled, setEditSettleAwareEnabled] = useState(false);
  const [editDebtsToCurrentUser, setEditDebtsToCurrentUser] = useState<Record<string, number>>({});
  const [editManualShares, setEditManualShares] = useState<Record<string, string>>({});
  const [editPercentageShares, setEditPercentageShares] = useState<Record<string, string>>({});
  const [editMembers, setEditMembers] = useState<Array<{ user_id: string; full_name: string | null }>>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const recentQuickFilterDays = useMemo(() => {
    const recentRaw = searchParams.get('recent');
    if (!recentRaw) return null;
    const prefRaw = localStorage.getItem('splitly_recent_activity_days');
    const prefDays = prefRaw === '7' || prefRaw === '30' || prefRaw === '90' ? Number(prefRaw) : 7;
    if (recentRaw === '7' || recentRaw === '30' || recentRaw === '90') return Number(recentRaw);
    if (recentRaw === '1') return prefDays;
    return null;
  }, [searchParams]);

  const formatDateForInput = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  useEffect(() => {
    if (!recentQuickFilterDays) return;
    // Quick filter uses last N complete days (excludes today, which is usually partial).
    const today = new Date();
    const end = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - (recentQuickFilterDays - 1));
    const fromStr = formatDateForInput(start);
    const toStr = formatDateForInput(end);
    setStartDate(fromStr);
    setEndDate(toStr);
    setShowFilters(true);
  }, [recentQuickFilterDays, formatDateForInput]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      const matchesSearch = 
        expense.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (expense.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (expense.amount_cents / 100).toString().includes(searchQuery);

      const matchesGroup = selectedGroupId === 'all' || expense.group_id === selectedGroupId;
      const matchesStatus = selectedStatus === 'all' || expense.status === selectedStatus;

      const expenseDate = new Date(expense.incurred_at);
      const matchesStartDate =
        !startDate ||
        expenseDate >= new Date(`${startDate}T00:00:00`);
      const matchesEndDate =
        !endDate ||
        expenseDate <= new Date(`${endDate}T23:59:59.999`);

      return matchesSearch && matchesGroup && matchesStatus && matchesStartDate && matchesEndDate;
    });
  }, [expenses, searchQuery, selectedGroupId, selectedStatus, startDate, endDate]);

  const formatCurrency = useCallback(
    (amountCents: number, currency: string) => formatCurrencyCents(amountCents, { locale, currency }),
    [locale]
  );

  const canEditExpense = useCallback(
    (expense: ExpenseListRow) =>
      expense.created_by === session.user.id && (!expense.event || expense.event.status !== 'closed'),
    [session.user.id]
  );
  const editAmountCentsPreview = Math.round((parseFloat(editAmount.replace(',', '.')) || 0) * 100);
  const editEqualSharesPreview = useMemo(
    () => buildEqualSharesCents(editParticipantIds, editAmountCentsPreview),
    [editParticipantIds, editAmountCentsPreview],
  );
  const editSettleAwareAvailable = useMemo(
    () => canApplySettlementAwareEqualSplit({
      splitMethod: 'equal',
      participantIds: editParticipantIds,
      payerId: session.user.id,
      debtsToPayer: editDebtsToCurrentUser,
    }),
    [editParticipantIds, session.user.id, editDebtsToCurrentUser],
  );
  const editSettlementSuggestion = useMemo(
    () =>
      suggestSettlementAwareEqualSplit({
        amountCents: editAmountCentsPreview,
        participantIds: editParticipantIds,
        payerId: session.user.id,
        debtsToPayer: editDebtsToCurrentUser,
        enabled: editSettleAwareEnabled,
        splitMethod: editSplitMethod,
      }),
    [editAmountCentsPreview, editParticipantIds, session.user.id, editDebtsToCurrentUser, editSettleAwareEnabled, editSplitMethod],
  );
  const editManualTotal = editParticipantIds.reduce((sum, id) => {
    const cents = Math.round(parseFloat((editManualShares[id] ?? '').replace(',', '.')) * 100);
    return sum + (Number.isNaN(cents) ? 0 : cents);
  }, 0);
  const editManualDelta = editAmountCentsPreview - editManualTotal;
  const editPercentageTotal = editParticipantIds.reduce((sum, id) => {
    const pct = parseFloat((editPercentageShares[id] ?? '').replace(',', '.'));
    return sum + (Number.isNaN(pct) ? 0 : pct);
  }, 0);
  const editPercentageDelta = 100 - editPercentageTotal;

  const openEditModal = (expense: ExpenseListRow) => {
    if (!canEditExpense(expense)) return;
    setEditingExpense(expense);
    setEditTitle(expense.title);
    setEditAmount(formatFixedInput(expense.amount_cents / 100));
    setEditDescription(expense.description || '');
    const participantIds = (expense.splits || []).map((s) => s.user_id);
    setEditParticipantIds(participantIds);
    const method =
      expense.split_method === 'manual' || expense.split_method === 'percentage'
        ? expense.split_method
        : 'equal';
    setEditSplitMethod(method);
    setEditSettleAwareEnabled(false);
    const manualMap: Record<string, string> = {};
    const pctMap: Record<string, string> = {};
    for (const split of expense.splits || []) {
      manualMap[split.user_id] = formatFixedInput(split.share_cents / 100);
      if (split.percentage !== null && split.percentage !== undefined) {
        pctMap[split.user_id] = String(split.percentage);
      }
    }
    setEditManualShares(manualMap);
    setEditPercentageShares(pctMap);
    setEditError(null);
  };

  const closeEditModal = () => {
    setEditingExpense(null);
    setEditError(null);
  };

  useEffect(() => {
    const loadMembers = async () => {
      if (!editingExpense) {
        setEditMembers([]);
        return;
      }
      const { data } = await supabase
        .from('group_members')
        .select('user_id, profile:profiles(full_name)')
        .eq('group_id', editingExpense.group_id)
        .eq('status', 'active');
      const members = (data || []).map((row: any) => ({
        user_id: row.user_id,
        full_name: Array.isArray(row.profile) ? row.profile[0]?.full_name ?? null : row.profile?.full_name ?? null,
      }));
      setEditMembers(members);
      if (editParticipantIds.length === 0) {
        setEditParticipantIds(members.map((m) => m.user_id));
      }
    };
    void loadMembers();
  }, [editingExpense]);

  useEffect(() => {
    if (!editingExpense || editMembers.length === 0) {
      setEditDebtsToCurrentUser({});
      return;
    }
    const eligible = expenses
      .filter((row) => row.group_id === editingExpense.group_id)
      .filter((row) => isAccountingEligibleExpenseRow(row as any))
      .map((row) => ({
        paid_by_user_id: row.paid_by_user_id,
        splits: row.splits?.map((s) => ({ user_id: s.user_id, share_cents: s.share_cents })),
      }));
    setEditDebtsToCurrentUser(
      computeDebtsToCurrentUser({
        members: editMembers,
        currentUserId: session.user.id,
        eligibleExpenses: eligible,
      }),
    );
  }, [editingExpense, editMembers, expenses, session.user.id]);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;
    setEditError(null);

    const amountCents = Math.round(parseFloat(editAmount.replace(',', '.')) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      setEditError(t('expenseForm.invalidAmount'));
      return;
    }

    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      setEditError(t('expenseForm.titleRequired'));
      return;
    }

    if (editParticipantIds.length === 0) {
      setEditError(t('groupExpense.noParticipants'));
      return;
    }

    let splits: Array<{ user_id: string; share_cents?: number; percentage?: number }> | undefined = undefined;
    if (editSplitMethod === 'manual') {
      const parsed = editParticipantIds.map((id) => ({
        user_id: id,
        share_cents: Math.round(parseFloat((editManualShares[id] ?? '').replace(',', '.')) * 100),
      }));
      if (parsed.some((row) => Number.isNaN(row.share_cents) || row.share_cents < 0)) {
        setEditError(t('groupExpense.invalidManualSplit'));
        return;
      }
      const totalManual = parsed.reduce((sum, row) => sum + row.share_cents, 0);
      if (totalManual !== amountCents) {
        setEditError(t('groupExpense.manualSplitTotalMismatch'));
        return;
      }
      splits = parsed;
    } else if (editSplitMethod === 'percentage') {
      const parsed = editParticipantIds.map((id) => ({
        user_id: id,
        percentage: parseFloat((editPercentageShares[id] ?? '').replace(',', '.')),
      }));
      if (parsed.some((row) => Number.isNaN(row.percentage) || row.percentage < 0)) {
        setEditError(t('groupExpense.invalidPercentageSplit'));
        return;
      }
      const totalPct = parsed.reduce((sum, row) => sum + row.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        setEditError(t('groupExpense.percentageSplitTotalMismatch'));
        return;
      }
      let allocated = 0;
      splits = parsed.map((row, index) => {
        if (index === parsed.length - 1) {
          return { user_id: row.user_id, percentage: row.percentage, share_cents: amountCents - allocated };
        }
        const share = Math.round(amountCents * (row.percentage / 100));
        allocated += share;
        return { user_id: row.user_id, percentage: row.percentage, share_cents: share };
      });
    } else if (editSplitMethod === 'equal' && editSettleAwareEnabled && editSettleAwareAvailable) {
      if (editSettlementSuggestion.applied) {
        splits = editParticipantIds.map((id) => ({ user_id: id, share_cents: editSettlementSuggestion.adjustedShares[id] || 0 }));
      }
    }

    const result = await updateExpense(editingExpense.id, {
      title: trimmedTitle,
      amount_cents: amountCents,
      description: editDescription.trim() ? editDescription.trim() : null,
      split_method:
        editSplitMethod === 'equal' && editSettleAwareEnabled && editSettleAwareAvailable ? 'manual' : editSplitMethod,
      participant_ids: editParticipantIds,
      splits,
    });

    if (result.success) {
      closeEditModal();
    } else {
      setEditError(result.error || t('expenseForm.updateFailed'));
    }
  };

  if (expensesLoading || groupsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (expensesError) {
    return (
      <div className="p-8 bg-red-50 border border-red-100 rounded-3xl text-center">
        <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-4" />
        <p className="text-red-900 font-bold">{t('expenses.loadError')}</p>
        <p className="text-red-700 mt-1">{expensesError}</p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">{t('expenses.title')}</h2>
          <p className="text-slate-500 mt-1">{t('expenses.subtitle')}</p>
          {recentQuickFilterDays && (
            <div className="mt-2">
              <Badge variant="blue" size="sm">
                {t('expenses.quickRecentFilter', { days: recentQuickFilterDays })}
              </Badge>
            </div>
          )}
        </div>
        <Button onClick={() => setShowFilters(!showFilters)} variant="outline">
          <Filter className="w-4 h-4 mr-2" />
          {showFilters ? t('expenses.hideFilters') : t('expenses.showFilters')}
          {showFilters ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
        </Button>
      </div>

      <Card className="p-4">
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              type="text" 
              placeholder={t('expenses.searchPlaceholderFull')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">{t('expenses.group')}</label>
                    <div className="relative">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <select 
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none"
                      >
                        <option value="all">{t('expenses.allGroups')}</option>
                        {groups.map(group => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">{t('expenses.status')}</label>
                    <select
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value as 'all' | 'draft' | 'confirmed')}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    >
                      <option value="all">{t('expenses.allStatuses')}</option>
                      <option value="confirmed">{t('expenses.confirmedSection')}</option>
                      <option value="draft">{t('expenses.draftSection')}</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">{t('expenses.fromDate')}</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">{t('expenses.toDate')}</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedGroupId('all');
                      setSelectedStatus('all');
                      setStartDate('');
                      setEndDate('');
                    }}
                  >
                    {t('expenses.resetFilters')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      <div className="space-y-4">
        {filteredExpenses.length > 0 ? (
          filteredExpenses.map((expense: ExpenseListRow) => (
            <Card
              key={expense.id}
              className={`transition-shadow p-0 overflow-hidden ${
                canEditExpense(expense) ? 'hover:shadow-md cursor-pointer' : 'cursor-default'
              }`}
              onClick={canEditExpense(expense) ? () => openEditModal(expense) : undefined}
            >
              <div className="flex items-center p-6 gap-6">
                {(() => {
                  const matched = classifyExpenseTitle(expense.title);
                  return (
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
                      {matched ? (
                        <span className="text-2xl" aria-hidden>
                          {matched.icon}
                        </span>
                      ) : (
                        <CreditCard className="w-6 h-6" />
                      )}
                    </div>
                  );
                })()}
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-lg font-bold text-slate-900 truncate">{expense.title}</h4>
                    <Badge variant="slate" size="sm">
                      {groups.find(g => g.id === expense.group_id)?.name || t('expenses.unknownGroup')}
                    </Badge>
                    {expense.event?.title && (
                      <Badge variant="blue" size="sm">
                        {expense.event.title}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDateOnly(expense.incurred_at, locale)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {t('expenses.paidBy', { name: expense.profiles?.full_name || '—' })}
                    </span>
                  </div>
                  {expense.description && (
                    <p className="text-sm text-slate-400 mt-2 line-clamp-1">{expense.description}</p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-slate-900">
                    {formatCurrency(expense.amount_cents, expense.currency)}
                  </p>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
                    {t('expenses.splitMethod', { method: expense.split_method })}
                  </p>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
              <Search className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{t('expenses.empty')}</h3>
            <p>{t('expenses.emptyHint')}</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(editingExpense)}
        onClose={closeEditModal}
        title={t('expenseForm.editTitle')}
        size="lg"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('expenseForm.titleLabel')}
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder={t('expenseForm.titlePlaceholder')}
            />
            <Input
              label={t('expenseForm.amountLabel')}
              type="number"
              step="0.01"
              required
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Input
            label={t('expenseForm.descriptionLabel')}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder={t('expenseForm.descriptionPlaceholder')}
          />
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.participantsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {editMembers.map((m) => (
                <label
                  key={m.user_id}
                  className="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer text-sm max-w-full"
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    checked={editParticipantIds.includes(m.user_id)}
                    onChange={() =>
                      setEditParticipantIds((prev) =>
                        prev.includes(m.user_id) ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                      )
                    }
                  />
                  <span className="font-medium text-slate-800 truncate">{m.full_name || m.user_id}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {editSplitMethod === 'equal' && editSettleAwareAvailable && (
              <div className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={editSettleAwareEnabled}
                    onChange={(e) => setEditSettleAwareEnabled(e.target.checked)}
                  />
                  {t('groupExpense.useToSettleBalances')}
                </label>
                <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesHint')}</p>
                <p className="text-xs text-slate-500">{t('groupExpense.useToSettleBalancesRule')}</p>
                {editSettleAwareEnabled && editSettlementSuggestion.applied && (
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                    <p className="font-semibold text-slate-700">{t('groupExpense.adjustedToSettleBalances')}</p>
                    <div className="mt-1 space-y-1">
                      {editParticipantIds.map((id) => {
                        const member = editMembers.find((m) => m.user_id === id);
                        const name = member?.full_name || id;
                        const base = editSettlementSuggestion.baseShares[id] || 0;
                        const adjusted = editSettlementSuggestion.adjustedShares[id] || 0;
                        const delta = adjusted - base;
                        return (
                          <p key={id} className={delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-slate-600'}>
                            {t('groupExpense.adjustedPreviewLine', { name, adjusted: formatCurrency(adjusted, 'EUR'), base: formatCurrency(base, 'EUR') })}
                          </p>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-slate-500">{t('groupExpense.settleSuggestionNote')}</p>
                  </div>
                )}
              </div>
            )}
            <label className="block text-sm font-semibold text-slate-700">{t('groupExpense.splitMethodLabel')}</label>
            <select
              className="block w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-700"
              value={editSplitMethod}
              onChange={(e) => {
                const nextMethod = e.target.value as 'equal' | 'manual' | 'percentage';
                if (nextMethod === 'manual') {
                  const next: Record<string, string> = {};
                  for (const id of editParticipantIds) {
                    const cents =
                      editSettleAwareEnabled && editSettlementSuggestion.applied
                        ? editSettlementSuggestion.adjustedShares[id] || 0
                        : editEqualSharesPreview[id] || 0;
                    next[id] = formatCentsAsDecimal(cents, { digits: 2 });
                  }
                  setEditManualShares(next);
                }
                setEditSplitMethod(nextMethod);
              }}
            >
              <option value="equal">{t('groupExpense.splitEqual')}</option>
              <option value="manual">{t('groupExpense.splitManual')}</option>
              <option value="percentage">{t('groupExpense.splitPercentage')}</option>
            </select>
          </div>
          {editSplitMethod === 'manual' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.manualSplitLabel')}</span>
              <div className="space-y-2">
                {editMembers
                  .filter((m) => editParticipantIds.includes(m.user_id))
                  .map((m) => (
                    <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <span className="text-sm text-slate-800 flex-1 truncate">{m.full_name || m.user_id}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editManualShares[m.user_id] ?? ''}
                        onChange={(e) => setEditManualShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                        placeholder={(() => {
                          const count = editParticipantIds.length || 1;
                          return formatCentsAsDecimal(editAmountCentsPreview / count, { digits: 2 });
                        })()}
                        className="w-28 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                      />
                      {editSettleAwareEnabled && editEqualSharesPreview[m.user_id] != null && (
                        <span
                          className={`text-xs font-semibold ${
                            (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) >
                            (editEqualSharesPreview[m.user_id] || 0)
                              ? 'text-red-600'
                              : (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) <
                                  (editEqualSharesPreview[m.user_id] || 0)
                                ? 'text-emerald-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {(Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                            (editEqualSharesPreview[m.user_id] || 0) >
                          0
                            ? '+'
                            : ''}
                          {formatCurrency(
                            Math.abs(
                              (Math.round(parseFloat((editManualShares[m.user_id] ?? '').replace(',', '.')) * 100) || 0) -
                                (editEqualSharesPreview[m.user_id] || 0),
                            ),
                            'EUR',
                          )}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
              <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                editManualDelta === 0
                  ? 'text-green-700 bg-green-50 border-green-200'
                  : editManualDelta > 0
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                {editManualDelta === 0
                  ? t('groupExpense.manualSplitExact')
                  : editManualDelta > 0
                    ? t('groupExpense.manualSplitMissing', { amount: formatCurrency(editManualDelta, 'EUR') })
                    : t('groupExpense.manualSplitExcess', { amount: formatCurrency(Math.abs(editManualDelta), 'EUR') })}
              </p>
            </div>
          )}
          {editSplitMethod === 'percentage' && (
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-700">{t('groupExpense.percentageSplitLabel')}</span>
              <div className="space-y-2">
                {editMembers
                  .filter((m) => editParticipantIds.includes(m.user_id))
                  .map((m) => (
                    <div key={m.user_id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                      <span className="text-sm text-slate-800 flex-1 truncate">{m.full_name || m.user_id}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editPercentageShares[m.user_id] ?? ''}
                        onChange={(e) => setEditPercentageShares((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                        placeholder="0"
                        className="w-20 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-right"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  ))}
              </div>
              <p className={`text-xs inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                Math.abs(editPercentageDelta) < 0.01
                  ? 'text-green-700 bg-green-50 border-green-200'
                  : editPercentageDelta > 0
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                {Math.abs(editPercentageDelta) < 0.01
                  ? t('groupExpense.percentageSplitExact')
                  : editPercentageDelta > 0
                    ? t('groupExpense.percentageSplitMissing', { value: formatDecimal(editPercentageDelta, { locale, digits: 2 }) })
                    : t('groupExpense.percentageSplitExcess', { value: formatDecimal(Math.abs(editPercentageDelta), { locale, digits: 2 }) })}
              </p>
            </div>
          )}
          {editError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              <AlertCircle className="w-4 h-4" />
              {editError}
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={closeEditModal} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={actionLoading} className="flex-[2]">
              {t('expenseForm.saveChanges')}
            </Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
