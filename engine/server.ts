// engine/server.ts
// Deno proxy server for ForgeMind engine
// Run: deno run --allow-net --allow-env --allow-read engine/server.ts

const PORT = Deno.env.get("PORT") ? parseInt(Deno.env.get("PORT")!) : 3001;
const MOONSHOT_API_KEY = Deno.env.get("MOONSHOT_API_KEY") || "";
const MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";
// Set BRAVE_API_KEY in this Deno process's environment; never keep the Brave key in browser storage.
const BRAVE_API_KEY = Deno.env.get("BRAVE_API_KEY") || "";
const BRAVE_BASE_URL = "https://api.search.brave.com/res/v1/web/search";

// CORS — allow GitHub Pages origin. Tighten this to your exact domain in prod.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Health check
  if (path === "/health" && req.method === "GET") {
    return Response.json({
      status: "ok",
      engine: "forgemind",
      version: "0.1.0",
    }, { headers: CORS_HEADERS });
  }

  // Moonshot proxy: /api/moonshot/v1/chat/completions → api.moonshot.cn/v1/chat/completions
  if (path.startsWith("/api/moonshot/")) {
    const moonshotPath = path.replace("/api/moonshot", "");
    const targetUrl = `${MOONSHOT_BASE_URL}${moonshotPath}`;

    if (!MOONSHOT_API_KEY) {
      return Response.json(
        { error: "MOONSHOT_API_KEY not configured on server" },
        { status: 500, headers: CORS_HEADERS },
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
          ...CORS_HEADERS,
          "content-type": upstream.headers.get("content-type") ||
            "application/json",
        },
      });
    } catch (err) {
      return Response.json(
        { error: "Upstream Moonshot error", detail: String(err) },
        { status: 502, headers: CORS_HEADERS },
      );
    }
  }

  // Brave Search relay: the browser calls localhost; Deno injects the server-side key.
  if (path === "/api/brave/search" && req.method === "GET") {
    const query = url.searchParams.get("q")?.trim() || "";
    const requestedCount = parseInt(url.searchParams.get("count") || "5", 10);
    const count = Math.min(
      Math.max(Number.isFinite(requestedCount) ? requestedCount : 5, 1),
      20,
    );
    if (!query) {
      return Response.json({ error: "Missing q query parameter" }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (!BRAVE_API_KEY) {
      return Response.json(
        { error: "BRAVE_API_KEY not configured on server" },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    const targetUrl = new URL(BRAVE_BASE_URL);
    targetUrl.searchParams.set("q", query);
    targetUrl.searchParams.set("count", String(count));
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": BRAVE_API_KEY,
        },
      });

      // Preserve Brave's JSON response/status while adding the engine's browser CORS headers.
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: {
          ...CORS_HEADERS,
          "content-type": upstream.headers.get("content-type") ||
            "application/json",
        },
      });
    } catch (err) {
      return Response.json(
        { error: "Upstream Brave Search error", detail: String(err) },
        { status: 502, headers: CORS_HEADERS },
      );
    }
  }

  // SQLite persistence routes (stub — wire your db.ts here)
  if (path === "/api/ledger" && req.method === "POST") {
    // Wire to engine/db/db.ts
    return Response.json({ status: "not-implemented" }, {
      status: 501,
      headers: CORS_HEADERS,
    });
  }

  return Response.json({ error: "Not found" }, {
    status: 404,
    headers: CORS_HEADERS,
  });
});

console.log(`ForgeMind engine running on http://localhost:${PORT}`);
