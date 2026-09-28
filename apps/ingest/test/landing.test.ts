import { describe, expect, test } from "bun:test";
import type { Pool } from "@sensorium/db";
import { createIngestApp } from "../src/server.js";

// The landing routes never touch the database; a pool that throws proves it.
const pool = new Proxy({}, {
  get() {
    throw new Error("the landing page must not query the database");
  },
}) as unknown as Pool;

const on = createIngestApp(pool, { landing: true });
const off = createIngestApp(pool);

const get = (app: typeof on, path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://sensorium.zyx.tw${path}`, init));

describe("landing page", () => {
  test("is off unless asked for: / stays the JSON 404", async () => {
    const res = await get(off, "/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  test("serves the zyx.tw frame at /", async () => {
    const res = await get(on, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("vary")).toBe("accept");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain("<h1>sensorium</h1>");
    expect(body).toContain('href="https://www.zyx.tw"');
    expect(body).toContain('href="https://www.zyx.tw/privacy"');
    expect(body).toContain('href="https://www.zyx.tw/terms"');
    expect(body).toContain(`© ${new Date().getUTCFullYear()}`);
  });

  test("the CSP hash matches the page's one <style> block", async () => {
    const res = await get(on, "/");
    const style = (await res.text()).match(/<style>([\s\S]*?)<\/style>/)![1]!;
    const hash = new Bun.CryptoHasher("sha256").update(style).digest("base64");
    expect(res.headers.get("content-security-policy")).toContain(`'sha256-${hash}'`);
  });

  test("answers agents in Markdown, by Accept or at /index.md", async () => {
    for (const res of [
      await get(on, "/", { headers: { accept: "text/markdown" } }),
      await get(on, "/index.md"),
    ]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      const body = await res.text();
      expect(body.startsWith("# sensorium\n")).toBe(true);
      expect(body).toContain("`/mcp`");
    }
  });

  test("HEAD gets the headers without a body", async () => {
    const res = await get(on, "/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("");
  });

  test("serves the font and the favicon", async () => {
    const font = await get(on, "/fonts/InterVariable.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(new Uint8Array(await font.arrayBuffer()).slice(0, 4)).toEqual(new TextEncoder().encode("wOF2"));

    const icon = await get(on, "/favicon.ico");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/x-icon");
    expect((await icon.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("leaves every other route to the receiver", async () => {
    expect((await get(on, "/", { method: "POST" })).status).toBe(404);
    expect((await get(on, "/health")).status).toBe(200);
    expect((await get(on, "/nope")).status).toBe(404);
  });
});
