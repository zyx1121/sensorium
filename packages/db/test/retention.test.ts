import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETENTION,
  partitionBounds,
  partitionDay,
  partitionName,
  retentionConfigFromEnv,
  utcDay,
} from "../src/retention.js";

// Pure date/name plumbing — no DB needed. The value here is that partition
// names and partition bounds are derived from the same UTC day, because a
// mismatch would silently file rows under a day they do not belong to.

describe("utcDay", () => {
  test("truncates to UTC midnight", () => {
    expect(utcDay(new Date("2026-07-25T13:42:21Z")).toISOString()).toBe(
      "2026-07-25T00:00:00.000Z",
    );
  });

  test("uses UTC, not the local calendar day", () => {
    // 23:30 UTC is already the next day in CST (+08), so a local-time
    // implementation would answer 2026-07-26 here.
    expect(utcDay(new Date("2026-07-25T23:30:00Z")).toISOString()).toBe(
      "2026-07-25T00:00:00.000Z",
    );
  });

  test("offsets across a month boundary", () => {
    expect(utcDay(new Date("2026-07-31T10:00:00Z"), 1).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(utcDay(new Date("2026-08-01T10:00:00Z"), -1).toISOString()).toBe(
      "2026-07-31T00:00:00.000Z",
    );
  });
});

describe("partition naming", () => {
  test("name and day round-trip", () => {
    const day = utcDay(new Date("2026-07-05T00:00:00Z"));
    expect(partitionName(day)).toBe("metric_points_20260705");
    expect(partitionDay("metric_points_20260705")?.toISOString()).toBe(
      day.toISOString(),
    );
  });

  test("the default partition is not mistaken for a day", () => {
    expect(partitionDay("metric_points_default")).toBeNull();
  });

  test("bounds are exactly the named day, half-open", () => {
    const { from, to } = partitionBounds(
      utcDay(new Date("2026-12-31T00:00:00Z")),
    );
    expect(from).toBe("2026-12-31T00:00:00.000Z");
    expect(to).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("retentionConfigFromEnv", () => {
  test("falls back per field", () => {
    const cfg = retentionConfigFromEnv({
      SENSORIUM_RETENTION_METRIC_DAYS: "3",
    });
    expect(cfg.metricDays).toBe(3);
    expect(cfg.spanDays).toBe(DEFAULT_RETENTION.spanDays);
  });

  test("treats empty string as unset", () => {
    expect(
      retentionConfigFromEnv({ SENSORIUM_RETENTION_METRIC_DAYS: "" })
        .metricDays,
    ).toBe(DEFAULT_RETENTION.metricDays);
  });

  test("rejects values that would silently delete everything", () => {
    expect(() =>
      retentionConfigFromEnv({ SENSORIUM_RETENTION_METRIC_DAYS: "0" }),
    ).toThrow();
    expect(() =>
      retentionConfigFromEnv({ SENSORIUM_RETENTION_METRIC_DAYS: "-1" }),
    ).toThrow();
    expect(() =>
      retentionConfigFromEnv({ SENSORIUM_RETENTION_METRIC_DAYS: "1.5" }),
    ).toThrow();
    expect(() =>
      retentionConfigFromEnv({ SENSORIUM_RETENTION_METRIC_DAYS: "forever" }),
    ).toThrow();
  });
});
