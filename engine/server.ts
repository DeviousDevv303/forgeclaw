// engine/server.ts
// Deno proxy server for ForgeMind engine
// Run: deno run --allow-net --allow-env --allow-read engine/server.ts

const PORT = Deno.env.get("PORT") ? parseInt(Deno.env.get("PORT")!) : 3001;
const MOONSHOT_API_KEY = Deno.env.get("MOONSHOT_API_KEY") || "";
const MOONSHOT_BASE_URL = Deno.env.get("MOONSHOT_BASE_URL") || "https://api.moonshot.ai/v1";

// Never use wildcard CORS here: this server holds MOONSHOT_API_KEY and a
// wildcard proxy lets any website spend it. Add deployment origins through
// CORS_ORIGINS (comma-separated); local development and the public Pages site
// remain supported by default.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://deviousdevv303.github.io",
  ...(Deno.env.get("CORS_ORIGINS") || "").split(",").map(origin => origin.trim()).filter(Boolean),
]);
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

const COMMON_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: originAllowed(req) ? 204 : 403, headers: corsHeaders(req) });
  }

  // Health check
  if (path === "/health" && req.method === "GET") {
    return Response.json({ status: "ok", engine: "forgemind", version: "0.1.0" }, { headers: corsHeaders(req) });
  }

  if (!originAllowed(req)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403, headers: COMMON_HEADERS });
  }

  // Moonshot proxy: /api/moonshot/v1/chat/completions → api.moonshot.ai/v1/chat/completions
  if (path.startsWith("/api/moonshot/")) {
    const moonshotPath = path.replace("/api/moonshot/v1", "") || "/";
    const targetUrl = `${MOONSHOT_BASE_URL}${moonshotPath}`;

    if (!MOONSHOT_API_KEY) {
      return Response.json(
        { error: "MOONSHOT_API_KEY not configured on server" },
        { status: 500, headers: corsHeaders(req) }
      );
    }

    // Clone headers, inject server-side key
    const headers = new Headers(req.headers);
    headers.set("Authorization", `Bearer ${MOONSHOT_API_KEY}`);
    headers.delete("host"); // Let fetch set the correct host

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.body,
        // @ts-expect-error — Deno supports this for streaming
        duplex: "half",
      });

      // Stream response back with CORS
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: {
          ...corsHeaders(req),
          "content-type": upstream.headers.get("content-type") || "application/json",
        },
      });
    } catch (err) {
      return Response.json(
        { error: "Upstream Moonshot error", detail: String(err) },
        { status: 502, headers: corsHeaders(req) }
      );
    }
  }

  // SQLite persistence routes (stub — wire your db.ts here)
  if (path === "/api/ledger" && req.method === "POST") {
    // Wire to engine/db/db.ts
    return Response.json({ status: "not-implemented" }, { status: 501, headers: corsHeaders(req) });
  }

  return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders(req) });
});

console.log(`ForgeMind engine running on http://localhost:${PORT}`);
