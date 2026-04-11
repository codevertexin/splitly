import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createExpenseCanonical } from '../_shared/finance/engine/createExpenseCanonical.ts';
import type { CreateExpenseCanonicalInput } from '../_shared/finance/types.ts';
import { computeDebtsToPayer } from '../_shared/finance/engine/settlementAware.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Json = Record<string, unknown>;

function json(data: Json, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json({ error: 'Missing Supabase env vars' }, { status: 500 });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const expenseId = body.expense_id as string;
    const title = (body.title as string | undefined)?.trim() ?? '';
    const description = (body.description as string | undefined) ?? '';
    const amountCents = body.amount_cents as number;
    const requestedSplitMethod = body.requested_split_method as
      | 'equal'
      | 'manual'
      | 'percentage'
      | 'settlement_aware';
    const participantIds = body.participant_ids as string[];
    const splits = (body.splits ?? []) as Array<{
      user_id: string;
      share_cents?: number;
      percentage?: number;
    }>;
    const statusIntent = body.status_intent as 'draft' | 'confirmed';
    const hasReceiptPath = Object.prototype.hasOwnProperty.call(body, 'receipt_path');
    const receiptPathInput = hasReceiptPath ? (body.receipt_path as string | null) : undefined;

    if (!expenseId) return json({ error: 'expense_id is required' }, { status: 400 });
    if (!title) return json({ error: 'title is required' }, { status: 400 });
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return json({ error: 'amount_cents must be a positive integer' }, { status: 400 });
    }
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return json({ error: 'participant_ids are required' }, { status: 400 });
    }

    const { data: existingExpense, error: existingExpenseError } = await adminClient
      .from('expenses')
      .select('id, group_id, event_id, paid_by_user_id, currency, created_by')
      .eq('id', expenseId)
      .maybeSingle();

    if (existingExpenseError) {
      return json({ error: existingExpenseError.message }, { status: 400 });
    }

    if (!existingExpense) {
      return json({ error: 'Expense not found' }, { status: 404 });
    }

    if (
      existingExpense.created_by !== user.id &&
      existingExpense.paid_by_user_id !== user.id
    ) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const groupId = existingExpense.group_id as string;
    const eventId = (existingExpense.event_id as string | null) ?? null;
    const paidByUserId = existingExpense.paid_by_user_id as string;
    const currency = (existingExpense.currency as string | null) ?? 'EUR';

    const { data: membership, error: membershipError } = await adminClient
      .from('group_members')
      .select('group_id, user_id, status')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (membershipError) {
      return json({ error: membershipError.message }, { status: 400 });
    }

    if (!membership) {
      return json({ error: 'You are not an active member of this group' }, { status: 403 });
    }

    const { data: members, error: membersError } = await adminClient
      .from('group_members')
      .select('user_id, status')
      .eq('group_id', groupId)
      .eq('status', 'active');

    if (membersError) {
      return json({ error: membersError.message }, { status: 400 });
    }

    const activeMemberIds = new Set((members ?? []).map((m) => m.user_id));

    if (!activeMemberIds.has(paidByUserId)) {
      return json({ error: 'paid_by_user_id is not an active group member' }, { status: 400 });
    }

    for (const participantId of participantIds) {
      if (!activeMemberIds.has(participantId)) {
        return json(
          { error: `participant ${participantId} is not an active group member` },
          { status: 400 },
        );
      }
    }

    let eventStatus: 'draft' | 'open' | 'closed' | null = null;

    if (eventId) {
      const { data: event, error: eventError } = await adminClient
        .from('events')
        .select('id, group_id, status')
        .eq('id', eventId)
        .eq('group_id', groupId)
        .maybeSingle();

      if (eventError) {
        return json({ error: eventError.message }, { status: 400 });
      }

      if (!event) {
        return json({ error: 'Event not found for this group' }, { status: 404 });
      }

      eventStatus = event.status;

      if (event.status === 'closed') {
        return json({ error: 'Cannot edit expense in a closed event' }, { status: 400 });
      }
    }

    const manualShares =
      requestedSplitMethod === 'manual'
        ? splits.map((s) => ({
            userId: s.user_id,
            amountCents: s.share_cents ?? 0,
          }))
        : [];

    const percentageShares =
      requestedSplitMethod === 'percentage'
        ? splits.map((s) => ({
            userId: s.user_id,
            percentage: s.percentage ?? 0,
          }))
        : [];

    const { data: existingExpenses, error: existingExpensesError } = await adminClient
      .from('expenses')
      .select(`
        id,
        paid_by_user_id,
        status,
        affects_balances,
        event:events(status),
        splits:expense_splits(user_id, share_cents)
      `)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .neq('id', expenseId);

    if (existingExpensesError) {
      return json({ error: existingExpensesError.message }, { status: 400 });
    }

    const eligibleExpenses = (existingExpenses ?? []).filter((expense) => {
      return expense.affects_balances === true && expense.status === 'confirmed';
    });

    const debtsToPayer =
      requestedSplitMethod === 'settlement_aware'
        ? computeDebtsToPayer({
            members: (members ?? []).map((m) => ({ user_id: m.user_id })),
            payerId: paidByUserId,
            eligibleExpenses: eligibleExpenses as Array<{
              paid_by_user_id: string;
              splits?: Array<{ user_id: string; share_cents: number }>;
            }>,
          })
        : {};

    const engineInput: CreateExpenseCanonicalInput = {
      groupId,
      eventId,
      paidByUserId,
      participants: participantIds,
      requestedSplitMethod,
      amountCents,
      statusIntent,
      manualShares,
      percentageShares,
      description,
      explicitAffectsBalancesIntent: null,
      eventStatus,
      debtsToPayer,
    };

    const canonical = createExpenseCanonical(engineInput);

    const receiptPathPatch: { receipt_path?: string | null } = {};
    if (hasReceiptPath) {
      if (receiptPathInput !== null && receiptPathInput !== undefined && receiptPathInput !== '') {
        const rp = receiptPathInput as string;
        const parts = rp.split('/').filter(Boolean);
        if (parts.length < 3 || parts[0] !== groupId || parts[1] !== expenseId) {
          return json({ error: 'Invalid receipt_path for this expense' }, { status: 400 });
        }
        receiptPathPatch.receipt_path = rp;
      } else {
        receiptPathPatch.receipt_path = null;
      }
    }

    const { data: updatedExpense, error: updateError } = await adminClient
      .from('expenses')
      .update({
        title,
        description,
        amount_cents: amountCents,
        currency,
        status: statusIntent,
        split_method: requestedSplitMethod,
        requested_split_method: requestedSplitMethod,
        affects_balances: canonical.affectsBalances,
        finance_engine_version: 'v2',
        calculation_trace: canonical.calculationTrace,
        balance_impact_summary: canonical.balanceImpactSummary,
        ...receiptPathPatch,
      })
      .eq('id', expenseId)
      .select('*')
      .single();

    if (updateError || !updatedExpense) {
      return json(
        { error: updateError?.message ?? 'Failed to update expense' },
        { status: 400 },
      );
    }

    const { error: deleteSplitsError } = await adminClient
      .from('expense_splits')
      .delete()
      .eq('expense_id', expenseId);

    if (deleteSplitsError) {
      return json({ error: deleteSplitsError.message }, { status: 400 });
    }

    const splitsPayload = canonical.canonicalSplits.map((split) => ({
      expense_id: expenseId,
      user_id: split.userId,
      share_cents: split.amountCents,
    }));

    const { error: splitsInsertError } = await adminClient
      .from('expense_splits')
      .insert(splitsPayload);

    if (splitsInsertError) {
      return json({ error: splitsInsertError.message }, { status: 400 });
    }

    return json({
      expense: updatedExpense,
      canonical_splits: canonical.canonicalSplits,
      affects_balances: canonical.affectsBalances,
      eligible_for_balances: canonical.eligibleForBalances,
      balance_impact_summary: canonical.balanceImpactSummary,
      calculation_trace: canonical.calculationTrace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: message }, { status: 500 });
  }
});