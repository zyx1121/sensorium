import { createHash } from "node:crypto";
import type { LogRow, MetricPointRow, SpanRow } from "@sensorium/core";
import type { Pool } from "pg";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolves an ingest bearer token to its bound project name, or null if invalid. Token decides project, not client claims. */
export async function getProjectByToken(pool: Pool, token: string): Promise<string | null> {
  const { rows } = await pool.query<{ name: string }>(
    "select name from projects where ingest_token_hash = $1",
    [hashToken(token)],
  );
  return rows[0]?.name ?? null;
}

export async function touchProjectLastSeen(pool: Pool, project: string): Promise<void> {
  await pool.query("update projects set last_seen_at = now() where name = $1", [project]);
}

/** Registers (or rotates the token for) a project. Used by `bun run db:register-project`. */
export async function createProject(pool: Pool, name: string, token: string): Promise<void> {
  await pool.query(
    `insert into projects (name, ingest_token_hash) values ($1, $2)
     on conflict (name) do update set ingest_token_hash = excluded.ingest_token_hash`,
    [name, hashToken(token)],
  );
}

export interface ProjectSummary {
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  logsCount: number;
  spansCount: number;
  metricPointsCount: number;
}

export async function listProjects(pool: Pool): Promise<ProjectSummary[]> {
  const { rows: projects } = await pool.query<{
    name: string;
    created_at: Date;
    last_seen_at: Date | null;
  }>("select name, created_at, last_seen_at from projects order by name");

  const [logCounts, spanCounts, metricCounts] = await Promise.all([
    pool.query<{ project: string; count: string }>("select project, count(*) from logs group by project"),
    pool.query<{ project: string; count: string }>("select project, count(*) from spans group by project"),
    pool.query<{ project: string; count: string }>(
      "select project, count(*) from metric_points group by project",
    ),
  ]);
  const toMap = (rows: { project: string; count: string }[]) =>
    new Map(rows.map((r) => [r.project, Number(r.count)]));
  const logMap = toMap(logCounts.rows);
  const spanMap = toMap(spanCounts.rows);
  const metricMap = toMap(metricCounts.rows);

  return projects.map((p) => ({
    name: p.name,
    createdAt: p.created_at,
    lastSeenAt: p.last_seen_at,
    logsCount: logMap.get(p.name) ?? 0,
    spansCount: spanMap.get(p.name) ?? 0,
    metricPointsCount: metricMap.get(p.name) ?? 0,
  }));
}

// --- writes (ingest side) ---------------------------------------------

export async function insertLogs(pool: Pool, rows: LogRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = ["project", "ts", "severity", "body", "trace_id", "span_id", "resource", "attributes"];
  const tuples: string[] = [];
  const values: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * columns.length;
    tuples.push(`(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(
      row.project,
      row.ts,
      row.severity,
      row.body,
      row.traceId,
      row.spanId,
      JSON.stringify(row.resource),
      JSON.stringify(row.attributes),
    );
  });
  await pool.query(`insert into logs (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  return rows.length;
}

/** Upserts on (project, trace_id, span_id) so retried exports don't duplicate rows. */
export async function insertSpans(pool: Pool, rows: SpanRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = [
    "project",
    "trace_id",
    "span_id",
    "parent_span_id",
    "name",
    "kind",
    "start_ts",
    "end_ts",
    "duration_ms",
    "status_code",
    "http_status_code",
    "resource",
    "attributes",
  ];
  const tuples: string[] = [];
  const values: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * columns.length;
    tuples.push(`(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(
      row.project,
      row.traceId,
      row.spanId,
      row.parentSpanId,
      row.name,
      row.kind,
      row.startTs,
      row.endTs,
      row.durationMs,
      row.statusCode,
      row.httpStatusCode,
      JSON.stringify(row.resource),
      JSON.stringify(row.attributes),
    );
  });
  await pool.query(
    `insert into spans (${columns.join(", ")}) values ${tuples.join(", ")}
     on conflict (project, trace_id, span_id) do update set
       parent_span_id = excluded.parent_span_id,
       name = excluded.name,
       kind = excluded.kind,
       start_ts = excluded.start_ts,
       end_ts = excluded.end_ts,
       duration_ms = excluded.duration_ms,
       status_code = excluded.status_code,
       http_status_code = excluded.http_status_code,
       resource = excluded.resource,
       attributes = excluded.attributes`,
    values,
  );
  return rows.length;
}

export async function insertMetricPoints(pool: Pool, rows: MetricPointRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = ["project", "metric_name", "ts", "kind", "value", "attributes", "resource"];
  const tuples: string[] = [];
  const values: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * columns.length;
    tuples.push(`(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(
      row.project,
      row.metricName,
      row.ts,
      row.kind,
      row.value,
      JSON.stringify(row.attributes),
      JSON.stringify(row.resource),
    );
  });
  await pool.query(`insert into metric_points (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  return rows.length;
}

// --- reads (mcp side) ---------------------------------------------------

interface LogDbRow {
  project: string;
  ts: Date;
  severity: string | null;
  body: string | null;
  trace_id: string | null;
  span_id: string | null;
  resource: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
}

function rowToLogRow(row: LogDbRow): LogRow {
  return {
    project: row.project,
    ts: row.ts,
    severity: row.severity,
    body: row.body,
    traceId: row.trace_id,
    spanId: row.span_id,
    resource: row.resource ?? {},
    attributes: row.attributes ?? {},
  };
}

interface SpanDbRow {
  project: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: SpanRow["kind"];
  start_ts: Date;
  end_ts: Date;
  duration_ms: number;
  status_code: string | null;
  http_status_code: number | null;
  resource: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
}

function rowToSpanRow(row: SpanDbRow): SpanRow {
  return {
    project: row.project,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    kind: row.kind,
    startTs: row.start_ts,
    endTs: row.end_ts,
    durationMs: row.duration_ms,
    statusCode: row.status_code,
    httpStatusCode: row.http_status_code,
    resource: row.resource ?? {},
    attributes: row.attributes ?? {},
  };
}

const LOG_COLUMNS = "project, ts, severity, body, trace_id, span_id, resource, attributes";
const SPAN_COLUMNS =
  "project, trace_id, span_id, parent_span_id, name, kind, start_ts, end_ts, duration_ms, status_code, http_status_code, resource, attributes";

/**
 * SQL mirror of `packages/core`'s `isOutboundSpan()` — spans that are this service
 * calling OUT (e.g. `fetch()` to Supabase), not inbound requests it served. Used to
 * keep the callee's status out of `errorSummary`/`topSources`/`listTraces`. Keep in
 * sync with `isOutboundSpan` if that predicate changes.
 */
const OUTBOUND_SPAN_SQL = `(
    attributes ? 'http.client.name'
    or coalesce(attributes ->> 'operation.name', '') ilike 'fetch%'
    or kind = 'client'
  )`;

/** SQL mirror of `isInboundSpan()` — the fallback half not covered by `OUTBOUND_SPAN_SQL`. */
const INBOUND_SPAN_SQL = `(
    kind = 'server'
    or attributes ->> 'http.route' is not null
    or attributes ->> 'http.target' is not null
    or attributes ->> 'vercel.matched_path' is not null
  )`;

/**
 * SQL: derive a request's route from `http.route` if the producer set it, else parse
 * it out of the span's `name`. Vercel/Next.js never sets `http.route` (it's always
 * null on that producer) — instead it names inbound request spans
 * `"<METHOD> <path>"` (e.g. `"GET /profile/[id]/page"`). `regexp_replace` strips a
 * leading HTTP-method token + space when present; when the name doesn't start with
 * one it's a no-op, so span names from other producers still fall through as the
 * route unchanged. `http.route` always wins when present — keeps non-Vercel
 * producers (which DO set it) behaving exactly as before.
 *
 * Only decides what STRING to read as the route — callers MUST still gate on
 * `not OUTBOUND_SPAN_SQL` themselves (this fires on any span, and an outbound
 * span's name is never a route).
 */
function routeFromSpanSql(alias: string): string {
  return `coalesce(
    ${alias}.attributes ->> 'http.route',
    regexp_replace(${alias}.name, '^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ', '')
  )`;
}

export interface QueryLogsParams {
  project: string;
  since: Date;
  until?: Date;
  severity?: string;
  contains?: string;
  traceId?: string;
  /** Exact match against the `client.address` attribute (attacker-IP triage). */
  ip?: string;
  /** Exact match against the `http.route` attribute. */
  route?: string;
  limit?: number;
}

export async function queryLogs(pool: Pool, params: QueryLogsParams): Promise<LogRow[]> {
  const conditions = ["project = $1", "ts >= $2"];
  const values: unknown[] = [params.project, params.since];
  if (params.until) {
    values.push(params.until);
    conditions.push(`ts <= $${values.length}`);
  }
  if (params.severity) {
    values.push(params.severity);
    conditions.push(`severity = $${values.length}`);
  }
  if (params.contains) {
    values.push(`%${params.contains}%`);
    conditions.push(`body ilike $${values.length}`);
  }
  if (params.traceId) {
    values.push(params.traceId);
    conditions.push(`trace_id = $${values.length}`);
  }
  if (params.ip) {
    values.push(params.ip);
    conditions.push(`attributes ->> 'client.address' = $${values.length}`);
  }
  if (params.route) {
    values.push(params.route);
    conditions.push(`attributes ->> 'http.route' = $${values.length}`);
  }
  const limit = Math.min(params.limit ?? 100, 1000);
  values.push(limit);
  const { rows } = await pool.query<LogDbRow>(
    `select ${LOG_COLUMNS} from logs where ${conditions.join(" and ")} order by ts desc limit $${values.length}`,
    values,
  );
  return rows.map(rowToLogRow);
}

export async function queryTraceSpans(
  pool: Pool,
  params: { project: string; traceId: string },
): Promise<SpanRow[]> {
  const { rows } = await pool.query<SpanDbRow>(
    `select ${SPAN_COLUMNS} from spans where project = $1 and trace_id = $2 order by start_ts asc`,
    [params.project, params.traceId],
  );
  return rows.map(rowToSpanRow);
}

export interface ErrorSummary {
  project: string;
  windowMinutes: number;
  errorLogCount: number;
  errorSpanCount: number;
  topMessages: Array<{ body: string; count: number }>;
}

export async function errorSummary(
  pool: Pool,
  params: { project: string; windowMinutes: number },
): Promise<ErrorSummary> {
  const since = new Date(Date.now() - params.windowMinutes * 60_000);
  const [logCountRes, spanCountRes, topRes] = await Promise.all([
    pool.query<{ count: string }>(
      "select count(*) from logs where project = $1 and ts >= $2 and severity in ('ERROR', 'FATAL')",
      [params.project, since],
    ),
    // Mirrors packages/core's isErrorSpan(): an explicit OTLP ERROR status counts,
    // and so does any HTTP 4xx/5xx (401/429/404s need to show up for attack
    // visibility, not just spans a producer bothered to mark ERROR). Outbound spans
    // (this service's own fetch/db calls) are excluded — a callee's failure isn't
    // this service's error.
    pool.query<{ count: string }>(
      `select count(*) from spans
       where project = $1 and start_ts >= $2
       and (status_code = 'error' or http_status_code >= 400)
       and not ${OUTBOUND_SPAN_SQL}`,
      [params.project, since],
    ),
    pool.query<{ body: string; count: string }>(
      `select body, count(*) from logs
       where project = $1 and ts >= $2 and severity in ('ERROR', 'FATAL') and body is not null
       group by body order by count(*) desc limit 5`,
      [params.project, since],
    ),
  ]);
  return {
    project: params.project,
    windowMinutes: params.windowMinutes,
    errorLogCount: Number(logCountRes.rows[0]?.count ?? 0),
    errorSpanCount: Number(spanCountRes.rows[0]?.count ?? 0),
    topMessages: topRes.rows.map((r) => ({ body: r.body, count: Number(r.count) })),
  };
}

export interface TopSourceRoute {
  route: string;
  count: number;
}

export interface TopSource {
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  requestCount: number;
  errorCount: number;
  topRoutes: TopSourceRoute[];
}

export interface CountrySummary {
  country: string;
  requestCount: number;
  errorCount: number;
}

export interface TopSourcesResult {
  project: string;
  windowMinutes: number;
  sources: TopSource[];
  byCountry: CountrySummary[];
}

/**
 * Attribution/triage view over spans UNION logs: who (client.address / geo.*) is
 * calling what (http.route), how often, and with how many errors. On Vercel, the
 * `client.address`/`geo.*` attribution can land on either signal — a 429/401 often
 * shows up as a log record while the app's own root span never carries it — so
 * this reads whichever side has it, per source IP.
 *
 * `requestCount`/geo/`byCountry` stay derived from that client.address-carrying
 * row directly (unchanged). `topRoutes`/`errorCount` are trace-level joins: on
 * Vercel, `client.address`/`geo.*` commonly land on a root layout render span
 * that never carries `http.route`, while the sibling request span in the SAME
 * trace_id carries the route/status. So for each ip we collect every trace_id it
 * touched (via a span), then pull route/status from any INBOUND span in those
 * traces — not just the row that happened to carry the ip. Route itself comes
 * from `routeFromSpanSql`: `http.route` when a producer sets it, else parsed off
 * the span's `name` (Vercel never sets `http.route`, but names inbound spans
 * `"<METHOD> <path>"`). Logs keep the direct (non-joined) reading since a log's
 * own ip+route already sit on the same row (logs have no span `name` to fall
 * back on, so they still require `http.route`).
 *
 * Error rule: for spans, same as `errorSummary()` (OTLP error status or HTTP >= 400,
 * excluding outbound spans — see `OUTBOUND_SPAN_SQL`) read from the promoted
 * `status_code`/`http_status_code` columns; for logs, `severity in ('ERROR',
 * 'FATAL')`. `ip`/`route`/`geo.*` stay in `attributes` (jsonb) for v1; no new columns.
 */
export async function topSources(
  pool: Pool,
  params: { project: string; windowMinutes: number; limit?: number },
): Promise<TopSourcesResult> {
  const since = new Date(Date.now() - params.windowMinutes * 60_000);
  const limit = Math.min(params.limit ?? 20, 1000);

  // Shared by both queries below: spans+logs normalized to the same shape, filtered
  // to rows that carry a `client.address`. Outbound spans are dropped outright — an
  // attacker's IP never shows up on this service's own fetch-to-Supabase spans, and
  // excluding them keeps the error math from `errorSummary()` consistent here.
  const combinedCte = `
    with combined as (
      select
        attributes ->> 'client.address' as ip,
        attributes ->> 'geo.country' as country,
        attributes ->> 'geo.city' as city,
        attributes ->> 'geo.region' as region,
        start_ts as ts,
        (status_code = 'error' or http_status_code >= 400) as is_error
      from spans
      where project = $1 and start_ts >= $2
        and attributes ->> 'client.address' is not null
        and not ${OUTBOUND_SPAN_SQL}
      union all
      select
        attributes ->> 'client.address' as ip,
        attributes ->> 'geo.country' as country,
        attributes ->> 'geo.city' as city,
        attributes ->> 'geo.region' as region,
        ts,
        (severity in ('ERROR', 'FATAL')) as is_error
      from logs
      where project = $1 and ts >= $2 and attributes ->> 'client.address' is not null
    )
  `;

  // Trace-level join, only needed for the topRoutes/errorCount query below.
  const routeJoinCte = `
    -- Every trace_id an ip's span was seen on (same filter as combined's spans
    -- branch — outbound spans never establish attribution).
    , ip_traces as (
      select distinct attributes ->> 'client.address' as ip, trace_id
      from spans
      where project = $1 and start_ts >= $2
        and attributes ->> 'client.address' is not null
        and not ${OUTBOUND_SPAN_SQL}
    )
    -- Any INBOUND span carrying a route, anywhere in one of those traces — this
    -- is what recovers the route when it lives on a sibling span, not the one
    -- that carried the ip. "spans" is unaliased so OUTBOUND_SPAN_SQL/INBOUND_SPAN_SQL's
    -- bare kind/attributes references stay unambiguous (ip_traces has neither).
    -- Route comes from routeFromSpanSql: http.route if the producer set it, else
    -- parsed off the span name (Vercel's shape — see that function's doc comment).
    -- not OUTBOUND_SPAN_SQL keeps this service's own fetch spans (whose names can
    -- also start with a method, e.g. "fetch GET https://...supabase.co/...") out —
    -- inbound-ness is decided by kind/route-attrs, never by the name string alone.
    , span_routes as (
      select ip_traces.ip,
        ${routeFromSpanSql("spans")} as route,
        (spans.status_code = 'error' or spans.http_status_code >= 400) as is_error
      from ip_traces
      join spans on spans.project = $1 and spans.trace_id = ip_traces.trace_id
      where spans.start_ts >= $2
        and not ${OUTBOUND_SPAN_SQL}
        and ${INBOUND_SPAN_SQL}
    )
    -- Log-side: ip + route already sit on the same log row (e.g. a 429/401 log)
    -- so no trace hop is needed here.
    , log_routes as (
      select attributes ->> 'client.address' as ip,
        attributes ->> 'http.route' as route,
        (severity in ('ERROR', 'FATAL')) as is_error
      from logs
      where project = $1 and ts >= $2
        and attributes ->> 'client.address' is not null
        and attributes ->> 'http.route' is not null
    )
    , route_hits as (
      select ip, route, is_error from span_routes
      union all
      select ip, route, is_error from log_routes
    )
  `;

  const [sourcesRes, countryRes] = await Promise.all([
    pool.query<{
      ip: string;
      total: string;
      errors: string;
      country: string | null;
      city: string | null;
      region: string | null;
      top_routes: TopSourceRoute[];
    }>(
      `${combinedCte}${routeJoinCte},
       agg as (
         select ip, count(*) as total
         from combined
         group by ip
       ),
       error_agg as (
         select ip, count(*) filter (where is_error) as errors
         from route_hits
         group by ip
       ),
       -- geo for an IP can drift (VPN/mobile carrier reassignment); take the most
       -- recent sighting's geo (span or log, whichever is newer), not an arbitrary one.
       latest_geo as (
         select distinct on (ip) ip, country, city, region
         from combined
         order by ip, ts desc
       ),
       ranked_routes as (
         select ip, route, count(*) as cnt,
           row_number() over (partition by ip order by count(*) desc, route asc) as rn
         from route_hits
         where route is not null
         group by ip, route
       ),
       routes as (
         select ip, route, cnt from ranked_routes where rn <= 5
       )
       select a.ip, a.total, coalesce(e.errors, 0) as errors, g.country, g.city, g.region,
         coalesce(
           json_agg(json_build_object('route', r.route, 'count', r.cnt) order by r.cnt desc, r.route asc)
             filter (where r.route is not null),
           '[]'
         ) as top_routes
       from agg a
       left join error_agg e on e.ip = a.ip
       left join latest_geo g on g.ip = a.ip
       left join routes r on r.ip = a.ip
       group by a.ip, a.total, e.errors, g.country, g.city, g.region
       order by a.total desc, a.ip asc
       limit $3`,
      [params.project, since, limit],
    ),
    pool.query<{ country: string; total: string; errors: string }>(
      `${combinedCte}
       select
         coalesce(country, 'unknown') as country,
         count(*) as total,
         count(*) filter (where is_error) as errors
       from combined
       group by coalesce(country, 'unknown')
       order by total desc, country asc`,
      [params.project, since],
    ),
  ]);

  return {
    project: params.project,
    windowMinutes: params.windowMinutes,
    sources: sourcesRes.rows.map((r) => ({
      ip: r.ip,
      country: r.country,
      city: r.city,
      region: r.region,
      requestCount: Number(r.total),
      errorCount: Number(r.errors),
      topRoutes: r.top_routes,
    })),
    byCountry: countryRes.rows.map((r) => ({
      country: r.country,
      requestCount: Number(r.total),
      errorCount: Number(r.errors),
    })),
  };
}

export interface RecentTrace {
  traceId: string;
  spanId: string;
  name: string;
  route: string | null;
  httpStatusCode: number | null;
  clientAddress: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  startTs: Date;
}

export interface ListTracesResult {
  project: string;
  windowMinutes: number;
  traces: RecentTrace[];
}

/**
 * Browsing entry point for when you don't have a traceId yet: one row per
 * trace_id (deduped), newest first. The representative row is the earliest
 * inbound request span in that trace (server-kind, or carrying route-ish
 * attributes — see `INBOUND_SPAN_SQL`/`isInboundSpan`) for its name/route/status.
 * `route` is `routeFromSpanSql`'s `http.route`-or-parsed-name (see `topSources`'
 * doc comment) so it's populated even for producers like Vercel that never set
 * `http.route`.
 * `clientAddress`/geo are backfilled from ANY span in the same trace — on
 * Vercel these commonly land on a sibling (often the root layout render) span
 * rather than the request span itself, so reading only the representative row
 * would leave them null even though the trace has them. Prefers the earliest
 * span that actually carries a `client.address`; a trace with none still lists,
 * with `clientAddress: null`. Excludes outbound spans (this service's own
 * fetch/db calls) from the representative pick, same as `errorSummary`/
 * `topSources`. Feed a `traceId` from here into `query_traces` for the full
 * span tree of one request.
 */
export async function listTraces(
  pool: Pool,
  params: { project: string; windowMinutes: number; limit?: number },
): Promise<ListTracesResult> {
  const since = new Date(Date.now() - params.windowMinutes * 60_000);
  const limit = Math.min(params.limit ?? 30, 1000);
  const { rows } = await pool.query<{
    trace_id: string;
    span_id: string;
    name: string;
    start_ts: Date;
    route: string | null;
    http_status_code: number | null;
    client_address: string | null;
    country: string | null;
    city: string | null;
    region: string | null;
  }>(
    `with in_window as (
       select trace_id, span_id, name, start_ts, http_status_code,
         ${routeFromSpanSql("spans")} as route
       from spans
       where project = $1 and start_ts >= $2
         and not ${OUTBOUND_SPAN_SQL}
         and ${INBOUND_SPAN_SQL}
     ),
     -- One representative span per trace: the earliest inbound span in it.
     representative as (
       select distinct on (trace_id) trace_id, span_id, name, start_ts, http_status_code, route
       from in_window
       order by trace_id, start_ts asc
     ),
     top_traces as (
       select * from representative order by start_ts desc limit $3
     ),
     -- Backfill client.address/geo.* from any span in the same trace, preferring
     -- the earliest span that actually carries a client.address (falls back to
     -- null if none of the trace's spans do).
     attribution as (
       select distinct on (spans.trace_id)
         spans.trace_id,
         spans.attributes ->> 'client.address' as client_address,
         spans.attributes ->> 'geo.country' as country,
         spans.attributes ->> 'geo.city' as city,
         spans.attributes ->> 'geo.region' as region
       from top_traces
       join spans on spans.project = $1 and spans.trace_id = top_traces.trace_id
       order by spans.trace_id,
         (case when spans.attributes ->> 'client.address' is not null then 0 else 1 end),
         spans.start_ts asc
     )
     select
       top_traces.trace_id, top_traces.span_id, top_traces.name, top_traces.start_ts,
       top_traces.http_status_code, top_traces.route,
       attribution.client_address, attribution.country, attribution.city, attribution.region
     from top_traces
     left join attribution on attribution.trace_id = top_traces.trace_id
     order by top_traces.start_ts desc`,
    [params.project, since, limit],
  );
  return {
    project: params.project,
    windowMinutes: params.windowMinutes,
    traces: rows.map((r) => ({
      traceId: r.trace_id,
      spanId: r.span_id,
      name: r.name,
      route: r.route,
      httpStatusCode: r.http_status_code,
      clientAddress: r.client_address,
      country: r.country,
      city: r.city,
      region: r.region,
      startTs: r.start_ts,
    })),
  };
}

export async function searchLogs(
  pool: Pool,
  params: { project: string; q: string; since: Date; limit?: number },
): Promise<LogRow[]> {
  const limit = Math.min(params.limit ?? 100, 1000);
  const { rows } = await pool.query<LogDbRow>(
    `select ${LOG_COLUMNS} from logs
     where project = $1 and ts >= $2 and (body ilike $3 or attributes::text ilike $3)
     order by ts desc limit $4`,
    [params.project, params.since, `%${params.q}%`, limit],
  );
  return rows.map(rowToLogRow);
}
