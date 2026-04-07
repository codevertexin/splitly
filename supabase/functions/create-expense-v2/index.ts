import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createExpenseCanonical } from '../_shared/finance/engine/createExpenseCanonical.ts';
import type { CreateExpenseCanonicalInput } from '../_shared/finance/types.ts';

type Json = Record<string, unknown>;

function json(data: Json, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

serve(async (req) => {
  try {
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

    const body = await req.json();

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
    const explicitAffectsBalancesIntent =
      (body.affects_balances_intent as boolean | null | undefined) ?? null;

    if (!groupId) {
      return json({ error: 'group_id is required' }, { status: 400 });
    }

    if (!paidByUserId) {
      return json({ error: 'paid_by_user_id is required' }, { status: 400 });
    }

    if (!Array.isArray(participants) || participants.length === 0) {
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

    for (const participantId of participants) {
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

    const engineInput: CreateExpenseCanonicalInput = {
      groupId,
      eventId,
      paidByUserId,
      participants,
      requestedSplitMethod,
      amountCents,
      statusIntent,
      manualShares,
      percentageShares,
      description,
      explicitAffectsBalancesIntent,
      eventStatus,
    };

    const canonical = createExpenseCanonical(engineInput);

    const { data: insertedExpense, error: expenseInsertError } = await adminClient
      .from('expenses')
      .insert({
        group_id: groupId,
        event_id: eventId,
        paid_by_user_id: paidByUserId,
        amount_cents: amountCents,
        status: statusIntent,
        description,
        affects_balances: canonical.affectsBalances,
        finance_engine_version: 'v2',
        calculation_trace: canonical.calculationTrace,
        balance_impact_summary: canonical.balanceImpactSummary,
        created_by: user.id,
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