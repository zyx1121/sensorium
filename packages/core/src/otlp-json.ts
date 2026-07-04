/**
 * Minimal OTLP/JSON (protobuf JSON mapping) type surface — only the fields
 * ingest actually reads. Not a full copy of the OTLP proto schema.
 *
 * Note: trace_id/span_id are `bytes` in the OTLP proto, which canonical
 * protobuf-JSON encodes as base64 — but in practice the OTel JS/Go SDKs and
 * the Collector's pdata JSON codec use hex strings for these two fields
 * specifically (custom (Un)MarshalJSON on TraceID/SpanID). This is what
 * real OTLP/HTTP JSON producers emit, so ingest accepts hex here.
 */

export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values: OtlpAnyValue[] };
  kvlistValue?: { values: OtlpKeyValue[] };
  bytesValue?: string;
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  traceId?: string;
  spanId?: string;
}

export interface OtlpLogsPayload {
  resourceLogs: Array<{
    resource?: OtlpResource;
    scopeLogs: Array<{
      logRecords: OtlpLogRecord[];
    }>;
  }>;
}

export interface OtlpSpanStatus {
  code?: number;
  message?: string;
}

/** SpanKind numbering per OTLP proto (span.proto `SpanKind`). */
const SPAN_KIND_NAMES = [
  "unspecified",
  "internal",
  "server",
  "client",
  "producer",
  "consumer",
] as const;

export function spanKindFromProto(kind: number | undefined): (typeof SPAN_KIND_NAMES)[number] {
  return SPAN_KIND_NAMES[kind ?? 0] ?? "unspecified";
}

/** StatusCode numbering per OTLP proto (status.proto `StatusCode`). */
const STATUS_CODE_NAMES = ["unset", "ok", "error"] as const;

export function statusCodeFromProto(code: number | undefined): string | null {
  if (code === undefined) return null;
  return STATUS_CODE_NAMES[code] ?? null;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpKeyValue[];
  status?: OtlpSpanStatus;
}

export interface OtlpTracesPayload {
  resourceSpans: Array<{
    resource?: OtlpResource;
    scopeSpans: Array<{
      spans: OtlpSpan[];
    }>;
  }>;
}

export interface OtlpNumberDataPoint {
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string | number;
  attributes?: OtlpKeyValue[];
}

export interface OtlpHistogramDataPoint {
  timeUnixNano: string;
  count?: string | number;
  sum?: number;
  attributes?: OtlpKeyValue[];
}

export interface OtlpMetric {
  name: string;
  gauge?: { dataPoints: OtlpNumberDataPoint[] };
  sum?: { dataPoints: OtlpNumberDataPoint[] };
  histogram?: { dataPoints: OtlpHistogramDataPoint[] };
}

export interface OtlpMetricsPayload {
  resourceMetrics: Array<{
    resource?: OtlpResource;
    scopeMetrics: Array<{
      metrics: OtlpMetric[];
    }>;
  }>;
}
