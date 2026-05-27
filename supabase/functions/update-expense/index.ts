import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SplitInput = {
  user_id: string;
  share_cents?: number;
  percentage?: number;
};

type UpdateExpenseBody = {
  expense_id: string;
  title: string;
  description?: string | null;
  amount_cents: number;
  split_method: "equal" | "manual" | "percentage";
  participant_ids: string[];
  splits?: SplitInput[];
  status?: "draft" | "confirmed";
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return preflightResponse(req);
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as UpdateExpenseBody;

    const {
      expense_id,
      title,
      description = null,
      amount_cents,
      split_method,
      participant_ids,
      splits = [],
      status,
    } = body;

    if (!expense_id) return jsonResponse(req, { error: "Missing expense_id" }, 400);
    if (!title?.trim()) return jsonResponse(req, { error: "Missing title" }, 400);
    if (!amount_cents || amount_cents <= 0) return jsonResponse(req, { error: "Invalid amount_cents" }, 400);
    if (!participant_ids?.length) return jsonResponse(req, { error: "At least one participant is required" }, 400);
    if (status && status !== "draft" && status !== "confirmed") {
      return jsonResponse(req, { error: "Invalid expense status" }, 400);
    }

    const { data: expense, error: expenseError } = await admin
      .from("expenses")
      .select("id, group_id, event_id, created_by")
      .eq("id", expense_id)
      .maybeSingle();
    if (expenseError || !expense) return jsonResponse(req, { error: "Expense not found" }, 404);
    if (expense.created_by !== user.id) return jsonResponse(req, { error: "Not allowed to update this expense" }, 403);

    if (expense.event_id) {
      const { data: evRow } = await admin
        .from("events")
        .select("status")
        .eq("id", expense.event_id)
        .maybeSingle();
      if (evRow?.status === "closed") {
        return jsonResponse(req, { error: "Cannot edit expenses in a closed event", code: "EVENT_CLOSED" }, 400);
      }
    }

    const { data: memberships } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", expense.group_id)
      .eq("status", "active");
    const validUserIds = new Set((memberships || []).map((m) => m.user_id));
    const invalidParticipant = participant_ids.find((id) => !validUserIds.has(id));
    if (invalidParticipant) return jsonResponse(req, { error: "One or more participants are not valid group members" }, 400);

    let splitRows: Array<{ user_id: string; share_cents: number; percentage: number | null }> = [];
    if (split_method === "equal") {
      const count = participant_ids.length;
      const baseShare = Math.floor(amount_cents / count);
      let remainder = amount_cents - baseShare * count;
      splitRows = participant_ids.map((user_id) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        return { user_id, share_cents: baseShare + extra, percentage: null };
      });
    } else if (split_method === "manual") {
      if (!splits.length) return jsonResponse(req, { error: "Manual split requires splits[]" }, 400);
      const total = splits.reduce((sum, s) => sum + (s.share_cents || 0), 0);
      if (total !== amount_cents) return jsonResponse(req, { error: "Manual splits must sum exactly to amount_cents" }, 400);
      splitRows = splits.map((s) => ({ user_id: s.user_id, share_cents: s.share_cents || 0, percentage: null }));
    } else {
      if (!splits.length) return jsonResponse(req, { error: "Percentage split requires splits[]" }, 400);
      const totalPct = splits.reduce((sum, s) => sum + (s.percentage || 0), 0);
      if (Math.abs(totalPct - 100) > 0.01) return jsonResponse(req, { error: "Percentages must sum to 100" }, 400);
      let allocated = 0;
      splitRows = splits.map((s, index) => {
        if (index === splits.length - 1) {
          return { user_id: s.user_id, share_cents: amount_cents - allocated, percentage: s.percentage || 0 };
        }
        const share = Math.round(amount_cents * ((s.percentage || 0) / 100));
        allocated += share;
        return { user_id: s.user_id, share_cents: share, percentage: s.percentage || 0 };
      });
    }

    for (const row of splitRows) {
      if (!validUserIds.has(row.user_id)) return jsonResponse(req, { error: "Split contains invalid user_id" }, 400);
    }

    const { error: updateError } = await admin
      .from("expenses")
      .update({
        title: title.trim(),
        description,
        amount_cents,
        split_method,
        ...(status ? { status } : {}),
      })
      .eq("id", expense_id);
    if (updateError) return jsonResponse(req, { error: "Failed to update expense", details: updateError.message }, 400);

    const { error: deleteSplitsError } = await admin
      .from("expense_splits")
      .delete()
      .eq("expense_id", expense_id);
    if (deleteSplitsError) return jsonResponse(req, { error: "Failed to reset expense splits", details: deleteSplitsError.message }, 400);

    const { error: insertSplitsError } = await admin
      .from("expense_splits")
      .insert(
        splitRows.map((row) => ({
          expense_id,
          user_id: row.user_id,
          share_cents: row.share_cents,
          percentage: row.percentage,
        })),
      );
    if (insertSplitsError) return jsonResponse(req, { error: "Failed to save expense splits", details: insertSplitsError.message }, 400);

    await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: expense.group_id,
      event_id: expense.event_id,
      entity_type: "expense",
      entity_id: expense_id,
      action: "expense_updated",
      payload: { amount_cents, split_method, participants_count: participant_ids.length, status: status ?? null },
    });

    return jsonResponse(req, { success: true });
  } catch (err) {
    console.error(err);
    return jsonResponse(req, 
      { error: "Unexpected server error", details: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
