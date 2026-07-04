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
      traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
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
      traceId: "5b8aa5a2d2c872e8321cf37308d69df2",
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
    expect(result.traces[0]!.traceId).toBe("5b8aa5a2d2c872e8321cf37308d69df2");
  });
});
