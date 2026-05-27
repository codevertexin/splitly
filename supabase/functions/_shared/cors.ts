/**
 * CodeVertex CORS allowlist for Splitly Edge Functions.
 * Never use Access-Control-Allow-Origin: "*" in production.
 */

const PRODUCTION_ORIGINS = [
  "https://splitly.codevertex.cc",
  "https://auth.codevertex.cc",
  "https://billing.codevertex.cc",
];

const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseExtraOrigins(): string[] {
  const raw = Deno.env.get("CORS_ALLOWED_ORIGINS")?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isLocalSupabase(): boolean {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}

function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>([...PRODUCTION_ORIGINS, ...parseExtraOrigins()]);
  const appBase = Deno.env.get("APP_BASE_URL")?.trim().replace(/\/+$/, "");
  if (appBase) allowed.add(appBase);
  if (isLocalSupabase() || Deno.env.get("ALLOW_LOCALHOST_CORS") === "true") {
    for (const o of LOCAL_DEV_ORIGINS) allowed.add(o);
  }
  return allowed;
}

export function corsHeadersForRequest(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = getAllowedOrigins();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function preflightResponse(req: Request): Response {
  const headers = corsHeadersForRequest(req);
  if (!headers["Access-Control-Allow-Origin"]) {
    return new Response(null, { status: 403 });
  }
  return new Response("ok", { status: 204, headers });
}
