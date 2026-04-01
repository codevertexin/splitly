import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      return jsonResponse({ error: "Missing auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { group_id } = await req.json();

    if (!group_id) {
      return jsonResponse({ error: "Missing group_id" }, 400);
    }

    // validar membership
    const { data: membership } = await admin
      .from("group_members")
      .select("*")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return jsonResponse({ error: "Not a member" }, 403);
    }

    // gerar token
    const token = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await admin.from("group_invites").insert({
      group_id,
      token,
      email: "link-invite",
      invited_by: user.id,
      expires_at: expiresAt.toISOString(),
      status: "pending",
    });

    const invite_link = `${req.headers.get("origin")}/invite/${token}`;

    return jsonResponse({
      success: true,
      invite_link,
    });
  } catch (err) {
    return jsonResponse({
      error: "Server error",
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});