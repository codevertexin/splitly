import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UpdateEventBody = {
  event_id: string;
  title: string;
  description?: string | null;
  participant_user_ids: string[];
  starts_at: string;
  ends_at?: string | null;
  recalculate_draft_expenses?: boolean;
};

type ExistingSplit = {
  user_id: string;
  share_cents: number;
  percentage: number | null;
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

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
    const body = (await req.json()) as UpdateEventBody;

    const title = body.title?.trim();
    if (!body.event_id) return jsonResponse(req, { error: "Missing event_id" }, 400);
    if (!title || title.length < 2) return jsonResponse(req, { error: "Invalid title" }, 400);
    if (!Array.isArray(body.participant_user_ids) || body.participant_user_ids.length === 0) {
      return jsonResponse(req, { error: "At least one participant is required" }, 400);
    }
    if (!body.starts_at) return jsonResponse(req, { error: "Missing starts_at" }, 400);

    const startsAtDate = new Date(body.starts_at);
    if (Number.isNaN(startsAtDate.getTime())) return jsonResponse(req, { error: "Invalid starts_at" }, 400);
    const endsAtDate = body.ends_at ? new Date(body.ends_at) : null;
    if (endsAtDate && Number.isNaN(endsAtDate.getTime())) return jsonResponse(req, { error: "Invalid ends_at" }, 400);
    if (endsAtDate && endsAtDate.getTime() < startsAtDate.getTime()) {
      return jsonResponse(req, { error: "ends_at must be greater than or equal to starts_at" }, 400);
    }

    const { data: event, error: eventError } = await admin
      .from("events")
      .select("id, group_id, status, created_by")
      .eq("id", body.event_id)
      .maybeSingle();
    if (eventError || !event) return jsonResponse(req, { error: "Event not found" }, 404);
    if (event.status === "closed") return jsonResponse(req, { error: "Closed events cannot be edited" }, 400);

    const { data: actorMembership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", event.group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!actorMembership) return jsonResponse(req, { error: "You are not an active member of this group" }, 403);
    if (event.created_by !== user.id) {
      return jsonResponse(req, { error: "Only the event creator can update this event" }, 403);
    }

    const participantUserIds = Array.from(new Set([event.created_by, ...body.participant_user_ids]));
    const { data: activeMembers } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", event.group_id)
      .eq("status", "active");
    const activeMemberIds = new Set((activeMembers || []).map((m) => m.user_id));
    const invalidUser = participantUserIds.find((id) => !activeMemberIds.has(id));
    if (invalidUser) return jsonResponse(req, { error: "All participants must be active group members" }, 400);

    const { error: updateEventError } = await admin
      .from("events")
      .update({
        title,
        description: body.description || null,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate ? endsAtDate.toISOString() : null,
      })
      .eq("id", event.id);
    if (updateEventError) return jsonResponse(req, { error: updateEventError.message }, 400);

    const { data: existingParticipants, error: existingParticipantsError } = await admin
      .from("event_participants")
      .select("id, user_id")
      .eq("event_id", event.id);
    if (existingParticipantsError) return jsonResponse(req, { error: existingParticipantsError.message }, 400);

    const existingIds = new Set((existingParticipants || []).map((p) => p.user_id));
    const removedUserIds = (existingParticipants || [])
      .filter((row) => !participantUserIds.includes(row.user_id))
      .map((row) => row.user_id);
    const removeParticipantRowIds = (existingParticipants || [])
      .filter((row) => !participantUserIds.includes(row.user_id))
      .map((row) => row.id);
    const toAdd = participantUserIds.filter((id) => !existingIds.has(id));

    if (removedUserIds.length > 0 && body.recalculate_draft_expenses !== false) {
      const { data: eventExpenses, error: eventExpensesError } = await admin
        .from("expenses")
        .select("id, amount_cents, split_method, status")
        .eq("event_id", event.id)
        .is("deleted_at", null);
      if (eventExpensesError) return jsonResponse(req, { error: eventExpensesError.message }, 400);

      const expenseIds = (eventExpenses || []).map((e) => e.id);
      if (expenseIds.length > 0) {
        const { data: splitRows, error: splitsError } = await admin
          .from("expense_splits")
          .select("expense_id, user_id, share_cents, percentage")
          .in("expense_id", expenseIds);
        if (splitsError) return jsonResponse(req, { error: splitsError.message }, 400);

        const splitsByExpense = new Map<string, ExistingSplit[]>();
        for (const row of splitRows || []) {
          if (!splitsByExpense.has(row.expense_id)) splitsByExpense.set(row.expense_id, []);
          splitsByExpense.get(row.expense_id)!.push({
            user_id: row.user_id,
            share_cents: row.share_cents,
            percentage: row.percentage,
          });
        }

        for (const expense of (eventExpenses || []).filter((e) => e.status === "draft")) {
          const currentSplits = splitsByExpense.get(expense.id) || [];
          if (!currentSplits.some((s) => removedUserIds.includes(s.user_id))) continue;

          const remaining = currentSplits.filter((s) => !removedUserIds.includes(s.user_id));
          if (remaining.length === 0) continue;

          let rebuilt: Array<{ expense_id: string; user_id: string; share_cents: number; percentage: number | null }> = [];
          if (expense.split_method === "percentage") {
            const totalPct = remaining.reduce((sum, s) => sum + (s.percentage ?? 0), 0);
            const normalized = totalPct > 0
              ? remaining.map((s) => ({ user_id: s.user_id, pct: ((s.percentage ?? 0) / totalPct) * 100 }))
              : remaining.map((s) => ({ user_id: s.user_id, pct: 100 / remaining.length }));

            let allocated = 0;
            rebuilt = normalized.map((row, index) => {
              const share = index === normalized.length - 1
                ? expense.amount_cents - allocated
                : Math.round(expense.amount_cents * (row.pct / 100));
              allocated += share;
              return {
                expense_id: expense.id,
                user_id: row.user_id,
                share_cents: share,
                percentage: Number(row.pct.toFixed(4)),
              };
            });
          } else {
            const remainingTotalShares = remaining.reduce((sum, s) => sum + s.share_cents, 0);
            const weights = remainingTotalShares > 0
              ? remaining.map((s) => ({ user_id: s.user_id, weight: s.share_cents / remainingTotalShares }))
              : remaining.map((s) => ({ user_id: s.user_id, weight: 1 / remaining.length }));

            let allocated = 0;
            rebuilt = weights.map((row, index) => {
              const share = index === weights.length - 1
                ? expense.amount_cents - allocated
                : Math.round(expense.amount_cents * row.weight);
              allocated += share;
              return {
                expense_id: expense.id,
                user_id: row.user_id,
                share_cents: share,
                percentage: null,
              };
            });
          }

          const { error: deleteSplitsError } = await admin
            .from("expense_splits")
            .delete()
            .eq("expense_id", expense.id);
          if (deleteSplitsError) return jsonResponse(req, { error: deleteSplitsError.message }, 400);

          const { error: insertSplitsError } = await admin
            .from("expense_splits")
            .insert(rebuilt);
          if (insertSplitsError) return jsonResponse(req, { error: insertSplitsError.message }, 400);
        }
      }
    }

    if (toAdd.length > 0) {
      const { error: addError } = await admin
        .from("event_participants")
        .insert(
          toAdd.map((userId) => ({
            event_id: event.id,
            user_id: userId,
            status: userId === event.created_by ? "going" : "pending",
          })),
        );
      if (addError) return jsonResponse(req, { error: addError.message }, 400);
    }

    if (removeParticipantRowIds.length > 0) {
      const { error: removeError } = await admin
        .from("event_participants")
        .delete()
        .in("id", removeParticipantRowIds);
      if (removeError) return jsonResponse(req, { error: removeError.message }, 400);
    }

    await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: event.group_id,
      event_id: event.id,
      entity_type: "event",
      entity_id: event.id,
      action: "event_updated",
      payload: {
        title,
        description: body.description || null,
        participants_count: participantUserIds.length,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate ? endsAtDate.toISOString() : null,
      },
    });

    return jsonResponse(req, { success: true });
  } catch (err) {
    return jsonResponse(req, 
      { error: "Unexpected server error", details: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
