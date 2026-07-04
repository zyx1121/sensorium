import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const BOOTSTRAP_SQL = `
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
`;

/** Applies every *.sql file in migrations/ that isn't already recorded in schema_migrations. Safe to re-run. */
export async function runMigrations(pool: Pool): Promise<{ applied: string[]; skipped: string[] }> {
  await pool.query(BOOTSTRAP_SQL);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ filename: string }>("select filename from schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
    newlyApplied.push(file);
  }

  return { applied: newlyApplied, skipped };
}
