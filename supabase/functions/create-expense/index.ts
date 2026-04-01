import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SplitInput = {
  user_id: string;
  share_cents?: number;
  percentage?: number;
};

type CreateExpenseBody = {
  group_id: string;
  event_id?: string | null;
  title: string;
  description?: string | null;
  amount_cents: number;
  currency?: string;
  paid_by_user_id: string;
  split_method: "equal" | "manual" | "percentage" | "smart";
  participant_ids: string[];
  splits?: SplitInput[];
  status?: "draft" | "confirmed";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

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

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as CreateExpenseBody;

    const {
      group_id,
      event_id = null,
      title,
      description = null,
      amount_cents,
      currency = "EUR",
      paid_by_user_id,
      split_method,
      participant_ids,
      splits = [],
      status = "confirmed",
    } = body;

    if (!group_id) return jsonResponse({ error: "Missing group_id" }, 400);
    if (!title?.trim()) return jsonResponse({ error: "Missing title" }, 400);
    if (!amount_cents || amount_cents <= 0) return jsonResponse({ error: "Invalid amount_cents" }, 400);
    if (!paid_by_user_id) return jsonResponse({ error: "Missing paid_by_user_id" }, 400);
    if (!participant_ids?.length) return jsonResponse({ error: "At least one participant is required" }, 400);
    if (status !== "draft" && status !== "confirmed") {
      return jsonResponse({ error: "Invalid expense status" }, 400);
    }

    // validar membership do actor
    const { data: actorMembership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!actorMembership) {
      return jsonResponse({ error: "You are not a member of this group" }, 403);
    }

    // validar que payer pertence ao grupo
    const { data: payerMembership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("user_id", paid_by_user_id)
      .eq("status", "active")
      .maybeSingle();

    if (!payerMembership) {
      return jsonResponse({ error: "Payer is not a member of this group" }, 400);
    }

    // validar participantes
    const { data: memberships } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", group_id)
      .eq("status", "active");

    const validUserIds = new Set((memberships || []).map((m) => m.user_id));
    const invalidParticipant = participant_ids.find((id) => !validUserIds.has(id));

    if (invalidParticipant) {
      return jsonResponse({ error: "One or more participants are not valid group members" }, 400);
    }

    let splitRows: Array<{ user_id: string; share_cents: number; percentage: number | null }> = [];

    if (split_method === "equal") {
      const count = participant_ids.length;
      const baseShare = Math.floor(amount_cents / count);
      let remainder = amount_cents - baseShare * count;

      splitRows = participant_ids.map((user_id, index) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        return {
          user_id,
          share_cents: baseShare + extra,
          percentage: null,
        };
      });
    } else if (split_method === "manual") {
      if (!splits.length) {
        return jsonResponse({ error: "Manual split requires splits[]" }, 400);
      }

      const total = splits.reduce((sum, s) => sum + (s.share_cents || 0), 0);
      if (total !== amount_cents) {
        return jsonResponse({ error: "Manual splits must sum exactly to amount_cents" }, 400);
      }

      splitRows = splits.map((s) => ({
        user_id: s.user_id,
        share_cents: s.share_cents || 0,
        percentage: null,
      }));
    } else if (split_method === "percentage") {
      if (!splits.length) {
        return jsonResponse({ error: "Percentage split requires splits[]" }, 400);
      }

      const totalPct = splits.reduce((sum, s) => sum + (s.percentage || 0), 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        return jsonResponse({ error: "Percentages must sum to 100" }, 400);
      }

      let allocated = 0;
      splitRows = splits.map((s, index) => {
        if (index === splits.length - 1) {
          return {
            user_id: s.user_id,
            share_cents: amount_cents - allocated,
            percentage: s.percentage || 0,
          };
        }
        const share = Math.round(amount_cents * ((s.percentage || 0) / 100));
        allocated += share;
        return {
          user_id: s.user_id,
          share_cents: share,
          percentage: s.percentage || 0,
        };
      });
    } else {
      return jsonResponse({ error: "Smart split not implemented yet in V1" }, 400);
    }

    // validar user_ids dos splits
    for (const row of splitRows) {
      if (!validUserIds.has(row.user_id)) {
        return jsonResponse({ error: "Split contains invalid user_id" }, 400);
      }
    }

    const { data: expense, error: expenseError } = await admin
      .from("expenses")
      .insert({
        group_id,
        event_id,
        title: title.trim(),
        description,
        amount_cents,
        currency,
        paid_by_user_id,
        split_method,
        status,
        created_by: user.id,
      })
      .select()
      .single();

    if (expenseError || !expense) {
      return jsonResponse(
        { error: "Failed to create expense", details: expenseError?.message },
        400,
      );
    }

    const { error: splitsError } = await admin
      .from("expense_splits")
      .insert(
        splitRows.map((row) => ({
          expense_id: expense.id,
          user_id: row.user_id,
          share_cents: row.share_cents,
          percentage: row.percentage,
        })),
      );

    if (splitsError) {
      return jsonResponse(
        { error: "Expense created but failed to create splits", details: splitsError.message },
        400,
      );
    }

    await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id,
      event_id,
      entity_type: "expense",
      entity_id: expense.id,
      action: "expense_created",
      payload: {
        title,
        amount_cents,
        currency,
        paid_by_user_id,
        split_method,
        participants_count: participant_ids.length,
        status,
      },
    });

    return jsonResponse({
      success: true,
      expense,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(
      {
        error: "Unexpected server error",
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});