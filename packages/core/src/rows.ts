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
   * `error_summary` can query it without unpacking JSONB. Only populated for inbound
   * spans (see `isInboundSpan`); null for outbound calls and spans with neither
   * attribute, so a callee's status never gets read as this service's own. */
  httpStatusCode: number | null;
  resource: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

/**
 * True when a span is THIS service calling OUT to something else (e.g. an
 * instrumented `fetch()` to Supabase) rather than an inbound request this
 * service served. On Vercel/Next.js both kinds of spans commonly carry an
 * `http.status_code`-shaped attribute — without this check, a Supabase 500
 * looks identical to this service returning a 500 to its own caller.
 */
export function isOutboundSpan(span: Pick<SpanRow, "kind" | "attributes">): boolean {
  const { attributes } = span;
  if (typeof attributes["http.client.name"] === "string") return true;
  const operationName = attributes["operation.name"];
  if (typeof operationName === "string" && operationName.toLowerCase().startsWith("fetch")) return true;
  return span.kind === "client";
}

/**
 * True when a span is an inbound request this service served — the only kind
 * `http_status_code` gets populated for (see `mapOtlpTracesToRows`).
 * `kind === "server"` is the canonical OTLP signal, but Vercel/Next.js root
 * spans frequently come through as "internal" with no SERVER kind set, so
 * route-ish attributes are a fallback. Outbound hints win over inbound ones —
 * a span can't be both.
 */
export function isInboundSpan(span: Pick<SpanRow, "kind" | "attributes">): boolean {
  if (isOutboundSpan(span)) return false;
  if (span.kind === "server") return true;
  const { attributes } = span;
  return (
    typeof attributes["http.route"] === "string" ||
    typeof attributes["http.target"] === "string" ||
    typeof attributes["vercel.matched_path"] === "string"
  );
}

/**
 * `error_summary`'s `errorSpanCount` rule: an explicit OTLP ERROR status counts, and
 * so does any HTTP 4xx/5xx — attack visibility needs 401/429/404s to surface, not
 * just spans a producer bothered to mark ERROR (many client libraries only set span
 * status on 5xx, not on 4xx). Outbound spans (this service's own fetch/db calls) are
 * excluded outright — a callee's failure isn't this service's error. Mirrored in
 * packages/db's `errorSummary()`/`topSources()` SQL predicates; keep in sync if this
 * rule changes.
 */
export function isErrorSpan(
  span: Pick<SpanRow, "statusCode" | "httpStatusCode" | "kind" | "attributes">,
): boolean {
  if (isOutboundSpan(span)) return false;
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
