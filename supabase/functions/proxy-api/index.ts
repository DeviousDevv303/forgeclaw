import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────
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

// ── Structured error helper ────────────────────────────────────────────
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

// ── JWT validation ────────────────────────────────────────────────────
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

// ── Proxy helpers ─────────────────────────────────────────────────────
async function proxyAnthropic(
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
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "Anthropic-Version": "2023-06-01",
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
    return jsonError(502, "upstream_error", "Anthropic API unreachable.", { details: message });
  }
}

async function proxyOllama(
  req: Request,
  origin: string | null,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body.");
  }

  try {
    // ── Ollama URL config ───────────────────────────────────────────────
    // Production: set OLLAMA_API_URL env var (e.g. https://your-ollama-server.com/api/generate)
    // Local dev: falls back to host.docker.internal:11434 for Docker Desktop
    const OLLAMA_API_URL = Deno.env.get("OLLAMA_API_URL") ?? "http://host.docker.internal:11434/api/generate";
    const upstream = await fetch(OLLAMA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    return jsonError(502, "upstream_error", "Ollama API unreachable.", { details: message });
  }
}

// ── Main handler ──────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const url = new URL(req.url);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Only POST accepted for actual routes
  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Only POST and OPTIONS are supported.");
  }

  // Env checks
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError(500, "config_error", "Missing Supabase environment configuration.");
  }

  // Auth gate
  const { response: authError } = await validateJwt(req, supabaseUrl, serviceRoleKey);
  if (authError) {
    return authError;
  }

  // Route dispatch
  let response: Response;
  switch (url.pathname) {
    case "/anthropic": {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) {
        return jsonError(500, "config_error", "ANTHROPIC_API_KEY not configured.");
      }
      response = await proxyAnthropic(req, apiKey, origin);
      break;
    }
    case "/ollama": {
      response = await proxyOllama(req, origin);
      break;
    }
    default:
      return jsonError(404, "not_found", `Unknown route: ${url.pathname}`);
  }

  // Append CORS to the final response
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
});
