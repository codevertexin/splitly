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

type ConfirmSettlementRequestBody = {
  notification_id?: string;
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

    const body = (await req.json()) as ConfirmSettlementRequestBody;
    const notificationId = body.notification_id?.trim();

    if (!notificationId) {
      return jsonResponse(req, { error: "Missing notification_id" }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: notification, error: notificationError } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (notificationError) {
      return jsonResponse(req, 
        {
          error: "Failed to load notification",
          details: notificationError.message,
        },
        500,
      );
    }

    if (!notification) {
      return jsonResponse(req, { error: "Notification not found" }, 404);
    }

    if (notification.type !== "settlement_confirmation_request") {
      return jsonResponse(req, 
        { error: "Notification is not a settlement confirmation request" },
        400,
      );
    }

    const payload = notification.data || {};
    const status = payload.status;

    if (status && status !== "pending") {
      return jsonResponse(req, 
        { error: `Request already ${status}` },
        400,
      );
    }

    const requesterUserId = payload.requester_user_id as string | undefined;
    const requesterName = payload.requester_name as string | undefined;
    const groupId = payload.group_id as string | undefined;
    const groupName = payload.group_name as string | undefined;
    const amountCents = payload.amount_cents as number | undefined;
    const currency = (payload.currency as string | undefined) || "EUR";

    if (!requesterUserId || !groupId || !Number.isInteger(amountCents) || amountCents <= 0) {
      return jsonResponse(req, 
        { error: "Notification payload is incomplete" },
        400,
      );
    }

    const nowIso = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("settlements")
      .select("id")
      .eq("group_id", groupId)
      .eq("from_user_id", requesterUserId)
      .eq("to_user_id", user.id)
      .eq("amount_cents", amountCents)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      const { error: updateDupError } = await supabaseAdmin
        .from("notifications")
        .update({
          is_read: true,
          read_at: nowIso,
          data: {
            ...payload,
            status: "confirmed",
            confirmed_at: nowIso,
            settlement_id: existing.id,
            confirmed_by_user_id: user.id,
            deduped: true,
          },
        })
        .eq("id", notificationId)
        .eq("user_id", user.id);

      if (updateDupError) {
        return jsonResponse(req, 
          {
            error: "Settlement exists but failed to update notification",
            details: updateDupError.message,
          },
          500,
        );
      }

      return jsonResponse(req, {
        success: true,
        settlement_id: existing.id,
        deduped: true,
      });
    }

    const { data: settlement, error: settlementError } = await supabaseAdmin
      .from("settlements")
      .insert({
        group_id: groupId,
        event_id: null,
        from_user_id: requesterUserId,
        to_user_id: user.id,
        amount_cents: amountCents,
        currency,
        settled_at: nowIso,
        note: "Confirmed via settlement confirmation request",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (settlementError) {
      return jsonResponse(req, 
        {
          error: "Failed to create settlement",
          details: settlementError.message,
        },
        500,
      );
    }

    const { error: updateNotificationError } = await supabaseAdmin
      .from("notifications")
      .update({
        is_read: true,
        read_at: nowIso,
        data: {
          ...payload,
          status: "confirmed",
          confirmed_at: nowIso,
          settlement_id: settlement.id,
          confirmed_by_user_id: user.id,
        },
      })
      .eq("id", notificationId)
      .eq("user_id", user.id);

    if (updateNotificationError) {
      return jsonResponse(req, 
        {
          error: "Settlement created but failed to update notification",
          details: updateNotificationError.message,
        },
        500,
      );
    }

    // Optional: notify requester that the payment was confirmed
    await supabaseAdmin.from("notifications").insert({
      user_id: requesterUserId,
      type: "settlement_confirmed",
      title: `${user.user_metadata?.full_name || "A member"} confirmed receipt`,
      body: groupName
        ? `Your payment in "${groupName}" was confirmed.`
        : "Your payment was confirmed.",
      cta_label: "View group",
      cta_url: `/groups/${groupId}`,
      entity_type: "group",
      entity_id: groupId,
      data: {
        kind: "settlement_confirmed",
        settlement_id: settlement.id,
        confirmed_by_user_id: user.id,
        requester_name: requesterName || null,
        amount_cents: amountCents,
        currency,
        group_id: groupId,
      },
    });

    return jsonResponse(req, {
      success: true,
      settlement_id: settlement.id,
    });
  } catch (error) {
    console.error("confirm-settlement-request error:", error);
    return jsonResponse(req, 
      {
        error: "Unexpected server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});