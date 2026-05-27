import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      return jsonResponse(req, { error: "Missing auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const { inviter_id } = await req.json() as { inviter_id?: string };

    if (!inviter_id || typeof inviter_id !== "string") {
      return jsonResponse(req, { error: "inviter_id required" }, 400);
    }

    if (inviter_id === user.id) {
      return jsonResponse(req, { error: "Invalid inviter" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: inviterProfile, error: inviterErr } = await admin
      .from("profiles")
      .select("id")
      .eq("id", inviter_id)
      .maybeSingle();

    if (inviterErr || !inviterProfile) {
      return jsonResponse(req, { error: "Inviter not found" }, 404);
    }

    await admin.from("user_contacts").upsert(
      [
        {
          owner_user_id: inviter_id,
          contact_user_id: user.id,
          source: "app_share",
          category: "friend",
          status: "active",
        },
        {
          owner_user_id: user.id,
          contact_user_id: inviter_id,
          source: "app_share",
          category: "friend",
          status: "active",
        },
      ],
      {
        onConflict: "owner_user_id,contact_user_id",
        ignoreDuplicates: true,
      },
    );

    return jsonResponse(req, { success: true });
  } catch (err) {
    return jsonResponse(req, {
      error: "Server error",
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
