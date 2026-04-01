import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type CreateEventBody = {
  group_id: string;
  title: string;
  description?: string | null;
  participant_ids?: string[];
  status?: "draft" | "open" | "closed";
  starts_at: string;
  ends_at?: string | null;
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

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
    }

    // Validar user explicitamente com o token
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse(
        {
          error: "Unauthorized",
          details: userError?.message ?? "Could not resolve authenticated user",
        },
        401
      );
    }

    // Admin client para writes controlados
    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as CreateEventBody;

    const groupId = body.group_id;
    const title = body.title?.trim();
    const description = body.description || null;
    const requestedParticipants = Array.isArray(body.participant_ids) ? body.participant_ids : [];
    const status = body.status === "draft" || body.status === "closed" ? body.status : "open";
    const startsAt = body.starts_at;
    const endsAt = body.ends_at ?? null;

    if (!groupId) {
      return jsonResponse({ error: "Missing group_id" }, 400);
    }

    if (!title || title.length < 2) {
      return jsonResponse({ error: "Invalid title" }, 400);
    }

    if (!startsAt) {
      return jsonResponse({ error: "Missing starts_at" }, 400);
    }

    const startsAtDate = new Date(startsAt);
    if (Number.isNaN(startsAtDate.getTime())) {
      return jsonResponse({ error: "Invalid starts_at" }, 400);
    }

    let endsAtDate: Date | null = null;
    if (endsAt) {
      endsAtDate = new Date(endsAt);
      if (Number.isNaN(endsAtDate.getTime())) {
        return jsonResponse({ error: "Invalid ends_at" }, 400);
      }
      if (endsAtDate.getTime() < startsAtDate.getTime()) {
        return jsonResponse({ error: "ends_at must be greater than or equal to starts_at" }, 400);
      }
    }

    // Confirmar que o actor é membro ativo do grupo
    const { data: actorMembership, error: actorMembershipError } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (actorMembershipError) {
      return jsonResponse(
        {
          error: "Failed to validate actor membership",
          details: actorMembershipError.message,
        },
        400
      );
    }

    if (!actorMembership) {
      return jsonResponse({ error: "You are not an active member of this group" }, 403);
    }

    // Garantir que o criador entra sempre como participante
    const participantIds = Array.from(new Set([user.id, ...requestedParticipants]));
    if (participantIds.length === 0) {
      return jsonResponse({ error: "At least one participant is required" }, 400);
    }

    // Validar que todos os participantes são membros ativos do grupo
    const { data: activeMembers, error: activeMembersError } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "active");

    if (activeMembersError) {
      return jsonResponse(
        {
          error: "Failed to validate participants",
          details: activeMembersError.message,
        },
        400
      );
    }

    const validMemberIds = new Set((activeMembers || []).map((m) => m.user_id));
    const invalidParticipant = participantIds.find((id) => !validMemberIds.has(id));
    if (invalidParticipant) {
      return jsonResponse({ error: "One or more participants are not active group members" }, 400);
    }

    // Criar evento
    const { data: event, error: eventError } = await admin
      .from("events")
      .insert({
        group_id: groupId,
        title,
        description,
        created_by: user.id,
        status,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate ? endsAtDate.toISOString() : null,
      })
      .select()
      .single();

    if (eventError || !event) {
      return jsonResponse(
        {
          error: "Failed to create event",
          details: eventError?.message,
        },
        400
      );
    }

    // Inserir participantes
    const participantsRows = participantIds.map((uid) => ({
      event_id: event.id,
      user_id: uid,
      status: uid === user.id ? "going" : "pending",
    }));

    const { error: participantsError } = await admin
      .from("event_participants")
      .insert(participantsRows);

    if (participantsError) {
      return jsonResponse(
        {
          error: "Failed to insert participants",
          details: participantsError.message,
        },
        400
      );
    }

    // Audit
    const { error: auditError } = await admin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: groupId,
      event_id: event.id,
      entity_type: "event",
      entity_id: event.id,
      action: "event_created",
      payload: {
        title,
        participants_count: participantIds.length,
        status,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate ? endsAtDate.toISOString() : null,
      },
    });

    if (auditError) {
      console.warn("Audit event failed:", auditError.message);
    }

    return jsonResponse({
      success: true,
      event,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(
      {
        error: "Unexpected error",
        details: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});