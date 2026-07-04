import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildSpanTree } from "@sensorium/core";
import {
  errorSummary,
  listProjects,
  queryLogs,
  queryTraceSpans,
  searchLogs,
  topSources,
  type Pool,
} from "@sensorium/db";
import { z } from "zod";

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Registers the read-only observability tools. All reads are cross-project — the MCP token is a single trusted consumer (kilo). */
export function registerTools(server: McpServer, pool: Pool): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Lists every registered project with last-seen time and per-signal row counts.",
    },
    async () => textResult(await listProjects(pool)),
  );

  server.registerTool(
    "query_logs",
    {
      title: "Query logs",
      description:
        "Queries logs for a project within a time window, optionally filtered by severity, trace_id, a body substring, " +
        "source IP (client.address), or route (http.route). Returns full attributes per row, including " +
        "client.address/geo.country/geo.city/geo.region/http.route when the producer sets them.",
      inputSchema: {
        project: z.string(),
        since: z.string().datetime().describe("ISO 8601 timestamp, inclusive lower bound"),
        until: z.string().datetime().optional(),
        severity: z.string().optional(),
        contains: z.string().optional().describe("substring to match against log body (case-insensitive)"),
        traceId: z.string().optional(),
        ip: z.string().optional().describe("exact match against the client.address attribute"),
        route: z.string().optional().describe("exact match against the http.route attribute"),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async ({ project, since, until, severity, contains, traceId, ip, route, limit }) => {
      const rows = await queryLogs(pool, {
        project,
        since: new Date(since),
        until: until ? new Date(until) : undefined,
        severity,
        contains,
        traceId,
        ip,
        route,
        limit,
      });
      return textResult(rows);
    },
  );

  server.registerTool(
    "query_traces",
    {
      title: "Query trace",
      description: "Fetches every span for a trace_id in a project and assembles them into a parent/child tree.",
      inputSchema: {
        project: z.string(),
        traceId: z.string(),
      },
    },
    async ({ project, traceId }) => {
      const spans = await queryTraceSpans(pool, { project, traceId });
      return textResult(buildSpanTree(spans));
    },
  );

  server.registerTool(
    "error_summary",
    {
      title: "Error summary",
      description:
        "Counts ERROR/FATAL logs and error-status spans for a project over a recent time window, with the top repeated log messages.",
      inputSchema: {
        project: z.string(),
        windowMinutes: z.number().int().positive().max(7 * 24 * 60).default(60),
      },
    },
    async ({ project, windowMinutes }) => textResult(await errorSummary(pool, { project, windowMinutes })),
  );

  server.registerTool(
    "top_sources",
    {
      title: "Top request sources",
      description:
        "Attack/traffic attribution: aggregates spans in a project over a recent time window by source IP " +
        "(client.address), returning each IP's geo (country/city/region — most recent sighting), total " +
        "request count, error count (OTLP error status or HTTP >= 400), and its top 5 routes (http.route) " +
        "by hit count. Sorted by request count descending. Also returns a by-country rollup for " +
        "'which countries are hitting us' at a glance.",
      inputSchema: {
        project: z.string(),
        windowMinutes: z.number().int().positive().max(7 * 24 * 60).default(60),
        limit: z.number().int().positive().max(1000).default(20).describe("max number of source IPs to return"),
      },
    },
    async ({ project, windowMinutes, limit }) => textResult(await topSources(pool, { project, windowMinutes, limit })),
  );

  server.registerTool(
    "search",
    {
      title: "Search logs",
      description: "v0 substring search (ILIKE) over log body and attributes for a project since a given time.",
      inputSchema: {
        project: z.string(),
        q: z.string(),
        since: z.string().datetime(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async ({ project, q, since, limit }) =>
      textResult(await searchLogs(pool, { project, q, since: new Date(since), limit })),
  );
}
