import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CreateGroupBody = {
  name: string;
  description?: string | null;
  base_currency?: string;
  /** Título do primeiro ciclo de despesas (batch ativo). Opcional: default "Cycle 1". */
  initial_cycle_title?: string | null;
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
    if (!authHeader) {
      return jsonResponse(req, { error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse(req, { error: "Missing Supabase environment variables" }, 500);
    }

    // Valida o utilizador real
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse(req, { error: "Unauthorized", details: userError?.message }, 401);
    }

    // Client admin para inserts controlados
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = (await req.json()) as CreateGroupBody;
    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const baseCurrency = body.base_currency?.trim() || "EUR";
    const initialCycleTitle =
      body.initial_cycle_title?.trim() || "Cycle 1";

    if (!name || name.length < 2) {
      return jsonResponse(req, { error: "Group name must have at least 2 characters" }, 400);
    }

    // 1) Criar grupo
    const { data: group, error: groupError } = await adminClient
      .from("groups")
      .insert({
        name,
        description,
        base_currency: baseCurrency,
        created_by: user.id,
      })
      .select()
      .single();

    if (groupError || !group) {
      return jsonResponse(req, 
        { error: "Failed to create group", details: groupError?.message },
        400,
      );
    }

    // 2) Adicionar criador como owner
    const { error: memberError } = await adminClient
      .from("group_members")
      .insert({
        group_id: group.id,
        user_id: user.id,
        role: "owner",
        status: "active",
      });

    if (memberError) {
      return jsonResponse(req, 
        {
          error: "Group created but failed to create owner membership",
          details: memberError.message,
        },
        400,
      );
    }

    // 3) Primeiro ciclo (batch ativo) — um por grupo
    const { error: batchError } = await adminClient.from("expense_batches").insert({
      group_id: group.id,
      title: initialCycleTitle,
      description: null,
      is_active: true,
      closed_at: null,
      created_by: user.id,
    });

    if (batchError) {
      return jsonResponse(req, 
        {
          error: "Group created but failed to create initial expense batch",
          details: batchError.message,
        },
        400,
      );
    }

    // 4) Audit event
    const { error: auditError } = await adminClient
      .from("audit_events")
      .insert({
        actor_user_id: user.id,
        group_id: group.id,
        entity_type: "group",
        entity_id: group.id,
        action: "group_created",
        payload: {
          name,
          base_currency: baseCurrency,
        },
      });

    if (auditError) {
      console.warn("Audit event failed:", auditError.message);
    }

    return jsonResponse(req, {
      success: true,
      group,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(req, 
      {
        error: "Unexpected server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});