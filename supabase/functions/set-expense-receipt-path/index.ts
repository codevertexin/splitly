import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

function json(req: Request, data: Record<string, unknown>, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeadersForRequest(req),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function isValidReceiptPathForExpense(
  receiptPath: string,
  groupId: string,
  expenseId: string,
): boolean {
  const parts = receiptPath.split('/').filter(Boolean);
  if (parts.length < 3) return false;
  return parts[0] === groupId && parts[1] === expenseId;
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return preflightResponse(req);
    }

    if (req.method !== 'POST') {
      return json(req, { error: 'Method not allowed' }, { status: 405 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json(req,{ error: 'Missing Supabase env vars' }, { status: 500 });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(req,{ error: 'Missing Authorization header' }, { status: 401 });
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
      return json(req,{ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as {
      expense_id?: string;
      receipt_path?: string | null;
      receipt_filename?: string | null;
      receipt_mime_type?: string | null;
      receipt_size_bytes?: number | null;
    };

    const expenseId = body.expense_id as string;
    const hasReceiptPath = Object.prototype.hasOwnProperty.call(body, 'receipt_path');
    const receiptPath = hasReceiptPath ? (body.receipt_path as string | null) : undefined;

    if (!expenseId) {
      return json(req,{ error: 'expense_id is required' }, { status: 400 });
    }
    if (!hasReceiptPath) {
      return json(req,{ error: 'receipt_path is required (use null to clear)' }, { status: 400 });
    }

    const { data: existingExpense, error: existingExpenseError } = await adminClient
      .from('expenses')
      .select('id, group_id, event_id, paid_by_user_id, created_by')
      .eq('id', expenseId)
      .maybeSingle();

    if (existingExpenseError) {
      return json(req,{ error: existingExpenseError.message }, { status: 400 });
    }

    if (!existingExpense) {
      return json(req,{ error: 'Expense not found' }, { status: 404 });
    }

    if (
      existingExpense.created_by !== user.id &&
      existingExpense.paid_by_user_id !== user.id
    ) {
      return json(req,{ error: 'Forbidden' }, { status: 403 });
    }

    const groupId = existingExpense.group_id as string;

    const { data: membership, error: membershipError } = await adminClient
      .from('group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (membershipError) {
      return json(req,{ error: membershipError.message }, { status: 400 });
    }

    if (!membership) {
      return json(req,{ error: 'You are not an active member of this group' }, { status: 403 });
    }

    if (receiptPath !== null && receiptPath !== '') {
      if (!isValidReceiptPathForExpense(receiptPath, groupId, expenseId)) {
        return json(req,{ error: 'Invalid receipt_path for this expense' }, { status: 400 });
      }
    }

    const nextPath = receiptPath === '' ? null : receiptPath;

    const patch: Record<string, string | number | null> = { receipt_path: nextPath };
    if (nextPath === null) {
      patch.receipt_filename = null;
      patch.receipt_mime_type = null;
      patch.receipt_size_bytes = null;
    } else {
      if (Object.prototype.hasOwnProperty.call(body, 'receipt_filename')) {
        patch.receipt_filename = (body.receipt_filename as string | null) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'receipt_mime_type')) {
        patch.receipt_mime_type = (body.receipt_mime_type as string | null) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'receipt_size_bytes')) {
        const n = body.receipt_size_bytes;
        patch.receipt_size_bytes =
          typeof n === 'number' && Number.isFinite(n) ? n : null;
      }
    }

    const { data: updated, error: updateError } = await adminClient
      .from('expenses')
      .update(patch)
      .eq('id', expenseId)
      .select('id, receipt_path, receipt_filename, receipt_mime_type, receipt_size_bytes')
      .single();

    if (updateError || !updated) {
      return json(req,
        { error: updateError?.message ?? 'Failed to update expense' },
        { status: 400 },
      );
    }

    return json(req,{ expense: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json(req,{ error: message }, { status: 500 });
  }
});
