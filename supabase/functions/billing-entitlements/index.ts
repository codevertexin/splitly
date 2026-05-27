import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";

const APP_CODE = "SPLITLY";

type EntitlementRow = {
  entitlement_key: string;
  active: boolean;
  expires_at?: string | null;
};

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

function normalizeEntitlements(payload: unknown): EntitlementRow[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list = Array.isArray(root.entitlements)
    ? root.entitlements
    : Array.isArray((root.data as Record<string, unknown> | undefined)?.entitlements)
    ? (root.data as { entitlements: unknown[] }).entitlements
    : Array.isArray(root.items)
    ? root.items
    : [];

  const out: EntitlementRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key =
      (typeof row.entitlement_key === "string" && row.entitlement_key) ||
      (typeof row.feature_key === "string" && row.feature_key) ||
      (typeof row.key === "string" && row.key) ||
      "";
    if (!key) continue;
    const active =
      row.active === true ||
      row.is_active === true ||
      row.status === "active";
    out.push({
      entitlement_key: key,
      active,
      expires_at:
        typeof row.expires_at === "string" ? row.expires_at : null,
    });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflightResponse(req);
  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(req, { error: "Missing auth", code: "missing_auth" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return json(req, { error: "Unauthorized", code: "unauthorized" }, 401);
  }

  const { data: profile } = await userClient
    .from("profiles")
    .select("codevertex_user_id")
    .eq("id", user.id)
    .maybeSingle();

  const codevertexUserId =
    typeof profile?.codevertex_user_id === "string"
      ? profile.codevertex_user_id.trim()
      : "";

  const billingBase = (Deno.env.get("BILLING_CORE_URL") ??
    Deno.env.get("VITE_BILLING_BASE_URL") ??
    "https://billing.codevertex.cc").replace(/\/+$/, "");

  const entitlementsUrl = new URL(`${billingBase}/api/v1/entitlements`);
  entitlementsUrl.searchParams.set("app_code", APP_CODE);
  if (codevertexUserId) {
    entitlementsUrl.searchParams.set("codevertex_user_id", codevertexUserId);
  }

  const billingHeaders: Record<string, string> = {
    Authorization: authHeader,
    "Content-Type": "application/json",
  };
  const serviceToken = Deno.env.get("BILLING_SERVICE_TOKEN")?.trim();
  if (serviceToken) {
    billingHeaders["X-Billing-Service-Token"] = serviceToken;
  }

  try {
    const billingRes = await fetch(entitlementsUrl.toString(), {
      method: "GET",
      headers: billingHeaders,
    });

    if (!billingRes.ok) {
      const text = await billingRes.text().catch(() => "");
      console.error("billing-entitlements upstream:", billingRes.status, text.slice(0, 500));
      return json(req, {
        entitlements: [],
        tier: "free",
        upstream_status: billingRes.status,
        warning: "billing_core_unavailable",
      });
    }

    const payload = await billingRes.json();
    const entitlements = normalizeEntitlements(payload);
    return json(req, { entitlements, ok: true });
  } catch (err) {
    console.error("billing-entitlements:", err);
    return json(req, {
      entitlements: [],
      tier: "free",
      warning: "billing_core_error",
    });
  }
});
