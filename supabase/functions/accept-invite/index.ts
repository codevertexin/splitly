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
      return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing auth", code: "missing_auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return jsonResponse({ error: "Unauthorized", code: "unauthorized" }, 401);
    }

    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body", code: "invalid_body" }, 400);
    }

    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return jsonResponse({ error: "Missing token", code: "missing_token" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: invite, error: inviteError } = await admin
      .from("group_invites")
      .select("id, group_id, status, expires_at, invited_by, token")
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      console.error("accept-invite lookup:", inviteError);
      return jsonResponse({ error: "Could not validate invite", code: "lookup_failed" }, 500);
    }

    if (!invite) {
      return jsonResponse({ error: "Invalid or unknown invite link", code: "invalid_invite" }, 404);
    }

    const { data: existingMember } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", invite.group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    const markAccepted = async () => {
      if (invite.status === "pending") {
        await admin.from("group_invites").update({ status: "accepted" }).eq("id", invite.id);
      }
    };

    const syncContacts = async () => {
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
    };

    if (existingMember) {
      await markAccepted();
      await syncContacts();
      return jsonResponse({
        success: true,
        group_id: invite.group_id,
        status: "already_member",
      });
    }

    if (invite.status === "pending" && new Date(invite.expires_at) < new Date()) {
      return jsonResponse({ error: "This invite has expired", code: "invite_expired" }, 400);
    }

    if (invite.status !== "pending") {
      return jsonResponse({ error: "This invite link is no longer valid", code: "invite_used" }, 400);
    }

    const { error: insertError } = await admin.from("group_members").insert({
      group_id: invite.group_id,
      user_id: user.id,
      role: "member",
      status: "active",
    });

    if (insertError) {
      const msg = insertError.message || "";
      if (msg.includes("duplicate") || msg.includes("unique") || insertError.code === "23505") {
        await markAccepted();
        await syncContacts();
        return jsonResponse({
          success: true,
          group_id: invite.group_id,
          status: "already_member",
        });
      }
      console.error("accept-invite insert:", insertError);
      return jsonResponse({ error: "Could not join group", code: "join_failed", details: msg }, 500);
    }

    await markAccepted();
    await syncContacts();

    return jsonResponse({
      success: true,
      group_id: invite.group_id,
      status: "joined",
    });
  } catch (err) {
    console.error("accept-invite:", err);
    return jsonResponse({
      error: "Server error",
      code: "server_error",
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
