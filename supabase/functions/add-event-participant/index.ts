import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AddEventParticipantBody = {
  event_id: string;
  user_id: string;
  status?: "going" | "pending" | "not_going";
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
    const body = (await req.json()) as AddEventParticipantBody;

    if (!body.event_id || !body.user_id) {
      return jsonResponse(req, { error: "Missing event_id or user_id" }, 400);
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

    // Só o criador ou quem já está na lista de participantes pode convidar outros.
    if (event.created_by !== user.id) {
      const { data: actorInEvent } = await admin
        .from("event_participants")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!actorInEvent) {
        return jsonResponse(req, { error: "Only the organizer or invited participants can add people" }, 403);
      }
    }

    const { data: targetMembership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", event.group_id)
      .eq("user_id", body.user_id)
      .eq("status", "active")
      .maybeSingle();
    if (!targetMembership) return jsonResponse(req, { error: "Participant must be an active group member" }, 400);

    const targetStatus = body.status ?? "pending";

    const { data: existing, error: existingError } = await admin
      .from("event_participants")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", body.user_id)
      .maybeSingle();
    if (existingError) return jsonResponse(req, { error: existingError.message }, 400);

    if (existing?.id) {
      const { error: updateError } = await admin
        .from("event_participants")
        .update({ status: targetStatus })
        .eq("id", existing.id);
      if (updateError) return jsonResponse(req, { error: updateError.message }, 400);
    } else {
      const { error: insertError } = await admin.from("event_participants").insert({
        event_id: event.id,
        user_id: body.user_id,
        status: targetStatus,
      });
      if (insertError) return jsonResponse(req, { error: insertError.message }, 400);
    }

    await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: event.group_id,
      event_id: event.id,
      entity_type: "event_participant",
      entity_id: body.user_id,
      action: "event_participant_added",
      payload: { participant_user_id: body.user_id, status: targetStatus },
    });

    return jsonResponse(req, { success: true });
  } catch (err) {
    return jsonResponse(req, 
      { error: "Unexpected server error", details: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
