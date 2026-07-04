import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Pool } from "@sensorium/db";
import { authenticateMcp } from "./auth.js";
import { registerTools } from "./tools.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildServer(pool: Pool): McpServer {
  const server = new McpServer({ name: "sensorium-mcp", version: "0.0.0" });
  registerTools(server, pool);
  return server;
}

/** Builds the MCP endpoint as a Web Standard fetch handler (works with Bun.serve directly). */
export function createMcpApp(pool: Pool) {
  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "not found" }, 404);
    }

    if (!authenticateMcp(req)) {
      return json({ error: "unauthorized" }, 401);
    }

    // Stateless: fresh transport + McpServer per request. Matches the SDK's
    // own recommended pattern for stateless HTTP (no session persisted
    // between calls — reads are cheap and idempotent, so this is fine for v0).
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = buildServer(pool);
    await server.connect(transport);
    return transport.handleRequest(req);
  }

  return { fetch };
}
