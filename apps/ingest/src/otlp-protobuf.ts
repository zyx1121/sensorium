import path from "node:path";
import protobuf, { type Root, type Type } from "protobufjs";
import type { OtlpLogsPayload, OtlpMetricsPayload, OtlpTracesPayload } from "@sensorium/core";

/**
 * OTLP/HTTP protobuf decoding.
 *
 * Library choice: `@opentelemetry/otlp-transformer` (the OTel JS SDK's own OTLP
 * codec) was evaluated first since it's the "official" package, but its public
 * `ISerializer` interface (see its `i-serializer.d.ts`) only exposes
 * `serializeRequest` + `deserializeResponse` — the *exporter* side of the wire.
 * There is no supported way to decode an incoming `Export*ServiceRequest`: its
 * internal `ProtobufReader` is explicitly documented as "not intended to be a
 * general-purpose protobuf reader" and only implements the (much smaller)
 * response-message fields. It cannot decode a full request (spans, resource,
 * attributes, ...).
 *
 * Instead this decodes with `protobufjs` against the real, canonical OTLP proto
 * schema vendored in `../proto` (see `../proto/README.md` for provenance/pin).
 * This is the same approach the OTel Collector's own JS-based tooling and other
 * from-scratch OTLP receivers use: load the .proto once, decode message bytes
 * per request.
 *
 * `../proto` is a sibling of `dist/` (bun build's --outdir) as well as of
 * `src/`, so the relative path below resolves to the same directory whether
 * this module runs from source (`bun run src/index.ts`) or from the bundled
 * `dist/index.js` — no separate asset-copy step needed at deploy time.
 */

const PROTO_ROOT = path.join(import.meta.dirname, "..", "proto");

function resolveProtoPath(_origin: string, target: string): string {
  return path.join(PROTO_ROOT, target);
}

let cachedRoot: Root | undefined;

function loadRoot(): Root {
  if (!cachedRoot) {
    const root = new protobuf.Root();
    root.resolvePath = resolveProtoPath;
    root.loadSync(
      [
        "opentelemetry/proto/collector/trace/v1/trace_service.proto",
        "opentelemetry/proto/collector/logs/v1/logs_service.proto",
        "opentelemetry/proto/collector/metrics/v1/metrics_service.proto",
      ],
      { keepCase: false }, // camelCase field names, matching the OtlpXxxPayload shapes in @sensorium/core
    );
    root.resolveAll();
    cachedRoot = root;
  }
  return cachedRoot;
}

function lookupType(fqn: string): Type {
  return loadRoot().lookupType(fqn);
}

/** protobufjs decodes every `bytes` field to a base64 string (`bytes: String` below);
 * OTLP/JSON's hex convention only applies to trace_id/span_id (see the note in
 * `@sensorium/core`'s otlp-json.ts), so those specific fields need a second pass. */
function base64ToHex(value: string): string {
  return Buffer.from(value, "base64").toString("hex");
}

const CONVERSION_OPTIONS = { longs: String, bytes: String, defaults: false } as const;

type JsonObject = Record<string, unknown>;

function asObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}

function fixSpanIdFields(span: JsonObject): void {
  if (typeof span.traceId === "string") span.traceId = base64ToHex(span.traceId);
  if (typeof span.spanId === "string") span.spanId = base64ToHex(span.spanId);
  if (typeof span.parentSpanId === "string") span.parentSpanId = base64ToHex(span.parentSpanId);
}

function fixLogIdFields(record: JsonObject): void {
  if (typeof record.traceId === "string") record.traceId = base64ToHex(record.traceId);
  if (typeof record.spanId === "string") record.spanId = base64ToHex(record.spanId);
}

/** Decodes an OTLP/protobuf `ExportTraceServiceRequest` body into the same shape
 * `mapOtlpTracesToRows` (JSON path) already consumes — no separate mapping. */
export function decodeTraceRequestProtobuf(bytes: Uint8Array): OtlpTracesPayload {
  const type = lookupType("opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest");
  const obj = type.toObject(type.decode(bytes), CONVERSION_OPTIONS) as JsonObject;
  for (const rs of asObjectArray(obj.resourceSpans)) {
    for (const ss of asObjectArray(rs.scopeSpans)) {
      for (const span of asObjectArray(ss.spans)) fixSpanIdFields(span);
    }
  }
  return obj as unknown as OtlpTracesPayload;
}

/** Decodes an OTLP/protobuf `ExportLogsServiceRequest` body into the same shape
 * `mapOtlpLogsToRows` (JSON path) already consumes — no separate mapping. */
export function decodeLogsRequestProtobuf(bytes: Uint8Array): OtlpLogsPayload {
  const type = lookupType("opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest");
  const obj = type.toObject(type.decode(bytes), CONVERSION_OPTIONS) as JsonObject;
  for (const rl of asObjectArray(obj.resourceLogs)) {
    for (const sl of asObjectArray(rl.scopeLogs)) {
      for (const rec of asObjectArray(sl.logRecords)) fixLogIdFields(rec);
    }
  }
  return obj as unknown as OtlpLogsPayload;
}

/** Decodes an OTLP/protobuf `ExportMetricsServiceRequest` body into the same shape
 * `mapOtlpMetricsToRows` (JSON path) already consumes — no separate mapping.
 * Metrics carry no id-like `bytes` fields, so no hex fixup pass is needed. */
export function decodeMetricsRequestProtobuf(bytes: Uint8Array): OtlpMetricsPayload {
  const type = lookupType("opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest");
  return type.toObject(type.decode(bytes), CONVERSION_OPTIONS) as unknown as OtlpMetricsPayload;
}
