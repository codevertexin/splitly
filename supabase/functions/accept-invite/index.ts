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

    const { token } = await req.json();

    const { data: invite } = await admin
      .from("group_invites")
      .select("*")
      .eq("token", token)
      .single();

    if (!invite) {
      return jsonResponse({ error: "Invalid invite" }, 404);
    }

    if (invite.status !== "pending") {
      return jsonResponse({ error: "Invite already used" }, 400);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return jsonResponse({ error: "Invite expired" }, 400);
    }

    // adicionar ao grupo
    await admin.from("group_members").insert({
      group_id: invite.group_id,
      user_id: user.id,
      role: "member",
      status: "active",
    });

    // marcar como aceite
    await admin
      .from("group_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    const inviterId = invite.invited_by as string;
    if (inviterId && inviterId !== user.id) {
      await admin.from("user_contacts").upsert(
        [
          {
            owner_user_id: inviterId,
            contact_user_id: user.id,
            source: "group_invite",
            category: "friend",
            status: "active",
          },
          {
            owner_user_id: user.id,
            contact_user_id: inviterId,
            source: "group_invite",
            category: "friend",
            status: "active",
          },
        ],
        {
          onConflict: "owner_user_id,contact_user_id",
          ignoreDuplicates: true,
        },
      );
    }

    return jsonResponse({
      success: true,
      group_id: invite.group_id,
    });
  } catch (err) {
    return jsonResponse({
      error: "Server error",
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});