import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useGroups } from './useGroups';
import { type GroupMemberRow, useGroupMembers } from './useGroupMembers';

export type ReportBatchRow = {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  closed_at: string | null;
};

export type ReportExpenseRow = {
  id: string;
  title: string;
  description: string | null;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'confirmed';
  incurred_at: string;
  paid_by_user_id: string;
  event_id: string | null;
  affects_balances?: boolean | null;
  profiles?: {
    full_name?: string | null;
    username?: string | null;
  } | null;
  event?: {
    id: string;
    title: string | null;
    status?: string | null;
  } | null;
  splits?: Array<{
    user_id: string;
    share_cents: number;
  }>;
  receipt_path?: string | null;
  receipt_filename?: string | null;
  receipt_mime_type?: string | null;
  receipt_size_bytes?: number | null;
};

export type ReportSettlementRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  settled_at: string;
  event_id: string | null;
};

export type ReportEventOption = {
  id: string;
  title: string;
};

const REPORTS_FILTERS_STORAGE_KEY = 'splitly_reports_filters_v1';

/** Filtro de relatório: apenas despesas sem evento (nível grupo). */
export const REPORT_EVENT_FILTER_GROUP_ONLY = '__group__';

export function useReportData(session: Session) {
  const initialSaved = useMemo(() => {
    try {
      const raw = localStorage.getItem(REPORTS_FILTERS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        groupId?: string;
        batchId?: string;
        eventId?: string;
      };
      return {
        groupId: typeof parsed.groupId === 'string' ? parsed.groupId : '',
        batchId: typeof parsed.batchId === 'string' ? parsed.batchId : '',
        eventId: typeof parsed.eventId === 'string' ? parsed.eventId : 'all',
      };
    } catch {
      return null;
    }
  }, []);

  const { groups, loading: groupsLoading } = useGroups(session);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(initialSaved?.groupId ?? '');
  const [selectedBatchId, setSelectedBatchId] = useState<string>(initialSaved?.batchId ?? '');
  const [selectedEventId, setSelectedEventId] = useState<string>(initialSaved?.eventId ?? 'all');

  const [batches, setBatches] = useState<ReportBatchRow[]>([]);
  const [expenses, setExpenses] = useState<ReportExpenseRow[]>([]);
  const [settlements, setSettlements] = useState<ReportSettlementRow[]>([]);

  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const {
    members,
    loading: membersLoading,
    error: membersError,
  } = useGroupMembers(session, selectedGroupId || undefined);

  const eventOptions = useMemo<ReportEventOption[]>(() => {
    const byId = new Map<string, ReportEventOption>();
    for (const expense of expenses) {
      if (!expense.event_id) continue;
      if (byId.has(expense.event_id)) continue;
      byId.set(expense.event_id, {
        id: expense.event_id,
        title: expense.event?.title?.trim() || expense.event_id,
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [expenses]);

  const refetchBatches = useCallback(async () => {
    if (!selectedGroupId) {
      setBatches([]);
      return;
    }
    try {
      setLoadingBatches(true);
      setError(null);
      const { data, error: qError } = await supabase
        .from('expense_batches')
        .select('id, title, description, is_active, created_at, closed_at')
        .eq('group_id', selectedGroupId)
        .order('created_at', { ascending: false });
      if (qError) throw qError;
      setBatches((data || []) as ReportBatchRow[]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load batches';
      setError(message);
      setBatches([]);
    } finally {
      setLoadingBatches(false);
    }
  }, [selectedGroupId]);

  const refetchReport = useCallback(async () => {
    if (!selectedGroupId || !selectedBatchId || !selectedBatch) {
      setExpenses([]);
      setSettlements([]);
      return;
    }

    try {
      setLoadingReport(true);
      setError(null);

      let expensesQuery = supabase
        .from('expenses')
        .select(`
          id,
          title,
          description,
          amount_cents,
          currency,
          status,
          incurred_at,
          paid_by_user_id,
          event_id,
          affects_balances,
          receipt_path,
          receipt_filename,
          receipt_mime_type,
          receipt_size_bytes,
          profiles!expenses_paid_by_user_id_fkey(full_name, username),
          event:events(id, title, status),
          splits:expense_splits(user_id, share_cents)
        `)
        .eq('group_id', selectedGroupId)
        .eq('batch_id', selectedBatchId)
        .is('deleted_at', null)
        .order('incurred_at', { ascending: false });
      if (selectedEventId === REPORT_EVENT_FILTER_GROUP_ONLY) {
        expensesQuery = expensesQuery.is('event_id', null);
      } else if (selectedEventId !== 'all') {
        expensesQuery = expensesQuery.eq('event_id', selectedEventId);
      }

      const { data: rawExpenses, error: expensesError } = await expensesQuery;
      if (expensesError) throw expensesError;

      const parsedExpenses: ReportExpenseRow[] = (rawExpenses || []).map((row: any) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const event = Array.isArray(row.event) ? row.event[0] : row.event;
        return {
          ...row,
          profiles: profile ?? null,
          event: event ?? null,
          splits: row.splits ?? [],
        } as ReportExpenseRow;
      });
      setExpenses(parsedExpenses);

      let settlementsQuery = supabase
        .from('settlements')
        .select('id, from_user_id, to_user_id, amount_cents, settled_at, event_id')
        .eq('group_id', selectedGroupId)
        .is('deleted_at', null)
        .gte('settled_at', selectedBatch.created_at)
        .order('settled_at', { ascending: true });

      if (selectedBatch.closed_at) {
        settlementsQuery = settlementsQuery.lte('settled_at', selectedBatch.closed_at);
      }
      if (selectedEventId === REPORT_EVENT_FILTER_GROUP_ONLY) {
        settlementsQuery = settlementsQuery.is('event_id', null);
      } else if (selectedEventId !== 'all') {
        settlementsQuery = settlementsQuery.eq('event_id', selectedEventId);
      }

      const { data: rawSettlements, error: settlementsError } = await settlementsQuery;
      if (settlementsError) throw settlementsError;
      setSettlements((rawSettlements || []) as ReportSettlementRow[]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load report data';
      setError(message);
      setExpenses([]);
      setSettlements([]);
    } finally {
      setLoadingReport(false);
    }
  }, [selectedGroupId, selectedBatchId, selectedBatch, selectedEventId]);

  useEffect(() => {
    if (groupsLoading) return;
    if (groups.length === 0) {
      setSelectedGroupId('');
      return;
    }
    if (!selectedGroupId || !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, groupsLoading, selectedGroupId]);

  useEffect(() => {
    setSelectedBatchId('');
    setSelectedEventId('all');
  }, [selectedGroupId]);

  useEffect(() => {
    void refetchBatches();
  }, [refetchBatches]);

  useEffect(() => {
    if (batches.length === 0) {
      setSelectedBatchId('');
      return;
    }
    if (!selectedBatchId || !batches.some((batch) => batch.id === selectedBatchId)) {
      const activeBatch = batches.find((batch) => batch.is_active);
      setSelectedBatchId(activeBatch?.id ?? batches[0].id);
    }
  }, [batches, selectedBatchId]);

  useEffect(() => {
    void refetchReport();
  }, [refetchReport]);

  useEffect(() => {
    if (selectedEventId === 'all' || selectedEventId === REPORT_EVENT_FILTER_GROUP_ONLY) return;
    if (!eventOptions.some((event) => event.id === selectedEventId)) {
      setSelectedEventId('all');
    }
  }, [eventOptions, selectedEventId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        REPORTS_FILTERS_STORAGE_KEY,
        JSON.stringify({
          groupId: selectedGroupId,
          batchId: selectedBatchId,
          eventId: selectedEventId,
        }),
      );
    } catch {
      // ignore localStorage failures
    }
  }, [selectedGroupId, selectedBatchId, selectedEventId]);

  return {
    groups,
    selectedGroup,
    selectedGroupId,
    setSelectedGroupId,
    batches,
    selectedBatch,
    selectedBatchId,
    setSelectedBatchId,
    eventOptions,
    selectedEventId,
    setSelectedEventId,
    expenses,
    settlements,
    members: members as GroupMemberRow[],
    loading: groupsLoading || loadingBatches || loadingReport || membersLoading,
    error: error || membersError,
    refetchBatches,
    refetchReport,
  };
}
