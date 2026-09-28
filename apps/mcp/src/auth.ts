import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** MCP has one shared bearer token for its trusted readers, with no per-caller identity. */
export function authenticateMcp(req: Request): boolean {
  const expected = process.env.SENSORIUM_MCP_TOKEN;
  if (!expected) {
    throw new Error("SENSORIUM_MCP_TOKEN is not set");
  }
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return safeEqual(token, expected);
}
