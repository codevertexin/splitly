import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CloseEventBody = {
  event_id: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

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
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as CloseEventBody;
    if (!body.event_id) return jsonResponse({ error: "Missing event_id" }, 400);

    const { data: event, error: eventError } = await admin
      .from("events")
      .select("id, group_id, status, created_by")
      .eq("id", body.event_id)
      .maybeSingle();
    if (eventError || !event) return jsonResponse({ error: "Event not found" }, 404);

    const { data: actorMembership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", event.group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!actorMembership) return jsonResponse({ error: "You are not an active member of this group" }, 403);

    if (event.created_by !== user.id) {
      return jsonResponse({ error: "Only the event creator can close this event" }, 403);
    }
    if (event.status === "closed") {
      return jsonResponse({ success: true });
    }

    const { data: draftExpenses, error: draftExpensesError } = await admin
      .from("expenses")
      .select("id")
      .eq("event_id", event.id)
      .eq("status", "draft")
      .is("deleted_at", null);
    if (draftExpensesError) return jsonResponse({ error: draftExpensesError.message }, 400);
    if ((draftExpenses || []).length > 0) {
      return jsonResponse(
        { error: "There are still draft expenses in this event. Confirm or remove them before closing the event." },
        400,
      );
    }

    const nowIso = new Date().toISOString();
    const { error: closeError } = await admin
      .from("events")
      .update({ status: "closed", closed_at: nowIso })
      .eq("id", event.id);
    if (closeError) return jsonResponse({ error: closeError.message }, 400);

    await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: event.group_id,
      event_id: event.id,
      entity_type: "event",
      entity_id: event.id,
      action: "event_closed",
      payload: { closed_at: nowIso },
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse(
      { error: "Unexpected server error", details: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
