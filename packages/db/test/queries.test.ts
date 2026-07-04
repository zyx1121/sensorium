import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpanRow } from "@sensorium/core";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate.js";
import {
  createProject,
  errorSummary,
  insertLogs,
  insertSpans,
  listTraces,
  queryLogs,
  topSources,
} from "../src/queries.js";

// Integration tests against a real Postgres — require DATABASE_URL (see README's
// "Local development" for how to stand one up). Skipped, not failed, when absent
// so `bun run test` stays green on machines without a local DB.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("topSources + source filters (integration, requires DATABASE_URL)", () => {
  let pool: Pool;
  let now: number;
  const project = `test-geo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  function makeSpan(overrides: Partial<SpanRow> & Pick<SpanRow, "attributes" | "startTs" | "endTs">): SpanRow {
    return {
      project,
      // Distinct per span by default (real requests each get their own trace_id) —
      // tests that need sibling spans in ONE trace override this explicitly.
      traceId: Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32),
      spanId: Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16),
      parentSpanId: null,
      name: "handler",
      kind: "server",
      durationMs: 10,
      statusCode: "ok",
      httpStatusCode: 200,
      resource: {},
      ...overrides,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await runMigrations(pool);
    await createProject(pool, project, `token-${project}`);

    now = Date.now();

    // Attacker-shaped traffic: one IP (1.2.3.4) hammering two routes across a
    // geo hop (TW -> CN, e.g. VPN egress change), one clean IP (5.6.7.8).
    const spans: SpanRow[] = [
      makeSpan({
        startTs: new Date(now - 5 * 60_000),
        endTs: new Date(now - 5 * 60_000 + 10),
        statusCode: "ok",
        httpStatusCode: 200,
        attributes: {
          "client.address": "1.2.3.4",
          "geo.country": "TW",
          "geo.city": "Taipei",
          "geo.region": "Taipei City",
          "http.route": "/api/login",
        },
      }),
      makeSpan({
        startTs: new Date(now - 4 * 60_000),
        endTs: new Date(now - 4 * 60_000 + 10),
        statusCode: "unset",
        httpStatusCode: 404,
        attributes: {
          "client.address": "1.2.3.4",
          "geo.country": "TW",
          "geo.city": "Taipei",
          "geo.region": "Taipei City",
          "http.route": "/api/login",
        },
      }),
      makeSpan({
        startTs: new Date(now - 1 * 60_000),
        endTs: new Date(now - 1 * 60_000 + 10),
        statusCode: "error",
        httpStatusCode: 500,
        attributes: {
          "client.address": "1.2.3.4",
          "geo.country": "CN",
          "geo.city": "Beijing",
          "geo.region": "Beijing",
          "http.route": "/api/users",
        },
      }),
      makeSpan({
        startTs: new Date(now - 2 * 60_000),
        endTs: new Date(now - 2 * 60_000 + 10),
        statusCode: "ok",
        httpStatusCode: 200,
        attributes: {
          "client.address": "5.6.7.8",
          "geo.country": "US",
          "geo.city": "New York",
          "geo.region": "NY",
          "http.route": "/api/ping",
        },
      }),
      // Outbound fetch span (this service calling Supabase) — even though it
      // happens to carry a client.address, it must never surface in top_sources:
      // that'd misattribute the callee's traffic/status as an inbound source.
      makeSpan({
        kind: "client",
        startTs: new Date(now - 6 * 60_000),
        endTs: new Date(now - 6 * 60_000 + 10),
        statusCode: "error",
        httpStatusCode: 500,
        attributes: {
          "http.client.name": "fetch",
          "operation.name": "fetch.GET",
          "http.host": "xyz.supabase.co",
          "client.address": "3.3.3.4",
          "geo.country": "DE",
        },
      }),
    ];
    await insertSpans(pool, spans);

    await insertLogs(pool, [
      {
        project,
        ts: new Date(now - 3 * 60_000),
        severity: "INFO",
        body: "handled login request",
        traceId: null,
        spanId: null,
        resource: {},
        attributes: { "client.address": "1.2.3.4", "http.route": "/api/login" },
      },
      // Log-only source: no span carries this IP at all — Vercel sometimes puts
      // client.address/geo.* on the log record (429/401) rather than the span.
      {
        project,
        ts: new Date(now - 2.5 * 60_000),
        severity: "ERROR",
        body: "rate limited",
        traceId: null,
        spanId: null,
        resource: {},
        attributes: {
          "client.address": "9.9.9.9",
          "geo.country": "JP",
          "http.route": "/api/orders",
        },
      },
    ]);
  });

  afterAll(async () => {
    await pool.query("delete from spans where project = $1", [project]);
    await pool.query("delete from logs where project = $1", [project]);
    await pool.query("delete from projects where name = $1", [project]);
    await pool.end();
  });

  test("aggregates request/error counts and top routes per source IP across spans + logs, sorted by request count", async () => {
    const result = await topSources(pool, { project, windowMinutes: 60 });
    // 1.2.3.4 (3 spans + 1 log), 5.6.7.8 (1 span), 9.9.9.9 (1 log, no span at all).
    // 3.3.3.4 (the outbound fetch span) must never appear.
    expect(result.sources).toHaveLength(3);
    expect(result.sources.map((s) => s.ip)).not.toContain("3.3.3.4");

    const ip1 = result.sources[0]!;
    expect(ip1.ip).toBe("1.2.3.4");
    expect(ip1.requestCount).toBe(4); // 3 spans + 1 log
    expect(ip1.errorCount).toBe(2); // 404 + 500 spans (widened >=400 rule); the log is INFO
    expect(ip1.country).toBe("CN"); // most recent sighting across spans+logs, not the first
    expect(ip1.city).toBe("Beijing");
    expect(ip1.region).toBe("Beijing");
    expect(ip1.topRoutes).toEqual([
      { route: "/api/login", count: 3 }, // 2 spans + the log, same route
      { route: "/api/users", count: 1 },
    ]);

    const ip2 = result.sources.find((s) => s.ip === "5.6.7.8")!;
    expect(ip2.requestCount).toBe(1);
    expect(ip2.errorCount).toBe(0);
    expect(ip2.country).toBe("US");
    expect(ip2.topRoutes).toEqual([{ route: "/api/ping", count: 1 }]);

    // Log-only source: surfaces even though no span ever carried this IP.
    const ip3 = result.sources.find((s) => s.ip === "9.9.9.9")!;
    expect(ip3.requestCount).toBe(1);
    expect(ip3.errorCount).toBe(1); // ERROR severity log
    expect(ip3.country).toBe("JP");
    expect(ip3.topRoutes).toEqual([{ route: "/api/orders", count: 1 }]);
  });

  test("by-country rollup unions spans + logs and never counts the outbound span's DE", async () => {
    const result = await topSources(pool, { project, windowMinutes: 60 });
    const byCountry = new Map(result.byCountry.map((c) => [c.country, c]));
    expect(byCountry.get("DE")).toBeUndefined(); // outbound span's geo must not leak in
    expect(byCountry.get("TW")).toEqual({ country: "TW", requestCount: 2, errorCount: 1 });
    expect(byCountry.get("CN")).toEqual({ country: "CN", requestCount: 1, errorCount: 1 });
    expect(byCountry.get("US")).toEqual({ country: "US", requestCount: 1, errorCount: 0 });
    expect(byCountry.get("JP")).toEqual({ country: "JP", requestCount: 1, errorCount: 1 });
    expect(byCountry.get("unknown")).toEqual({ country: "unknown", requestCount: 1, errorCount: 0 }); // the geo-less log
    // TW has the most requests, so it's first regardless of how ties collate.
    expect(result.byCountry[0]).toEqual({ country: "TW", requestCount: 2, errorCount: 1 });
  });

  test("limit clamps the number of returned source IPs", async () => {
    const result = await topSources(pool, { project, windowMinutes: 60, limit: 1 });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.ip).toBe("1.2.3.4");
  });

  test("a window that excludes all fixture spans returns no sources", async () => {
    const result = await topSources(pool, { project, windowMinutes: 0 });
    expect(result.sources).toEqual([]);
    expect(result.byCountry).toEqual([]);
  });

  test("query_logs ip/route filters narrow to the matching attribute", async () => {
    const since = new Date(now - 60 * 60_000);

    const byIp = await queryLogs(pool, { project, since, ip: "1.2.3.4" });
    expect(byIp).toHaveLength(1);
    expect(byIp[0]!.attributes["client.address"]).toBe("1.2.3.4");

    const byRoute = await queryLogs(pool, { project, since, route: "/api/login" });
    expect(byRoute).toHaveLength(1);

    const noMatch = await queryLogs(pool, { project, since, ip: "1.1.1.1" });
    expect(noMatch).toHaveLength(0);
  });
});

describe.skipIf(!DATABASE_URL)("errorSummary + listTraces inbound-only (integration, requires DATABASE_URL)", () => {
  let pool: Pool;
  const project = `test-inbound-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  function makeSpan(overrides: Partial<SpanRow> & Pick<SpanRow, "attributes" | "startTs" | "endTs">): SpanRow {
    return {
      project,
      // Distinct per span by default (real requests each get their own trace_id) —
      // tests that need sibling spans in ONE trace override this explicitly.
      traceId: Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32),
      spanId: Math.random().toString(16).slice(2).padEnd(16, "0").slice(0, 16),
      parentSpanId: null,
      name: "handler",
      kind: "server",
      durationMs: 10,
      statusCode: "ok",
      httpStatusCode: 200,
      resource: {},
      ...overrides,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await runMigrations(pool);
    await createProject(pool, project, `token-${project}`);

    const now = Date.now();
    await insertSpans(pool, [
      // Inbound, healthy.
      makeSpan({
        name: "GET /api/ping",
        startTs: new Date(now - 5 * 60_000),
        endTs: new Date(now - 5 * 60_000 + 10),
        statusCode: "ok",
        httpStatusCode: 200,
        attributes: { "http.route": "/api/ping" },
      }),
      // Inbound, 404 — the only one that should count as an error.
      makeSpan({
        name: "GET /api/missing",
        startTs: new Date(now - 4 * 60_000),
        endTs: new Date(now - 4 * 60_000 + 10),
        statusCode: "unset",
        httpStatusCode: 404,
        attributes: { "http.route": "/api/missing" },
      }),
      // Outbound fetch to Supabase, 500 — must NOT count as this service's error
      // and must NOT show up in list_traces.
      makeSpan({
        name: "fetch.GET",
        kind: "client",
        startTs: new Date(now - 3 * 60_000),
        endTs: new Date(now - 3 * 60_000 + 10),
        statusCode: "error",
        httpStatusCode: 500,
        attributes: {
          "http.client.name": "fetch",
          "operation.name": "fetch.GET",
          "http.host": "xyz.supabase.co",
        },
      }),
    ]);
  });

  afterAll(async () => {
    await pool.query("delete from spans where project = $1", [project]);
    await pool.query("delete from projects where name = $1", [project]);
    await pool.end();
  });

  test("errorSummary counts only the inbound 404, not the outbound 500", async () => {
    const summary = await errorSummary(pool, { project, windowMinutes: 60 });
    expect(summary.errorSpanCount).toBe(1);
  });

  test("listTraces returns only inbound spans, newest first, no traceId needed", async () => {
    const result = await listTraces(pool, { project, windowMinutes: 60 });
    expect(result.traces.map((t) => t.name)).toEqual(["GET /api/missing", "GET /api/ping"]);
    expect(result.traces.some((t) => t.name === "fetch.GET")).toBe(false);
    expect(result.traces[0]!.httpStatusCode).toBe(404);
    expect(result.traces[0]!.route).toBe("/api/missing");
    // Each span in this fixture is its own trace (makeSpan's default traceId is
    // random per span) — one distinct trace_id per row, still no cross-trace mixing.
    expect(new Set(result.traces.map((t) => t.traceId)).size).toBe(2);
  });
});

describe.skipIf(!DATABASE_URL)(
  "trace-level join: client.address on one span, http.route on a sibling span (integration, requires DATABASE_URL)",
  () => {
    let pool: Pool;
    let now: number;
    const project = `test-tracejoin-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // Real shape on Vercel (per live investigation): the root layout render span
    // carries client.address/geo.* with no http.route, while the sibling request
    // span in the SAME trace carries http.route/status with no client.address.
    function span(
      overrides: Partial<SpanRow> & Pick<SpanRow, "attributes" | "traceId" | "spanId" | "startTs" | "endTs">,
    ): SpanRow {
      return {
        project,
        parentSpanId: null,
        name: "span",
        kind: "internal",
        durationMs: 5,
        statusCode: null,
        httpStatusCode: null,
        resource: {},
        ...overrides,
      };
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await runMigrations(pool);
      await createProject(pool, project, `token-${project}`);

      now = Date.now();

      await insertSpans(pool, [
        // Trace A — ip1's first request: layout span carries ip/geo, no route;
        // sibling request span carries route/status, no ip.
        span({
          traceId: "trace-a",
          spanId: "span-a-layout",
          name: "root layout",
          startTs: new Date(now - 5 * 60_000),
          endTs: new Date(now - 5 * 60_000 + 10),
          attributes: {
            "client.address": "140.113.194.1",
            "geo.country": "TW",
            "geo.city": "Taipei",
            "geo.region": "Taipei City",
          },
        }),
        span({
          traceId: "trace-a",
          spanId: "span-a-request",
          name: "GET /profile/[id]/page",
          startTs: new Date(now - 5 * 60_000 + 1),
          endTs: new Date(now - 5 * 60_000 + 11),
          statusCode: "ok",
          httpStatusCode: 200,
          attributes: { "http.route": "/profile/[id]/page" },
        }),
        // Trace B — ip1's second request, in a DIFFERENT trace, that errors
        // (500). Proves topRoutes/errorCount are joined per-trace, not just
        // read off whichever single row happened to carry the ip.
        span({
          traceId: "trace-b",
          spanId: "span-b-layout",
          name: "root layout",
          startTs: new Date(now - 4 * 60_000),
          endTs: new Date(now - 4 * 60_000 + 10),
          attributes: {
            "client.address": "140.113.194.1",
            "geo.country": "TW",
            "geo.city": "Taipei",
            "geo.region": "Taipei City",
          },
        }),
        span({
          traceId: "trace-b",
          spanId: "span-b-request",
          name: "GET /api/orders",
          startTs: new Date(now - 4 * 60_000 + 1),
          endTs: new Date(now - 4 * 60_000 + 11),
          statusCode: "error",
          httpStatusCode: 500,
          attributes: { "http.route": "/api/orders" },
        }),
        // Trace C — a different ip entirely, must not leak into ip1's routes.
        span({
          traceId: "trace-c",
          spanId: "span-c-layout",
          name: "root layout",
          startTs: new Date(now - 3 * 60_000),
          endTs: new Date(now - 3 * 60_000 + 10),
          attributes: {
            "client.address": "5.6.7.8",
            "geo.country": "US",
            "geo.city": "New York",
            "geo.region": "NY",
          },
        }),
        span({
          traceId: "trace-c",
          spanId: "span-c-request",
          name: "GET /home",
          startTs: new Date(now - 3 * 60_000 + 1),
          endTs: new Date(now - 3 * 60_000 + 11),
          statusCode: "ok",
          httpStatusCode: 200,
          attributes: { "http.route": "/home" },
        }),
      ]);
    });

    afterAll(async () => {
      await pool.query("delete from spans where project = $1", [project]);
      await pool.query("delete from projects where name = $1", [project]);
      await pool.end();
    });

    test("topSources recovers topRoutes/errorCount from the sibling request span via trace_id, across multiple traces/ips", async () => {
      const result = await topSources(pool, { project, windowMinutes: 60 });
      expect(result.sources).toHaveLength(2);

      const ip1 = result.sources.find((s) => s.ip === "140.113.194.1")!;
      expect(ip1.requestCount).toBe(2); // the 2 layout spans that carried the ip (unchanged rule)
      expect(ip1.errorCount).toBe(1); // trace-b's 500, joined in via trace_id
      expect(ip1.topRoutes).toEqual([
        { route: "/api/orders", count: 1 },
        { route: "/profile/[id]/page", count: 1 },
      ]);
      expect(ip1.country).toBe("TW");

      const ip2 = result.sources.find((s) => s.ip === "5.6.7.8")!;
      expect(ip2.requestCount).toBe(1);
      expect(ip2.errorCount).toBe(0);
      expect(ip2.topRoutes).toEqual([{ route: "/home", count: 1 }]);
    });

    test("listTraces dedupes by trace_id (one row per trace) and backfills clientAddress/geo from the sibling layout span", async () => {
      const result = await listTraces(pool, { project, windowMinutes: 60 });
      expect(result.traces).toHaveLength(3); // one row per trace, not per span

      const traceA = result.traces.find((t) => t.traceId === "trace-a")!;
      expect(traceA.name).toBe("GET /profile/[id]/page");
      expect(traceA.route).toBe("/profile/[id]/page");
      expect(traceA.httpStatusCode).toBe(200);
      expect(traceA.clientAddress).toBe("140.113.194.1"); // backfilled from span-a-layout
      expect(traceA.country).toBe("TW");

      const traceB = result.traces.find((t) => t.traceId === "trace-b")!;
      expect(traceB.route).toBe("/api/orders");
      expect(traceB.httpStatusCode).toBe(500);
      expect(traceB.clientAddress).toBe("140.113.194.1");

      const traceC = result.traces.find((t) => t.traceId === "trace-c")!;
      expect(traceC.clientAddress).toBe("5.6.7.8");
      expect(traceC.country).toBe("US");

      // Newest first across traces: trace-c (3m ago), trace-b (4m ago), trace-a (5m ago).
      expect(result.traces.map((t) => t.traceId)).toEqual(["trace-c", "trace-b", "trace-a"]);
    });
  },
);

describe.skipIf(!DATABASE_URL)(
  "route from span name when http.route is null — Vercel shape (integration, requires DATABASE_URL)",
  () => {
    let pool: Pool;
    let now: number;
    const project = `test-routename-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    function span(
      overrides: Partial<SpanRow> & Pick<SpanRow, "attributes" | "traceId" | "spanId" | "startTs" | "endTs">,
    ): SpanRow {
      return {
        project,
        parentSpanId: null,
        name: "span",
        kind: "internal",
        durationMs: 5,
        statusCode: "ok",
        httpStatusCode: 200,
        resource: {},
        ...overrides,
      };
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await runMigrations(pool);
      await createProject(pool, project, `token-${project}`);

      now = Date.now();

      await insertSpans(pool, [
        // Trace A — client.address on a sibling layout span (no http.route ever
        // set anywhere in this trace); the inbound request span is SERVER-kind
        // (Vercel's real shape) and only carries a name like "GET /profile/[id]/page" —
        // no http.route attribute at all. Route must be parsed from the name.
        span({
          traceId: "trace-name-a",
          spanId: "span-a-layout",
          name: "root layout",
          startTs: new Date(now - 5 * 60_000),
          endTs: new Date(now - 5 * 60_000 + 10),
          attributes: {
            "client.address": "140.113.194.1",
            "geo.country": "TW",
            "geo.city": "Taipei",
            "geo.region": "Taipei City",
          },
        }),
        span({
          traceId: "trace-name-a",
          spanId: "span-a-request",
          name: "GET /profile/[id]/page",
          kind: "server",
          startTs: new Date(now - 5 * 60_000 + 1),
          endTs: new Date(now - 5 * 60_000 + 11),
          statusCode: "ok",
          httpStatusCode: 200,
          attributes: {},
        }),
        // Trace B — same ip, a request span that HAS http.route set as well as a
        // method-prefixed name; http.route must win (non-Vercel producer compat).
        span({
          traceId: "trace-name-b",
          spanId: "span-b-layout",
          name: "root layout",
          startTs: new Date(now - 4 * 60_000),
          endTs: new Date(now - 4 * 60_000 + 10),
          attributes: {
            "client.address": "140.113.194.1",
            "geo.country": "TW",
          },
        }),
        span({
          traceId: "trace-name-b",
          spanId: "span-b-request",
          name: "POST /api/orders",
          kind: "server",
          startTs: new Date(now - 4 * 60_000 + 1),
          endTs: new Date(now - 4 * 60_000 + 11),
          statusCode: "ok",
          httpStatusCode: 200,
          attributes: { "http.route": "/api/orders/[id]" },
        }),
        // Trace C — same ip; the ONLY inbound-adjacent span in the trace is an
        // outbound fetch to Supabase whose name also happens to start with a
        // method token ("GET "). It must never contribute a route: it's outbound
        // (kind = client, http.client.name = fetch), so the not OUTBOUND_SPAN_SQL
        // gate drops it before the name is ever parsed.
        span({
          traceId: "trace-name-c",
          spanId: "span-c-layout",
          name: "root layout",
          startTs: new Date(now - 3 * 60_000),
          endTs: new Date(now - 3 * 60_000 + 10),
          attributes: {
            "client.address": "140.113.194.1",
            "geo.country": "TW",
          },
        }),
        span({
          traceId: "trace-name-c",
          spanId: "span-c-fetch",
          name: "GET https://xyz.supabase.co/rest/v1/orders",
          kind: "client",
          startTs: new Date(now - 3 * 60_000 + 1),
          endTs: new Date(now - 3 * 60_000 + 11),
          statusCode: "ok",
          httpStatusCode: 200,
          attributes: { "http.client.name": "fetch", "operation.name": "fetch.GET" },
        }),
      ]);
    });

    afterAll(async () => {
      await pool.query("delete from spans where project = $1", [project]);
      await pool.query("delete from projects where name = $1", [project]);
      await pool.end();
    });

    test("topSources parses the route out of the span name when http.route is null", async () => {
      const result = await topSources(pool, { project, windowMinutes: 60 });
      const ip = result.sources.find((s) => s.ip === "140.113.194.1")!;
      expect(ip.topRoutes).toEqual([
        { route: "/api/orders/[id]", count: 1 }, // http.route wins over the "POST /api/orders" name
        { route: "/profile/[id]/page", count: 1 }, // parsed from "GET /profile/[id]/page"
      ]);
      // trace-name-c's outbound fetch span must never surface as a route.
      expect(ip.topRoutes.map((r) => r.route)).not.toContain("https://xyz.supabase.co/rest/v1/orders");
      expect(ip.topRoutes.map((r) => r.route)).not.toContain("GET https://xyz.supabase.co/rest/v1/orders");
    });

    test("listTraces also fills route from the span name when http.route is null", async () => {
      const result = await listTraces(pool, { project, windowMinutes: 60 });
      const traceA = result.traces.find((t) => t.traceId === "trace-name-a")!;
      expect(traceA.name).toBe("GET /profile/[id]/page");
      expect(traceA.route).toBe("/profile/[id]/page");

      const traceB = result.traces.find((t) => t.traceId === "trace-name-b")!;
      expect(traceB.route).toBe("/api/orders/[id]");

      // trace-name-c has no inbound span at all (only the outbound fetch) — it
      // must not appear in list_traces.
      expect(result.traces.some((t) => t.traceId === "trace-name-c")).toBe(false);
    });
  },
);
