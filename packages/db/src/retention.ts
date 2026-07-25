import type { Pool } from "pg";

/**
 * Age-based expiry for the three signal tables.
 *
 * metric_points is partitioned by UTC day (migration 0004), so its expiry is a
 * DROP TABLE per day — constant time, and the space comes back immediately.
 * spans and logs are two orders of magnitude smaller (thousands of rows/day
 * against millions), so they get an ordinary DELETE; partitioning them would
 * be machinery without a problem to solve.
 *
 * Meant to run daily from a timer. Every step is idempotent, so a missed run
 * costs disk, not correctness, and the next run catches up.
 */

const PARTITION_PREFIX = "metric_points_";
const DEFAULT_PARTITION = "metric_points_default";
/** metric_points_YYYYMMDD — the default partition deliberately does not match. */
const PARTITION_RE = /^metric_points_(\d{4})(\d{2})(\d{2})$/;

export interface RetentionConfig {
  /** Days of raw metric points to keep. ~2.4GB/day for one busy PVE project. */
  metricDays: number;
  spanDays: number;
  logDays: number;
  /** How many days of partitions to keep pre-created ahead of now. */
  aheadDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  metricDays: 14,
  spanDays: 30,
  logDays: 30,
  aheadDays: 7,
};

/** Reads the config from env, falling back to DEFAULT_RETENTION per field. */
export function retentionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RetentionConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(
        `${key} must be a positive integer, got ${JSON.stringify(raw)}`,
      );
    }
    return parsed;
  };
  return {
    metricDays: num(
      "SENSORIUM_RETENTION_METRIC_DAYS",
      DEFAULT_RETENTION.metricDays,
    ),
    spanDays: num("SENSORIUM_RETENTION_SPAN_DAYS", DEFAULT_RETENTION.spanDays),
    logDays: num("SENSORIUM_RETENTION_LOG_DAYS", DEFAULT_RETENTION.logDays),
    aheadDays: num(
      "SENSORIUM_RETENTION_AHEAD_DAYS",
      DEFAULT_RETENTION.aheadDays,
    ),
  };
}

/** UTC midnight of the day `offsetDays` from `from`. */
export function utcDay(from: Date, offsetDays = 0): Date {
  return new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + offsetDays,
      0,
      0,
      0,
      0,
    ),
  );
}

export function partitionName(day: Date): string {
  const y = day.getUTCFullYear().toString().padStart(4, "0");
  const m = (day.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = day.getUTCDate().toString().padStart(2, "0");
  return `${PARTITION_PREFIX}${y}${m}${d}`;
}

/** Inverse of partitionName; null for anything that is not a daily partition. */
export function partitionDay(name: string): Date | null {
  const m = PARTITION_RE.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** [start, end) bounds of a day partition, as the SQL literals the DDL wants. */
export function partitionBounds(day: Date): { from: string; to: string } {
  return { from: day.toISOString(), to: utcDay(day, 1).toISOString() };
}

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Quotes an ISO timestamp for inlining into DDL.
 *
 * `CREATE TABLE ... PARTITION OF ... FOR VALUES` is DDL, and Postgres does not
 * accept bind parameters there — passing $1/$2 fails with "bind message
 * supplies 2 parameters, but prepared statement requires 0". These values come
 * from Date.toISOString(), so the assertion is a guard against a future caller
 * rather than against today's input.
 */
function tsLiteral(iso: string): string {
  if (!ISO_UTC_RE.test(iso)) {
    throw new Error(
      `refusing to inline a non-ISO timestamp into DDL: ${JSON.stringify(iso)}`,
    );
  }
  return `'${iso}'`;
}

async function listDayPartitions(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ relname: string }>(
    `select c.relname
       from pg_inherits i
       join pg_class c on c.oid = i.inhrelid
       join pg_class p on p.oid = i.inhparent
      where p.relname = 'metric_points'
      order by c.relname`,
  );
  return rows.map((r) => r.relname).filter((n) => PARTITION_RE.test(n));
}

/** Creates today's partition and the next `aheadDays`. Idempotent. */
export async function ensurePartitions(
  pool: Pool,
  aheadDays: number,
  now = new Date(),
): Promise<string[]> {
  // Checked against the catalog rather than leaning on `if not exists`, whose
  // result still reports CREATE for a table that was already there — the
  // report would then claim work it did not do on every single run.
  const existing = new Set(await listDayPartitions(pool));
  const created: string[] = [];
  for (let offset = 0; offset <= aheadDays; offset++) {
    const day = utcDay(now, offset);
    const name = partitionName(day);
    if (existing.has(name)) continue;
    const { from, to } = partitionBounds(day);
    await pool.query(
      `create table if not exists ${name}
         partition of metric_points for values from (${tsLiteral(from)}) to (${tsLiteral(to)})`,
    );
    created.push(name);
  }
  return created;
}

/** Drops partitions whose whole day is older than the cutoff. */
export async function dropExpiredPartitions(
  pool: Pool,
  keepDays: number,
  now = new Date(),
): Promise<string[]> {
  const cutoff = utcDay(now, -keepDays);
  const dropped: string[] = [];
  for (const name of await listDayPartitions(pool)) {
    const day = partitionDay(name);
    // A partition covers [day, day+1), so it is only fully expired once its
    // end is at or before the cutoff. Never drop a day still partly in window.
    if (!day || utcDay(day, 1) > cutoff) continue;
    await pool.query(`drop table ${name}`);
    dropped.push(name);
  }
  return dropped;
}

/**
 * Moves anything that landed in the default partition into a real one.
 *
 * Only reachable if a day arrived with no partition pre-created, which means
 * the timer has been down for longer than aheadDays. The detach is what makes
 * the re-insert legal: while attached, a row cannot move out of default into
 * an overlapping partition.
 */
export async function drainDefaultPartition(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n from ${DEFAULT_PARTITION}`,
  );
  const pending = Number(rows[0]?.n ?? 0);
  if (pending === 0) return 0;

  const { rows: dayRows } = await pool.query<{ day: Date }>(
    `select distinct (ts at time zone 'UTC')::date as day from ${DEFAULT_PARTITION} order by day`,
  );

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `alter table metric_points detach partition ${DEFAULT_PARTITION}`,
    );
    for (const { day } of dayRows) {
      const utc = utcDay(new Date(day));
      const { from, to } = partitionBounds(utc);
      await client.query(
        `create table if not exists ${partitionName(utc)}
           partition of metric_points for values from (${tsLiteral(from)}) to (${tsLiteral(to)})`,
      );
    }
    await client.query(
      `insert into metric_points (project, metric_name, ts, kind, value, attributes, resource)
       select project, metric_name, ts, kind, value, attributes, resource from ${DEFAULT_PARTITION}`,
    );
    await client.query(`truncate ${DEFAULT_PARTITION}`);
    await client.query(
      `alter table metric_points attach partition ${DEFAULT_PARTITION} default`,
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return pending;
}

async function deleteOlderThan(
  pool: Pool,
  table: string,
  column: string,
  days: number,
  now: Date,
): Promise<number> {
  const cutoff = utcDay(now, -days);
  const res = await pool.query(`delete from ${table} where ${column} < $1`, [
    cutoff.toISOString(),
  ]);
  return res.rowCount ?? 0;
}

export interface RetentionReport {
  partitionsCreated: string[];
  partitionsDropped: string[];
  defaultRowsRescued: number;
  spansDeleted: number;
  logsDeleted: number;
}

export async function runRetention(
  pool: Pool,
  config: RetentionConfig = DEFAULT_RETENTION,
  now = new Date(),
): Promise<RetentionReport> {
  // Order matters: rescue before dropping, so a rescued row from an expired
  // day is dropped in the same run instead of lingering a day longer.
  const defaultRowsRescued = await drainDefaultPartition(pool);
  const partitionsCreated = await ensurePartitions(pool, config.aheadDays, now);
  const partitionsDropped = await dropExpiredPartitions(
    pool,
    config.metricDays,
    now,
  );
  const spansDeleted = await deleteOlderThan(
    pool,
    "spans",
    "start_ts",
    config.spanDays,
    now,
  );
  const logsDeleted = await deleteOlderThan(
    pool,
    "logs",
    "ts",
    config.logDays,
    now,
  );
  return {
    partitionsCreated,
    partitionsDropped,
    defaultRowsRescued,
    spansDeleted,
    logsDeleted,
  };
}
