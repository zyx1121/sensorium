import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpanRow } from "@sensorium/core";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate.js";
import { createProject, insertLogs, insertSpans, queryLogs, topSources } from "../src/queries.js";

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
    ]);
  });

  afterAll(async () => {
    await pool.query("delete from spans where project = $1", [project]);
    await pool.query("delete from logs where project = $1", [project]);
    await pool.query("delete from projects where name = $1", [project]);
    await pool.end();
  });

  test("aggregates request/error counts and top routes per source IP, sorted by request count", async () => {
    const result = await topSources(pool, { project, windowMinutes: 60 });
    expect(result.sources).toHaveLength(2);

    const ip1 = result.sources[0]!;
    expect(ip1.ip).toBe("1.2.3.4");
    expect(ip1.requestCount).toBe(3);
    expect(ip1.errorCount).toBe(2); // 404 + 500 (widened >=400 rule)
    expect(ip1.country).toBe("CN"); // most recent sighting, not the first
    expect(ip1.city).toBe("Beijing");
    expect(ip1.region).toBe("Beijing");
    expect(ip1.topRoutes).toEqual([
      { route: "/api/login", count: 2 },
      { route: "/api/users", count: 1 },
    ]);

    const ip2 = result.sources[1]!;
    expect(ip2.ip).toBe("5.6.7.8");
    expect(ip2.requestCount).toBe(1);
    expect(ip2.errorCount).toBe(0);
    expect(ip2.country).toBe("US");
    expect(ip2.topRoutes).toEqual([{ route: "/api/ping", count: 1 }]);
  });

  test("by-country rollup counts each request's own geo tag (not the per-IP latest)", async () => {
    const result = await topSources(pool, { project, windowMinutes: 60 });
    expect(result.byCountry).toEqual([
      { country: "TW", requestCount: 2, errorCount: 1 },
      { country: "CN", requestCount: 1, errorCount: 1 },
      { country: "US", requestCount: 1, errorCount: 0 },
    ]);
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

    const noMatch = await queryLogs(pool, { project, since, ip: "9.9.9.9" });
    expect(noMatch).toHaveLength(0);
  });
});
