import { getPool } from "@sensorium/db";
import { createIngestApp } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const pool = getPool();
const app = createIngestApp(pool, { landing: process.env.SENSORIUM_LANDING === "1" });

Bun.serve({ port, fetch: app.fetch });

console.log(`sensorium ingest listening on :${port}`);
