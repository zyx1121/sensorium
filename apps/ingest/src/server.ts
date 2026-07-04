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
import { decodeLogsRequestProtobuf, decodeMetricsRequestProtobuf, decodeTraceRequestProtobuf } from "./otlp-protobuf.js";

const JSON_CONTENT_TYPE = "application/json";
const PROTOBUF_CONTENT_TYPE = "application/x-protobuf";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Builds the OTLP/HTTP receiver as a Web Standard fetch handler (works with Bun.serve directly). */
export function createIngestApp(pool: Pool) {
  async function withAuth(
    req: Request,
    handle: (project: string, contentType: string) => Promise<Response>,
  ): Promise<Response> {
    // Content-Type dictates the wire format; anything else (including missing) is
    // rejected outright rather than guessed — silently trying to protobuf-decode an
    // unrecognized body risks parsing garbage into rows without ever throwing.
    const contentType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (contentType !== JSON_CONTENT_TYPE && contentType !== PROTOBUF_CONTENT_TYPE) {
      return json(
        {
          error: `unsupported content-type "${contentType || "(missing)"}"; expected ${JSON_CONTENT_TYPE} or ${PROTOBUF_CONTENT_TYPE}`,
        },
        415,
      );
    }

    // Token → project binding applies identically regardless of wire format — the
    // content-type branch above only decides how the body is parsed, never who it's
    // attributed to.
    const project = await authenticateIngest(pool, req);
    if (!project) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      const response = await handle(project, contentType);
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
      return withAuth(req, async (project, contentType) => {
        const payload: OtlpLogsPayload =
          contentType === PROTOBUF_CONTENT_TYPE
            ? decodeLogsRequestProtobuf(new Uint8Array(await req.arrayBuffer()))
            : ((await req.json()) as OtlpLogsPayload);
        const rows = mapOtlpLogsToRows(project, payload);
        const inserted = await insertLogs(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/traces") {
      return withAuth(req, async (project, contentType) => {
        const payload: OtlpTracesPayload =
          contentType === PROTOBUF_CONTENT_TYPE
            ? decodeTraceRequestProtobuf(new Uint8Array(await req.arrayBuffer()))
            : ((await req.json()) as OtlpTracesPayload);
        const rows = mapOtlpTracesToRows(project, payload);
        const inserted = await insertSpans(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/metrics") {
      return withAuth(req, async (project, contentType) => {
        const payload: OtlpMetricsPayload =
          contentType === PROTOBUF_CONTENT_TYPE
            ? decodeMetricsRequestProtobuf(new Uint8Array(await req.arrayBuffer()))
            : ((await req.json()) as OtlpMetricsPayload);
        const rows = mapOtlpMetricsToRows(project, payload);
        const inserted = await insertMetricPoints(pool, rows);
        return json({ ok: true, inserted });
      });
    }

    return json({ error: "not found" }, 404);
  }

  return { fetch };
}
