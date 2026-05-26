import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_CODE = "SPLITLY";
const SSO_PLACEHOLDER_EMAIL_DOMAIN = "sso.codevertex.local";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PocErrorBody = {
  ok: false;
  step: string;
  code: string;
  message: string;
};

type CoreProfile = {
  id?: string;
  email?: string | null;
  full_name?: string | null;
  username?: string | null;
  preferred_language?: string | null;
  avatar_url?: string | null;
  timezone?: string | null;
  default_currency?: string | null;
};

type AppMembership = {
  app_code?: string;
  app?: string;
  status?: string;
};

type ConsumeTicketResponse = {
  ok?: boolean;
  profile?: CoreProfile;
  memberships?: AppMembership[];
  app_memberships?: AppMembership[];
  message?: string;
  error?: string;
};

type LocalProfileRow = {
  id: string;
  codevertex_user_id: string | null;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  preferred_language: string | null;
  timezone: string | null;
  default_currency: string;
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

function fail(step: string, code: string, message: string, status = 400) {
  const body: PocErrorBody = { ok: false, step, code, message };
  return jsonResponse(body, status);
}

function requireEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value || null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveEmail(profile: CoreProfile, codevertexUserId: string): string {
  const fromCore = profile.email?.trim();
  if (fromCore) return fromCore;
  return `${codevertexUserId}@${SSO_PLACEHOLDER_EMAIL_DOMAIN}`;
}

function listMemberships(payload: ConsumeTicketResponse): AppMembership[] {
  if (Array.isArray(payload.memberships)) return payload.memberships;
  if (Array.isArray(payload.app_memberships)) return payload.app_memberships;
  return [];
}

function validateSplitlyMembership(payload: ConsumeTicketResponse): string | null {
  const memberships = listMemberships(payload);
  if (memberships.length === 0) return null;

  const splitly = memberships.find((m) => {
    const code = (m.app_code ?? m.app ?? "").toUpperCase();
    return code === APP_CODE;
  });

  if (!splitly) {
    return `No ${APP_CODE} app membership in Auth Core payload`;
  }

  const status = (splitly.status ?? "").toLowerCase();
  if (status !== "active") {
    return `${APP_CODE} membership is not active (status: ${splitly.status ?? "unknown"})`;
  }

  return null;
}

function buildUserMetadata(profile: CoreProfile, codevertexUserId: string) {
  return {
    codevertex_user_id: codevertexUserId,
    full_name: profile.full_name ?? null,
    username: profile.username ?? null,
    preferred_language: profile.preferred_language ?? null,
    avatar_url: profile.avatar_url ?? null,
  };
}

function buildProfileInsert(
  authUserId: string,
  codevertexUserId: string,
  profile: CoreProfile,
) {
  return {
    id: authUserId,
    codevertex_user_id: codevertexUserId,
    username: profile.username ?? null,
    full_name: profile.full_name ?? null,
    avatar_url: profile.avatar_url ?? null,
    preferred_language: profile.preferred_language ?? "en",
    default_currency: profile.default_currency ?? "EUR",
    timezone: profile.timezone ?? "UTC",
  };
}

/** Only fields present and non-null on Core overwrite local values. */
function buildNonDestructiveProfilePatch(
  local: LocalProfileRow,
  profile: CoreProfile,
): Record<string, string> {
  const patch: Record<string, string> = {};

  if (profile.full_name != null && profile.full_name !== local.full_name) {
    patch.full_name = profile.full_name;
  }
  if (profile.username != null && profile.username !== local.username) {
    patch.username = profile.username;
  }
  if (profile.avatar_url != null && profile.avatar_url !== local.avatar_url) {
    patch.avatar_url = profile.avatar_url;
  }
  if (
    profile.preferred_language != null &&
    profile.preferred_language !== local.preferred_language
  ) {
    patch.preferred_language = profile.preferred_language;
  }
  if (profile.timezone != null && profile.timezone !== local.timezone) {
    patch.timezone = profile.timezone;
  }
  if (
    profile.default_currency != null &&
    profile.default_currency !== local.default_currency
  ) {
    patch.default_currency = profile.default_currency;
  }

  return patch;
}

async function consumeSsoTicket(
  codevertexUrl: string,
  codevertexAnonKey: string,
  ticket: string,
): Promise<{ data?: ConsumeTicketResponse; error?: PocErrorBody }> {
  const endpoint = `${codevertexUrl.replace(/\/+$/, "")}/functions/v1/consume-sso-ticket`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: codevertexAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket,
        app_code: APP_CODE,
      }),
    });
  } catch (err) {
    return {
      error: {
        ok: false,
        step: "consume_ticket",
        code: "network_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  let payload: ConsumeTicketResponse;
  try {
    payload = await response.json() as ConsumeTicketResponse;
  } catch {
    return {
      error: {
        ok: false,
        step: "consume_ticket",
        code: "invalid_json",
        message: `Auth Core returned non-JSON (HTTP ${response.status})`,
      },
    };
  }

  if (!response.ok) {
    return {
      error: {
        ok: false,
        step: "consume_ticket",
        code: `http_${response.status}`,
        message: payload.message ?? payload.error ?? `Auth Core HTTP ${response.status}`,
      },
    };
  }

  return { data: payload };
}

async function createSessionViaMagicLink(
  admin: SupabaseClient,
  anon: SupabaseClient,
  email: string,
): Promise<
  | {
    access_token: string;
    refresh_token: string;
  }
  | { error: PocErrorBody }
> {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError) {
    return {
      error: {
        ok: false,
        step: "generate_link",
        code: "generate_link_failed",
        message: linkError.message,
      },
    };
  }

  const tokenHash = linkData?.properties?.hashed_token;
  if (!isNonEmptyString(tokenHash)) {
    return {
      error: {
        ok: false,
        step: "generate_link",
        code: "missing_token_hash",
        message: "generateLink did not return properties.hashed_token",
      },
    };
  }

  const { data: sessionData, error: verifyError } = await anon.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });

  if (verifyError) {
    return {
      error: {
        ok: false,
        step: "verify_otp",
        code: "verify_otp_failed",
        message: verifyError.message,
      },
    };
  }

  const accessToken = sessionData.session?.access_token;
  const refreshToken = sessionData.session?.refresh_token;

  if (!accessToken || !refreshToken) {
    return {
      error: {
        ok: false,
        step: "verify_otp",
        code: "missing_session",
        message: "verifyOtp succeeded but session tokens are missing",
      },
    };
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("request", "method_not_allowed", "Only POST is supported", 405);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const codevertexUrl = requireEnv("CODEVERTEX_SUPABASE_URL");
  const codevertexAnonKey = requireEnv("CODEVERTEX_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey || !codevertexUrl || !codevertexAnonKey) {
    return fail(
      "env",
      "missing_secrets",
      "Missing one or more required secrets (SUPABASE_* or CODEVERTEX_*)",
      500,
    );
  }

  let body: { ticket?: unknown };
  try {
    body = await req.json() as { ticket?: unknown };
  } catch {
    return fail("validate_body", "invalid_json", "Request body must be JSON");
  }

  const ticket = body.ticket;
  if (!isNonEmptyString(ticket)) {
    return fail("validate_body", "ticket_required", "Field ticket must be a non-empty string");
  }

  const consumeResult = await consumeSsoTicket(codevertexUrl, codevertexAnonKey, ticket);
  if (consumeResult.error) {
    return jsonResponse(consumeResult.error, 502);
  }

  const corePayload = consumeResult.data!;
  if (corePayload.ok !== true) {
    return fail(
      "validate_core",
      "core_not_ok",
      corePayload.message ?? corePayload.error ?? "Auth Core ok !== true",
    );
  }

  const coreProfile = corePayload.profile;
  if (!coreProfile?.id || !isNonEmptyString(coreProfile.id)) {
    return fail("validate_core", "missing_profile_id", "Auth Core profile.id is required");
  }

  const membershipError = validateSplitlyMembership(corePayload);
  if (membershipError) {
    return fail("validate_core", "membership_inactive", membershipError);
  }

  const codevertexUserId = coreProfile.id.trim();
  const email = resolveEmail(coreProfile, codevertexUserId);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existingProfile, error: findError } = await admin
    .from("profiles")
    .select(
      "id, codevertex_user_id, username, full_name, avatar_url, preferred_language, timezone, default_currency",
    )
    .eq("codevertex_user_id", codevertexUserId)
    .maybeSingle();

  if (findError) {
    return fail("find_profile", "db_error", findError.message, 500);
  }

  let localUserId: string;

  if (existingProfile) {
    localUserId = existingProfile.id as string;

    const patch = buildNonDestructiveProfilePatch(
      existingProfile as LocalProfileRow,
      coreProfile,
    );
    if (Object.keys(patch).length > 0) {
      const { error: syncError } = await admin
        .from("profiles")
        .update(patch)
        .eq("id", localUserId);

      if (syncError) {
        return fail("sync_profile", "db_error", syncError.message, 500);
      }
    }
  } else {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: buildUserMetadata(coreProfile, codevertexUserId),
    });

    if (createUserError || !createdUser.user) {
      return fail(
        "create_auth_user",
        "create_user_failed",
        createUserError?.message ?? "auth.admin.createUser returned no user",
        500,
      );
    }

    localUserId = createdUser.user.id;

    const { error: insertProfileError } = await admin
      .from("profiles")
      .insert(buildProfileInsert(localUserId, codevertexUserId, coreProfile));

    if (insertProfileError) {
      return fail("create_profile", "db_error", insertProfileError.message, 500);
    }
  }

  const sessionResult = await createSessionViaMagicLink(admin, anon, email);
  if ("error" in sessionResult) {
    const status = sessionResult.error.step === "verify_otp" ? 502 : 500;
    return jsonResponse(sessionResult.error, status);
  }

  return jsonResponse({
    ok: true,
    local_user_id: localUserId,
    codevertex_user_id: codevertexUserId,
    email,
    has_session: true,
    access_token: sessionResult.access_token,
    refresh_token: sessionResult.refresh_token,
  });
});
