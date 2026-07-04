import {
  mapOtlpLogsToRows,
  mapOtlpMetricsToRows,
  mapOtlpTracesToRows,
  type OtlpLogsPayload,
  type OtlpMetricsPayload,
  type OtlpTracesPayload,
} from "@sensorium/core";
import { insertLogs, insertMetricPoints, insertSpans, touchProjectLastSeen, type Pool } from "@sensorium/db";
import { authenticateIngest } from "./auth.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Builds the OTLP/HTTP receiver as a Web Standard fetch handler (works with Bun.serve directly). */
export function createIngestApp(pool: Pool) {
  async function withAuth(req: Request, handle: (project: string) => Promise<Response>): Promise<Response> {
    // v0: only OTLP/JSON is accepted. Protobuf (application/x-protobuf) is the
    // more common wire format in production OTel setups, but the collector
    // in front of us can be configured to export JSON — deferred until a real
    // producer needs binary framing.
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return json(
        { error: "unsupported content-type, expected application/json (OTLP/JSON); protobuf not yet supported" },
        415,
      );
    }

    const project = await authenticateIngest(pool, req);
    if (!project) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      const response = await handle(project);
      await touchProjectLastSeen(pool, project);
      return response;
    } catch (err) {
      console.error("ingest error:", err);
      return json({ error: "bad request" }, 400);
    }
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (req.method === "POST" && url.pathname === "/v1/logs") {
      return withAuth(req, async (project) => {
        const payload = (await req.json()) as OtlpLogsPayload;
        const rows = mapOtlpLogsToRows(project, payload);
        const inserted = await insertLogs(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/traces") {
      return withAuth(req, async (project) => {
        const payload = (await req.json()) as OtlpTracesPayload;
        const rows = mapOtlpTracesToRows(project, payload);
        const inserted = await insertSpans(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/metrics") {
      return withAuth(req, async (project) => {
        const payload = (await req.json()) as OtlpMetricsPayload;
        const rows = mapOtlpMetricsToRows(project, payload);
        const inserted = await insertMetricPoints(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    return json({ error: "not found" }, 404);
  }

  return { fetch };
}
