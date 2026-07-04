import { getPool } from "@sensorium/db";
import { createMcpApp } from "./server.js";

if (!process.env.SENSORIUM_MCP_TOKEN) {
  throw new Error("SENSORIUM_MCP_TOKEN is not set");
}

const port = Number(process.env.MCP_PORT ?? 8788);
const pool = getPool();
const app = createMcpApp(pool);

Bun.serve({ port, fetch: app.fetch });

console.log(`sensorium mcp listening on :${port}`);
