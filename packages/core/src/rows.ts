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
  /** `http.response.status_code` (current semconv) or `http.status_code` (legacy),
   * whichever the span carries — extracted from `attributes` into its own column so
   * `error_summary` can query it without unpacking JSONB. Null if the span has neither. */
  httpStatusCode: number | null;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

/**
 * `error_summary`'s `errorSpanCount` rule: an explicit OTLP ERROR status counts, and
 * so does any HTTP 4xx/5xx — attack visibility needs 401/429/404s to surface, not
 * just spans a producer bothered to mark ERROR (many client libraries only set span
 * status on 5xx, not on 4xx). Mirrored in packages/db's `errorSummary()` SQL
 * predicate; keep both in sync if this rule changes.
 */
export function isErrorSpan(span: Pick<SpanRow, "statusCode" | "httpStatusCode">): boolean {
  return span.statusCode === "error" || (span.httpStatusCode !== null && span.httpStatusCode >= 400);
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
