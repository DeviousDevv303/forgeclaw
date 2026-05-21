import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://deviousdevv303.github.io/forgeclaw",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  const body = JSON.stringify({ error: { code, message, ...extra } });
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function validateJwt(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ user: { id: string; email?: string }; response: Response | null }> {
  const auth = req.headers.get("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  const jwt = match?.[1];

  if (!jwt) {
    return {
      user: { id: "" },
      response: jsonError(401, "missing_token", "Authorization: Bearer <jwt> required."),
    };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await adminClient.auth.getUser(jwt);

  if (error || !data.user) {
    return {
      user: { id: "" },
      response: jsonError(401, "invalid_token", "JWT validation failed.",
        error ? { details: error.message } : undefined),
    };
  }

  return { user: { id: data.user.id, email: data.user.email }, response: null };
}

async function proxyOpenRouter(
  req: Request,
  apiKey: string,
  origin: string | null,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body.");
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://deviousdevv303.github.io/forgeclaw",
        "X-Title": "ForgeClaw",
      },
      body: JSON.stringify(body),
    });

    const upstreamBody = await upstream.text();
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        ...corsHeaders(origin),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream request failed.";
    return jsonError(502, "upstream_error", "OpenRouter API unreachable.", { details: message });
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Only POST and OPTIONS are supported.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError(500, "config_error", "Missing Supabase environment configuration.");
  }

  const { response: authError } = await validateJwt(req, supabaseUrl, serviceRoleKey);
  if (authError) {
    return authError;
  }

  switch (url.pathname) {
    case "/openrouter": {
      const apiKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!apiKey) {
        return jsonError(500, "config_error", "OPENROUTER_API_KEY not configured.");
      }
      const response = await proxyOpenRouter(req, apiKey, origin);
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    }
    default:
      return jsonError(404, "not_found", `Unknown route: ${url.pathname}`);
  }
});
