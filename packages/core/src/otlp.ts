import {
  spanKindFromProto,
  statusCodeFromProto,
  type OtlpAnyValue,
  type OtlpKeyValue,
  type OtlpLogsPayload,
  type OtlpMetricsPayload,
  type OtlpResource,
  type OtlpTracesPayload,
} from "./otlp-json.js";
import type { LogRow, MetricPointRow, SpanRow } from "./rows.js";

/** Nanosecond epoch string (int64-as-string in OTLP/JSON) → Date, without losing precision to Number(). */
export function nanosToDate(nanos: string | number): Date {
  const n = typeof nanos === "number" ? BigInt(Math.trunc(nanos)) : BigInt(nanos);
  return new Date(Number(n / 1_000_000n));
}

function anyValueToJs(value: OtlpAnyValue | undefined): unknown {
  if (value === undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return typeof value.intValue === "string" ? Number(value.intValue) : value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue !== undefined) return value.arrayValue.values.map(anyValueToJs);
  if (value.kvlistValue !== undefined) return keyValuesToObject(value.kvlistValue.values);
  return null;
}

export function keyValuesToObject(kvs: OtlpKeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of kvs ?? []) {
    out[kv.key] = anyValueToJs(kv.value);
  }
  return out;
}

function resourceToObject(resource: OtlpResource | undefined): Record<string, unknown> {
  return keyValuesToObject(resource?.attributes);
}

/** service.namespace as declared by the client — informational only, never trusted for project scoping. */
export function declaredNamespace(resource: OtlpResource | undefined): string | undefined {
  const attrs = keyValuesToObject(resource?.attributes);
  const ns = attrs["service.namespace"];
  return typeof ns === "string" ? ns : undefined;
}

/**
 * Maps an OTLP/JSON ExportLogsServiceRequest to our log rows.
 * `project` is caller-supplied (resolved from the ingest bearer token), NOT
 * read from resource attributes — token binding wins over client claims.
 */
export function mapOtlpLogsToRows(project: string, payload: OtlpLogsPayload): LogRow[] {
  const rows: LogRow[] = [];
  for (const rl of payload.resourceLogs ?? []) {
    const resource = resourceToObject(rl.resource);
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        rows.push({
          project,
          ts: nanosToDate(rec.timeUnixNano),
          severity: rec.severityText ?? null,
          body:
            rec.body?.stringValue ??
            (rec.body !== undefined ? JSON.stringify(anyValueToJs(rec.body)) : null),
          traceId: rec.traceId ?? null,
          spanId: rec.spanId ?? null,
          resource,
          attributes: keyValuesToObject(rec.attributes),
        });
      }
    }
  }
  return rows;
}

/** Maps an OTLP/JSON ExportTraceServiceRequest to our span rows. */
export function mapOtlpTracesToRows(project: string, payload: OtlpTracesPayload): SpanRow[] {
  const rows: SpanRow[] = [];
  for (const rs of payload.resourceSpans ?? []) {
    const resource = resourceToObject(rs.resource);
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const startTs = nanosToDate(span.startTimeUnixNano);
        const endTs = nanosToDate(span.endTimeUnixNano);
        rows.push({
          project,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId ?? null,
          name: span.name,
          kind: spanKindFromProto(span.kind),
          startTs,
          endTs,
          durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
          statusCode: statusCodeFromProto(span.status?.code),
          resource,
          attributes: keyValuesToObject(span.attributes),
        });
      }
    }
  }
  return rows;
}

/**
 * Maps an OTLP/JSON ExportMetricsServiceRequest to our metric point rows.
 * v0 simplification: histogram points are stored as their `sum` (one row,
 * not per-bucket) — good enough for "is this metric moving" queries, not for
 * percentile math. Revisit if an MCP tool ever needs bucket-level detail.
 */
export function mapOtlpMetricsToRows(project: string, payload: OtlpMetricsPayload): MetricPointRow[] {
  const rows: MetricPointRow[] = [];
  for (const rm of payload.resourceMetrics ?? []) {
    const resource = resourceToObject(rm.resource);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        if (metric.gauge) {
          for (const dp of metric.gauge.dataPoints) {
            rows.push(numberPointToRow(project, metric.name, "gauge", dp, resource));
          }
        }
        if (metric.sum) {
          for (const dp of metric.sum.dataPoints) {
            rows.push(numberPointToRow(project, metric.name, "sum", dp, resource));
          }
        }
        if (metric.histogram) {
          for (const dp of metric.histogram.dataPoints) {
            rows.push({
              project,
              metricName: metric.name,
              ts: nanosToDate(dp.timeUnixNano),
              kind: "histogram",
              value: dp.sum ?? 0,
              attributes: keyValuesToObject(dp.attributes),
              resource,
            });
          }
        }
      }
    }
  }
  return rows;
}

function numberPointToRow(
  project: string,
  metricName: string,
  kind: "gauge" | "sum",
  dp: { timeUnixNano: string; asDouble?: number; asInt?: string | number; attributes?: OtlpKeyValue[] },
  resource: Record<string, unknown>,
): MetricPointRow {
  const value = dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : 0);
  return {
    project,
    metricName,
    ts: nanosToDate(dp.timeUnixNano),
    kind,
    value,
    attributes: keyValuesToObject(dp.attributes),
    resource,
  };
}
