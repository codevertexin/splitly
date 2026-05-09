import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createExpenseCanonical } from '../_shared/finance/engine/createExpenseCanonical.ts';
import type { CreateExpenseCanonicalInput } from '../_shared/finance/types.ts';
import { computeDebtsToPayer } from '../_shared/finance/engine/settlementAware.ts';
import { getActiveBatchIdForGroup } from '../_shared/activeBatch.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;

function optionalReceiptColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, 'receipt_path')) {
    out.receipt_path = (body.receipt_path as string | null) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'receipt_filename')) {
    out.receipt_filename = (body.receipt_filename as string | null) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'receipt_mime_type')) {
    out.receipt_mime_type = (body.receipt_mime_type as string | null) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'receipt_size_bytes')) {
    const n = body.receipt_size_bytes;
    out.receipt_size_bytes = typeof n === 'number' && Number.isFinite(n) ? n : null;
  }
  return out;
}

function json(data: Json, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
  return new Response("ok", { headers: corsHeaders });
}

if (req.method !== "POST") {
  return json({ error: "Method not allowed" }, { status: 405 });
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
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as Record<string, unknown>;

    const groupId = body.group_id as string;
    const eventId = (body.event_id as string | null | undefined) ?? null;
    const paidByUserId = body.paid_by_user_id as string;
    const participants = body.participants as string[];
    const requestedSplitMethod = body.requested_split_method as
      | 'equal'
      | 'manual'
      | 'percentage'
      | 'settlement_aware';
    const amountCents = body.amount_cents as number;
    const statusIntent = body.status_intent as 'draft' | 'confirmed';
    const description = (body.description as string | undefined) ?? '';
    const manualShares = body.manual_shares ?? [];
    const percentageShares = body.percentage_shares ?? [];
    const title = (body.title as string | undefined)?.trim() ?? '';
    const currency = (body.currency as string | undefined)?.trim() ?? 'EUR';
    const explicitAffectsBalancesIntent =
      (body.affects_balances_intent as boolean | null | undefined) ?? null;

    if (!title) {
      return json({ error: 'title is required' }, { status: 400 });
    }

    if (!groupId) {
      return json({ error: 'group_id is required' }, { status: 400 });
    }

    if (!paidByUserId) {
      return json({ error: 'paid_by_user_id is required' }, { status: 400 });
    }

    if (!Array.isArray(participants)) {
      return json({ error: 'participants are required' }, { status: 400 });
    }
    if (eventId && participants.length === 0) {
      return json({ error: 'participants are required' }, { status: 400 });
    }

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

    const allActiveSorted = Array.from(activeMemberIds).sort();
    const effectiveParticipants = eventId ? participants : allActiveSorted;

    if (!eventId && participants.length > 0) {
      const reqSorted = [...participants].sort().join('|');
      const fullSorted = allActiveSorted.join('|');
      if (reqSorted !== fullSorted) {
        return json(
          {
            error:
              'Group expenses (no event) must include all active members; participant list is determined by the server',
          },
          { status: 400 },
        );
      }
    }

    for (const participantId of effectiveParticipants) {
      if (!activeMemberIds.has(participantId)) {
        return json(
          { error: `participant ${participantId} is not an active group member` },
          { status: 400 }
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
        return json({ error: 'Cannot add expense to a closed event' }, { status: 400 });
      }
    }

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
  .is('deleted_at', null);

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

    const batchRes = await getActiveBatchIdForGroup(adminClient, groupId);
    if ('error' in batchRes) {
      return json({ error: batchRes.error }, { status: 400 });
    }
    const batchId = batchRes.batchId;

    const engineInput: CreateExpenseCanonicalInput = {
      groupId,
      eventId,
      paidByUserId,
      participants: effectiveParticipants,
      requestedSplitMethod,
      amountCents,
      statusIntent,
      manualShares,
      percentageShares,
      description,
      explicitAffectsBalancesIntent,
      eventStatus,
      debtsToPayer,
    };

    const canonical = createExpenseCanonical(engineInput);

    const { data: insertedExpense, error: expenseInsertError } = await adminClient
  .from('expenses')
  .insert({
    group_id: groupId,
    batch_id: batchId,
    event_id: eventId,
    title,
    description,
    amount_cents: amountCents,
    currency,
    paid_by_user_id: paidByUserId,
    status: statusIntent,

    split_method: requestedSplitMethod,
    requested_split_method: requestedSplitMethod,

    affects_balances: canonical.affectsBalances,
    finance_engine_version: 'v2',
    calculation_trace: canonical.calculationTrace,
    balance_impact_summary: canonical.balanceImpactSummary,
    created_by: user.id,
    ...optionalReceiptColumns(body),
  })
  .select('*')
  .single();

    if (expenseInsertError || !insertedExpense) {
      return json(
        { error: expenseInsertError?.message ?? 'Failed to create expense' },
        { status: 400 }
      );
    }

    const splitsPayload = canonical.canonicalSplits.map((split) => ({
      expense_id: insertedExpense.id,
      user_id: split.userId,
      share_cents: split.amountCents,
    }));
    
    const { error: splitsInsertError } = await adminClient
      .from('expense_splits')
      .insert(splitsPayload);

    if (splitsInsertError) {
      await adminClient.from('expenses').delete().eq('id', insertedExpense.id);

      return json(
        { error: splitsInsertError.message },
        { status: 400 }
      );
    }

    return json({
      expense: insertedExpense,
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