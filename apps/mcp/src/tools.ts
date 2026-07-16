import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildSpanTree } from "@sensorium/core";
import {
  errorSummary,
  listMetricNames,
  listProjects,
  listTraces,
  queryLogs,
  queryMetrics,
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
    "list_traces",
    {
      title: "List recent traces",
      description:
        "Browses the most recent traces for a project without needing a traceId up front — one row per " +
        "trace_id, newest first: name/http.route/http_status_code from the trace's inbound request span, " +
        "plus client.address/geo.country/geo.city/geo.region backfilled from ANY span in the same trace " +
        "(some producers, e.g. Vercel, put client.address/geo.* on a sibling span — like a root layout " +
        "render — rather than the request span itself, so this joins across the trace to fill them in). " +
        "Excludes outbound spans (this service's own fetch/db calls, e.g. calls to Supabase) from the " +
        "representative pick so it only shows requests this service actually served. Feed a traceId from " +
        "here into query_traces for the full span tree of one request.",
      inputSchema: {
        project: z.string(),
        windowMinutes: z.number().int().positive().max(7 * 24 * 60).default(60),
        limit: z.number().int().positive().max(1000).default(30),
      },
    },
    async ({ project, windowMinutes, limit }) =>
      textResult(await listTraces(pool, { project, windowMinutes, limit })),
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
        "Attack/traffic attribution: aggregates spans AND logs in a project over a recent time window by " +
        "source IP (client.address) — some producers (e.g. Vercel) attach client.address/geo.* to a log " +
        "record (429/401/error) rather than the span, so both are read. Returns each IP's geo " +
        "(country/city/region — most recent sighting across either signal) and total request/event count " +
        "from that same reading. Its top 5 routes (http.route) and error count are a trace-level join: on " +
        "Vercel, client.address/geo.* often land on a root layout span with no route, while the route/status " +
        "sit on a sibling request span in the SAME trace — so both are pulled from any inbound span across " +
        "every trace the IP touched, not just the row that happened to carry the IP. Sorted by request count " +
        "descending. Also returns a by-country rollup for 'which countries are hitting us' at a glance.",
      inputSchema: {
        project: z.string(),
        windowMinutes: z.number().int().positive().max(7 * 24 * 60).default(60),
        limit: z.number().int().positive().max(1000).default(20).describe("max number of source IPs to return"),
      },
    },
    async ({ project, windowMinutes, limit }) => textResult(await topSources(pool, { project, windowMinutes, limit })),
  );

  server.registerTool(
    "query_metrics",
    {
      title: "Query metrics",
      description:
        "Reads OTLP metrics for a project within a time window. Without metricName: catalogs every metric " +
        "seen in the window (kind, point count, first/last seen, last value) — start here to discover what a " +
        "producer reports. With metricName: whole-window min/max/avg/count plus raw points, newest first, up " +
        "to limit (summary ignores limit). A metric with several series (e.g. hostmetrics' per-cpu/per-state " +
        "points) interleaves them — the labels live in each point's attributes, so group client-side for " +
        "per-series numbers. Histogram points carry ingest's v0 sum-only reduction.",
      inputSchema: {
        project: z.string(),
        metricName: z.string().optional().describe("exact metric name; omit to list which metrics exist"),
        since: z.string().datetime().describe("ISO 8601 timestamp, inclusive lower bound"),
        until: z.string().datetime().optional(),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("max points returned when metricName is set (default 100)"),
      },
    },
    async ({ project, metricName, since, until, limit }) => {
      const window = { project, since: new Date(since), until: until ? new Date(until) : undefined };
      if (!metricName) return textResult(await listMetricNames(pool, window));
      return textResult(await queryMetrics(pool, { ...window, metricName, limit }));
    },
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
