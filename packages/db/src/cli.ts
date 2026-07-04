#!/usr/bin/env bun
import { randomBytes } from "node:crypto";
import { closePool, getPool } from "./client.js";
import { runMigrations } from "./migrate.js";
import { createProject } from "./queries.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const pool = getPool();
  try {
    if (command === "migrate") {
      const { applied, skipped } = await runMigrations(pool);
      console.log(`applied: ${applied.length ? applied.join(", ") : "(none)"}`);
      console.log(`already applied: ${skipped.length}`);
    } else if (command === "register-project") {
      const name = args[0];
      if (!name) throw new Error("usage: register-project <name>");
      const token = `sk_${randomBytes(24).toString("hex")}`;
      await createProject(pool, name, token);
      console.log(`project "${name}" registered.`);
      console.log(`ingest token (shown once, only the sha256 hash is stored): ${token}`);
    } else {
      console.error("usage: cli.ts <migrate|register-project> [args]");
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
