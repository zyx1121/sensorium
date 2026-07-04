/**
 * Signal model — the shapes ingest writes and mcp reads, one per OTel signal.
 * `project` always comes from the ingest-token binding (see packages/core/src/otlp.ts),
 * never from the client-supplied resource attributes.
 */

export interface Project {
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface LogRow {
  project: string;
  ts: Date;
  severity: string | null;
  body: string | null;
  traceId: string | null;
  spanId: string | null;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

export type SpanKind =
  | "unspecified"
  | "internal"
  | "server"
  | "client"
  | "producer"
  | "consumer";

export interface SpanRow {
  project: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startTs: Date;
  endTs: Date;
  durationMs: number;
  statusCode: string | null;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

export type MetricKind = "gauge" | "sum" | "histogram";

export interface MetricPointRow {
  project: string;
  metricName: string;
  ts: Date;
  kind: MetricKind;
  value: number;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
}

/** A span with its children resolved, for query_traces tool output. */
export interface SpanNode extends SpanRow {
  children: SpanNode[];
}
