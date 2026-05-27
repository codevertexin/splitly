import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_CODE = "SPLITLY";
const SSO_PLACEHOLDER_EMAIL_DOMAIN = "sso.codevertex.local";

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

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

function fail(req: Request, step: string, code: string, message: string, status = 400) {
  const body: PocErrorBody = { ok: false, step, code, message };
  return jsonResponse(req, body, status);
}

function requireEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value || null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Non-empty email from Auth Core (not placeholder). Required for email-based linking. */
function getCoreEmailForLinking(profile: CoreProfile): string | null {
  const raw = profile.email?.trim();
  if (!raw) return null;
  return raw;
}

function resolveEmail(profile: CoreProfile, codevertexUserId: string): string {
  const fromCore = profile.email?.trim();
  if (fromCore) return fromCore;
  return `${codevertexUserId}@${SSO_PLACEHOLDER_EMAIL_DOMAIN}`;
}

/** Exact identity for Auth Core vs local auth email (trim + lowercase). */
function emailsMatchForLinking(coreEmail: string, localEmail: string | undefined): boolean {
  if (!localEmail) return false;
  return coreEmail.trim().toLowerCase() === localEmail.trim().toLowerCase();
}

function isDuplicateEmailCreateUserError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; status?: number; code?: string };
  const msg = (e.message ?? "").toLowerCase();
  const code = (e.code ?? "").toLowerCase();
  return (
    e.status === 422 ||
    code === "email_exists" ||
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("user already registered") ||
    msg.includes("email address is already")
  );
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

/**
 * List auth user ids whose email matches Core email (trim + lowercase).
 * Stops scanning after 2 matches (ambiguous). Max pages bounded for safety.
 */
async function findAuthUserIdsByEmail(
  admin: SupabaseClient,
  coreEmailForCompare: string,
): Promise<{ ids: string[]; error?: PocErrorBody }> {
  const target = coreEmailForCompare.trim().toLowerCase();
  const ids: string[] = [];
  let page = 1;
  const perPage = 1000;
  const maxPages = 100;

  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return {
        ids: [],
        error: {
          ok: false,
          step: "list_auth_users",
          code: "admin_list_failed",
          message: error.message,
        },
      };
    }
    for (const u of data.users) {
      const em = u.email;
      if (em && em.trim().toLowerCase() === target) ids.push(u.id);
      if (ids.length > 1) return { ids };
    }
    if (data.users.length < perPage) break;
    page++;
  }
  return { ids };
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

/**
 * Link pre-SSO local auth user (same email, codevertex_user_id NULL) to this Core identity.
 */
async function linkExistingLocalUser(
  admin: SupabaseClient,
  coreProfile: CoreProfile,
  codevertexUserId: string,
): Promise<{ localUserId: string } | { error: PocErrorBody }> {
  const coreEmailRaw = getCoreEmailForLinking(coreProfile);
  if (!coreEmailRaw) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "link_requires_core_email",
        message: "Cannot link by email: Auth Core profile has no email",
      },
    };
  }

  const { ids: matchingAuthIds, error: listErr } = await findAuthUserIdsByEmail(
    admin,
    coreEmailRaw,
  );
  if (listErr) return { error: listErr };

  if (matchingAuthIds.length === 0) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "link_no_local_auth_user",
        message: "No local auth user found for this email after duplicate registration error",
      },
    };
  }

  if (matchingAuthIds.length > 1) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "ambiguous_local_account_linking",
        message: "Multiple local auth users share this email; cannot link safely",
      },
    };
  }

  const localUserId = matchingAuthIds[0]!;

  const { data: authUserData, error: getUserErr } = await admin.auth.admin.getUserById(
    localUserId,
  );
  if (getUserErr || !authUserData?.user) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "local_auth_user_not_found",
        message: getUserErr?.message ?? "auth.admin.getUserById returned no user",
      },
    };
  }

  const localAuthEmail = authUserData.user.email;
  if (!emailsMatchForLinking(coreEmailRaw, localAuthEmail)) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "email_mismatch",
        message: "Local auth email does not match Auth Core email",
      },
    };
  }

  const { data: localProfile, error: profileErr } = await admin
    .from("profiles")
    .select(
      "id, codevertex_user_id, username, full_name, avatar_url, preferred_language, timezone, default_currency",
    )
    .eq("id", localUserId)
    .maybeSingle();

  if (profileErr) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "db_error",
        message: profileErr.message,
      },
    };
  }

  if (!localProfile) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "link_missing_profile",
        message: "No profiles row for local auth user",
      },
    };
  }

  const row = localProfile as LocalProfileRow;
  const existingCv = row.codevertex_user_id?.trim() ?? null;

  if (existingCv && existingCv !== codevertexUserId) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "account_already_linked_to_different_codevertex_user",
        message: "This Splitly profile is already linked to another CodeVertex user",
      },
    };
  }

  if (existingCv === codevertexUserId) {
    const patch = buildNonDestructiveProfilePatch(row, coreProfile);
    if (Object.keys(patch).length > 0) {
      const { error: syncErr } = await admin.from("profiles").update(patch).eq("id", localUserId);
      if (syncErr) {
        return {
          error: {
            ok: false,
            step: "link_existing_local_user",
            code: "db_error",
            message: syncErr.message,
          },
        };
      }
    }
    console.log(
      JSON.stringify({
        step: "link_existing_local_user",
        mode: "already_linked_same_codevertex",
        local_user_id: localUserId,
        codevertex_user_id: codevertexUserId,
      }),
    );
    return { localUserId };
  }

  const patch = buildNonDestructiveProfilePatch(row, coreProfile);
  patch.codevertex_user_id = codevertexUserId;

  const { error: updateErr } = await admin.from("profiles").update(patch).eq("id", localUserId);
  if (updateErr) {
    return {
      error: {
        ok: false,
        step: "link_existing_local_user",
        code: "db_error",
        message: updateErr.message,
      },
    };
  }

  console.log(
    JSON.stringify({
      step: "link_existing_local_user",
      mode: "linked_null_codevertex",
      local_user_id: localUserId,
      codevertex_user_id: codevertexUserId,
    }),
  );

  return { localUserId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
      return preflightResponse(req);
    }

  if (req.method !== "POST") {
    return fail(req, "request", "method_not_allowed", "Only POST is supported", 405);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const codevertexUrl = requireEnv("CODEVERTEX_SUPABASE_URL");
  const codevertexAnonKey = requireEnv("CODEVERTEX_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey || !codevertexUrl || !codevertexAnonKey) {
    return fail(req, 
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
    return fail(req, "validate_body", "invalid_json", "Request body must be JSON");
  }

  const ticket = body.ticket;
  if (!isNonEmptyString(ticket)) {
    return fail(req, "validate_body", "ticket_required", "Field ticket must be a non-empty string");
  }

  const consumeResult = await consumeSsoTicket(codevertexUrl, codevertexAnonKey, ticket);
  if (consumeResult.error) {
    return jsonResponse(req, consumeResult.error, 502);
  }

  const corePayload = consumeResult.data!;
  if (corePayload.ok !== true) {
    return fail(req, 
      "validate_core",
      "core_not_ok",
      corePayload.message ?? corePayload.error ?? "Auth Core ok !== true",
    );
  }

  const coreProfile = corePayload.profile;
  if (!coreProfile?.id || !isNonEmptyString(coreProfile.id)) {
    return fail(req, "validate_core", "missing_profile_id", "Auth Core profile.id is required");
  }

  const membershipError = validateSplitlyMembership(corePayload);
  if (membershipError) {
    return fail(req, "validate_core", "membership_inactive", membershipError);
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
    return fail(req, "find_profile", "db_error", findError.message, 500);
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
        return fail(req, "sync_profile", "db_error", syncError.message, 500);
      }
    }
  } else {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: buildUserMetadata(coreProfile, codevertexUserId),
    });

    if (createUserError || !createdUser?.user) {
      if (
        createUserError &&
        isDuplicateEmailCreateUserError(createUserError) &&
        getCoreEmailForLinking(coreProfile)
      ) {
        const linkResult = await linkExistingLocalUser(
          admin,
          coreProfile,
          codevertexUserId,
        );
        if ("error" in linkResult) {
          return jsonResponse(req, linkResult.error, 409);
        }
        localUserId = linkResult.localUserId;
      } else {
        return fail(req, 
          "create_auth_user",
          "create_user_failed",
          createUserError?.message ?? "auth.admin.createUser returned no user",
          500,
        );
      }
    } else {
      localUserId = createdUser.user.id;

      const { error: insertProfileError } = await admin
        .from("profiles")
        .insert(buildProfileInsert(localUserId, codevertexUserId, coreProfile));

      if (insertProfileError) {
        return fail(req, "create_profile", "db_error", insertProfileError.message, 500);
      }
    }
  }

  const sessionResult = await createSessionViaMagicLink(admin, anon, email);
  if ("error" in sessionResult) {
    const status = sessionResult.error.step === "verify_otp" ? 502 : 500;
    return jsonResponse(req, sessionResult.error, status);
  }

  return jsonResponse(req, {
    ok: true,
    local_user_id: localUserId,
    codevertex_user_id: codevertexUserId,
    email,
    has_session: true,
    access_token: sessionResult.access_token,
    refresh_token: sessionResult.refresh_token,
  });
});
