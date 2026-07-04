import { describe, expect, test } from "bun:test";
import path from "node:path";
import protobuf from "protobufjs";
import {
  mapOtlpLogsToRows,
  mapOtlpMetricsToRows,
  mapOtlpTracesToRows,
  type OtlpLogsPayload,
  type OtlpMetricsPayload,
  type OtlpTracesPayload,
} from "@sensorium/core";
import { decodeLogsRequestProtobuf, decodeMetricsRequestProtobuf, decodeTraceRequestProtobuf } from "../src/otlp-protobuf.js";

// Test-only protobuf *encoder*, independent of ../src/otlp-protobuf.ts's decoder —
// this is what makes the equivalence assertions below a genuine round-trip check
// rather than a tautology. Loads the same vendored proto files with the same
// options, but only to build wire bytes from the fixtures below.
const PROTO_ROOT = path.join(import.meta.dirname, "..", "proto");
const testRoot = new protobuf.Root();
testRoot.resolvePath = (_origin, target) => path.join(PROTO_ROOT, target);
testRoot.loadSync(
  [
    "opentelemetry/proto/collector/trace/v1/trace_service.proto",
    "opentelemetry/proto/collector/logs/v1/logs_service.proto",
    "opentelemetry/proto/collector/metrics/v1/metrics_service.proto",
  ],
  { keepCase: false },
);
testRoot.resolveAll();

/** protobufjs `fromObject` expects `bytes` fields as base64 (canonical proto3-JSON),
 * but our OtlpXxxPayload fixtures use hex for traceId/spanId/parentSpanId (matching
 * what real OTLP/HTTP JSON producers send — see otlp-json.ts). Recursively convert
 * before encoding so one fixture literal serves both the JSON-path and
 * protobuf-path assertions. */
function hexIdsToBase64(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hexIdsToBase64);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "traceId" || key === "spanId" || key === "parentSpanId") && typeof v === "string" && v !== "") {
        out[key] = Buffer.from(v, "hex").toString("base64");
      } else {
        out[key] = hexIdsToBase64(v);
      }
    }
    return out;
  }
  return value;
}

function encode(fqn: string, payload: unknown): Uint8Array {
  const type = testRoot.lookupType(fqn);
  const message = type.fromObject(hexIdsToBase64(payload) as Record<string, unknown>);
  const verifyError = type.verify(message);
  if (verifyError) throw new Error(`invalid ${fqn} fixture: ${verifyError}`);
  return type.encode(message).finish();
}

const TRACE_PAYLOAD: OtlpTracesPayload = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: "service.namespace", value: { stringValue: "ai-winlab" } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
              spanId: "051581bf3cb55c13",
              name: "GET /users",
              kind: 2, // server
              startTimeUnixNano: "1712345678000000000",
              endTimeUnixNano: "1712345678050000000",
              attributes: [{ key: "http.status_code", value: { intValue: "200" } }],
              status: { code: 1 }, // ok
            },
            {
              traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
              spanId: "6df206e2fd0dd4e5",
              parentSpanId: "051581bf3cb55c13",
              name: "GET /missing",
              kind: 2, // server
              startTimeUnixNano: "1712345678010000000",
              endTimeUnixNano: "1712345678030000000",
              attributes: [{ key: "http.response.status_code", value: { intValue: "404" } }],
            },
          ],
        },
      ],
    },
  ],
};

const LOG_PAYLOAD: OtlpLogsPayload = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.namespace", value: { stringValue: "ai-winlab" } },
          { key: "service.name", value: { stringValue: "api" } },
        ],
      },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: "1712345678901234000",
              severityText: "ERROR",
              severityNumber: 17,
              body: { stringValue: "failed to reach upstream" },
              attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
              traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
              spanId: "051581bf3cb55c13",
            },
          ],
        },
      ],
    },
  ],
};

const METRIC_PAYLOAD: OtlpMetricsPayload = {
  resourceMetrics: [
    {
      resource: { attributes: [{ key: "service.namespace", value: { stringValue: "ai-winlab" } }] },
      scopeMetrics: [
        {
          metrics: [
            {
              name: "http.server.active_requests",
              gauge: { dataPoints: [{ timeUnixNano: "1712345678000000000", asInt: "3" }] },
            },
            {
              name: "http.server.request.count",
              sum: { dataPoints: [{ timeUnixNano: "1712345678000000000", asDouble: 42 }] },
            },
            {
              name: "http.server.duration",
              histogram: { dataPoints: [{ timeUnixNano: "1712345678000000000", count: "10", sum: 123.4 }] },
            },
          ],
        },
      ],
    },
  ],
};

describe("protobuf decode == JSON decode, fed through the same @sensorium/core mapping", () => {
  test("traces", () => {
    const bytes = encode("opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest", TRACE_PAYLOAD);
    const decoded = decodeTraceRequestProtobuf(bytes);
    expect(mapOtlpTracesToRows("ai-winlab", decoded)).toEqual(mapOtlpTracesToRows("ai-winlab", TRACE_PAYLOAD));

    const rows = mapOtlpTracesToRows("ai-winlab", decoded);
    const notFound = rows.find((r) => r.spanId === "6df206e2fd0dd4e5")!;
    expect(notFound.httpStatusCode).toBe(404);
  });

  test("logs", () => {
    const bytes = encode("opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest", LOG_PAYLOAD);
    const decoded = decodeLogsRequestProtobuf(bytes);
    expect(mapOtlpLogsToRows("ai-winlab", decoded)).toEqual(mapOtlpLogsToRows("ai-winlab", LOG_PAYLOAD));
  });

  test("metrics", () => {
    const bytes = encode("opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest", METRIC_PAYLOAD);
    const decoded = decodeMetricsRequestProtobuf(bytes);
    expect(mapOtlpMetricsToRows("ai-winlab", decoded)).toEqual(mapOtlpMetricsToRows("ai-winlab", METRIC_PAYLOAD));
  });
});
