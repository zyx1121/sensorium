import { describe, expect, test } from "bun:test";
import {
  buildSpanTree,
  isErrorSpan,
  mapOtlpLogsToRows,
  mapOtlpMetricsToRows,
  mapOtlpTracesToRows,
  type OtlpLogsPayload,
  type OtlpMetricsPayload,
  type OtlpTracesPayload,
} from "../src/index.js";

// Real-shape OTLP/HTTP JSON payloads (as emitted by @opentelemetry/exporter-*-otlp-http),
// trimmed to the fields ingest reads.

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

const TRACE_PAYLOAD: OtlpTracesPayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.namespace", value: { stringValue: "ai-winlab" } }],
      },
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
              name: "SELECT users",
              kind: 3, // client
              startTimeUnixNano: "1712345678010000000",
              endTimeUnixNano: "1712345678030000000",
              status: { code: 2, message: "boom" }, // error
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
              gauge: {
                dataPoints: [{ timeUnixNano: "1712345678000000000", asInt: "3" }],
              },
            },
            {
              name: "http.server.request.count",
              sum: {
                dataPoints: [{ timeUnixNano: "1712345678000000000", asDouble: 42 }],
              },
            },
            {
              name: "http.server.duration",
              histogram: {
                dataPoints: [{ timeUnixNano: "1712345678000000000", count: "10", sum: 123.4 }],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("mapOtlpLogsToRows", () => {
  test("maps a log record, project comes from caller not resource attrs", () => {
    const rows = mapOtlpLogsToRows("ai-winlab", LOG_PAYLOAD);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.project).toBe("ai-winlab");
    expect(row.severity).toBe("ERROR");
    expect(row.body).toBe("failed to reach upstream");
    expect(row.traceId).toBe("5b8aa5a2d2c872e8321cf37308d69df2");
    expect(row.spanId).toBe("051581bf3cb55c13");
    expect(row.resource["service.name"]).toBe("api");
    expect(row.attributes["http.method"]).toBe("GET");
    // 1712345678901234000 ns -> 1712345678901 ms
    expect(row.ts.getTime()).toBe(1712345678901);
  });

  test("token-bound project overrides a differing service.namespace claim", () => {
    const rows = mapOtlpLogsToRows("other-project", LOG_PAYLOAD);
    expect(rows[0]!.project).toBe("other-project");
    expect(rows[0]!.resource["service.namespace"]).toBe("ai-winlab");
  });
});

describe("mapOtlpTracesToRows", () => {
  test("maps spans with duration, kind, status and parent linkage", () => {
    const rows = mapOtlpTracesToRows("ai-winlab", TRACE_PAYLOAD);
    expect(rows).toHaveLength(2);

    const root = rows.find((r) => r.spanId === "051581bf3cb55c13")!;
    expect(root.kind).toBe("server");
    expect(root.statusCode).toBe("ok");
    expect(root.durationMs).toBe(50);
    expect(root.parentSpanId).toBeNull();
    expect(root.attributes["http.status_code"]).toBe(200);
    expect(root.httpStatusCode).toBe(200);

    const child = rows.find((r) => r.spanId === "6df206e2fd0dd4e5")!;
    expect(child.kind).toBe("client");
    expect(child.statusCode).toBe("error");
    expect(child.parentSpanId).toBe("051581bf3cb55c13");
    expect(child.durationMs).toBe(20);
    expect(child.httpStatusCode).toBeNull();
  });

  test("httpStatusCode prefers the current semconv attribute over the legacy one", () => {
    const payload: OtlpTracesPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
                  spanId: "aaaaaaaaaaaaaaaa",
                  name: "GET /missing",
                  startTimeUnixNano: "1712345678000000000",
                  endTimeUnixNano: "1712345678010000000",
                  attributes: [
                    { key: "http.response.status_code", value: { intValue: "404" } },
                    { key: "http.status_code", value: { intValue: "999" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const rows = mapOtlpTracesToRows("ai-winlab", payload);
    expect(rows[0]!.httpStatusCode).toBe(404);
  });

  test("buildSpanTree nests the child span under its parent", () => {
    const rows = mapOtlpTracesToRows("ai-winlab", TRACE_PAYLOAD);
    const tree = buildSpanTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.spanId).toBe("051581bf3cb55c13");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.spanId).toBe("6df206e2fd0dd4e5");
  });
});

describe("mapOtlpMetricsToRows", () => {
  test("maps gauge, sum and histogram(sum) points", () => {
    const rows = mapOtlpMetricsToRows("ai-winlab", METRIC_PAYLOAD);
    expect(rows).toHaveLength(3);

    const gauge = rows.find((r) => r.metricName === "http.server.active_requests")!;
    expect(gauge.kind).toBe("gauge");
    expect(gauge.value).toBe(3);

    const sum = rows.find((r) => r.metricName === "http.server.request.count")!;
    expect(sum.kind).toBe("sum");
    expect(sum.value).toBe(42);

    const histogram = rows.find((r) => r.metricName === "http.server.duration")!;
    expect(histogram.kind).toBe("histogram");
    expect(histogram.value).toBe(123.4);
  });
});

describe("isErrorSpan", () => {
  test("OTLP status ERROR counts, regardless of HTTP status", () => {
    expect(isErrorSpan({ statusCode: "error", httpStatusCode: null })).toBe(true);
    expect(isErrorSpan({ statusCode: "error", httpStatusCode: 200 })).toBe(true);
  });

  test("HTTP >= 400 counts even without an explicit OTLP error status (401/429/404 visibility)", () => {
    expect(isErrorSpan({ statusCode: null, httpStatusCode: 404 })).toBe(true);
    expect(isErrorSpan({ statusCode: "unset", httpStatusCode: 401 })).toBe(true);
    expect(isErrorSpan({ statusCode: "ok", httpStatusCode: 429 })).toBe(true);
  });

  test("HTTP 200 and no OTLP error status does not count", () => {
    expect(isErrorSpan({ statusCode: "ok", httpStatusCode: 200 })).toBe(false);
    expect(isErrorSpan({ statusCode: "unset", httpStatusCode: null })).toBe(false);
  });
});
