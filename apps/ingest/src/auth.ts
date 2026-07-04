import { getProjectByToken, type Pool } from "@sensorium/db";

/**
 * Resolves the ingest bearer token to its bound project. This project name
 * is authoritative — callers may claim any `service.namespace` in the OTLP
 * payload, but only the token's binding decides where rows land.
 */
export async function authenticateIngest(pool: Pool, req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  return getProjectByToken(pool, token);
}
