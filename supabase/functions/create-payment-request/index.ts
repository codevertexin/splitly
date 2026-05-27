import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

type CreatePaymentRequestBody = {
  group_id?: string;
  target_user_id?: string;
  amount_cents?: number;
  currency?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
      return preflightResponse(req);
    }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(req, { error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse(req, 
        { error: "Server misconfiguration: missing Supabase env vars" },
        500,
      );
    }

    // Client bound to the caller's JWT to identify the current user
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser();

    if (userError || !user) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as CreatePaymentRequestBody;

    const groupId = body.group_id?.trim();
    const targetUserId = body.target_user_id?.trim();
    const amountCents = body.amount_cents;
    const currency = (body.currency?.trim() || "EUR").toUpperCase();

    if (!groupId) {
      return jsonResponse(req, { error: "Missing group_id" }, 400);
    }

    if (!targetUserId) {
      return jsonResponse(req, { error: "Missing target_user_id" }, 400);
    }

    if (!Number.isInteger(amountCents) || (amountCents ?? 0) <= 0) {
      return jsonResponse(req, 
        { error: "amount_cents must be a positive integer" },
        400,
      );
    }

    if (targetUserId === user.id) {
      return jsonResponse(req, 
        { error: "Cannot send a payment request to yourself" },
        400,
      );
    }

    // Service role client for trusted reads/inserts
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Validate group existence and get group name
    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, name")
      .eq("id", groupId)
      .is("archived_at", null)
      .maybeSingle();

    if (groupError) {
      return jsonResponse(req, 
        { error: "Failed to validate group", details: groupError.message },
        500,
      );
    }

    if (!group) {
      return jsonResponse(req, { error: "Group not found" }, 404);
    }

    // Validate requester membership
    const { data: requesterMembership, error: requesterMembershipError } =
      await supabaseAdmin
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

    if (requesterMembershipError) {
      return jsonResponse(req, 
        {
          error: "Failed to validate requester membership",
          details: requesterMembershipError.message,
        },
        500,
      );
    }

    if (!requesterMembership) {
      return jsonResponse(req, 
        { error: "You are not an active member of this group" },
        403,
      );
    }

    // Validate target membership
    const { data: targetMembership, error: targetMembershipError } =
      await supabaseAdmin
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", targetUserId)
        .eq("status", "active")
        .maybeSingle();

    if (targetMembershipError) {
      return jsonResponse(req, 
        {
          error: "Failed to validate target membership",
          details: targetMembershipError.message,
        },
        500,
      );
    }

    if (!targetMembership) {
      return jsonResponse(req, 
        { error: "Target user is not an active member of this group" },
        403,
      );
    }

    // Optional: fetch requester display name for nicer notification copy
    const { data: requesterProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", user.id)
      .maybeSingle();

    const requesterName =
      requesterProfile?.full_name?.trim() ||
      requesterProfile?.username?.trim() ||
      "Someone";

    const amountFormatted = new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency,
    }).format(amountCents / 100);

    const title = `${requesterName} requested ${amountFormatted}`;
    const bodyText = `Related to the group "${group.name}"`;

    const { data: notification, error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: targetUserId,
        type: "payment_request",
        title,
        body: bodyText,
        cta_label: "View group",
        cta_url: `/groups/${groupId}`,
        entity_type: "group",
        entity_id: groupId,
        data: {
          requester_user_id: user.id,
          requester_name: requesterName,
          target_user_id: targetUserId,
          group_id: groupId,
          group_name: group.name,
          amount_cents: amountCents,
          currency,
        },
      })
      .select("id")
      .single();

    if (notificationError) {
      return jsonResponse(req, 
        {
          error: "Failed to create payment request notification",
          details: notificationError.message,
        },
        500,
      );
    }

    // Optional audit event
    await supabaseAdmin.from("audit_events").insert({
      actor_user_id: user.id,
      group_id: groupId,
      entity_type: "notification",
      entity_id: notification.id,
      action: "payment_request_created",
      payload: {
        target_user_id: targetUserId,
        amount_cents: amountCents,
        currency,
      },
    });

    return jsonResponse(req, {
      success: true,
      notification_id: notification.id,
    });
  } catch (error) {
    console.error("create-payment-request error:", error);
    return jsonResponse(req, 
      {
        error: "Unexpected server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});