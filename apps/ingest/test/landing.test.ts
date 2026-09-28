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

  test("says what it is, what it does and how to deploy, use and configure it, in HTML and Markdown", async () => {
    const page = await (await get(on, "/")).text();
    const md = await (await get(on, "/index.md")).text();
    for (const heading of ["What it is", "What it does", "Deploy", "Use", "Configure"]) {
      expect(page).toContain(`<h2>${heading}</h2>`);
      expect(md).toContain(`## ${heading}\n`);
    }
    const tools = ["list_projects", "query_logs", "query_traces", "list_traces", "error_summary", "top_sources", "query_metrics", "search"];
    for (const tool of tools) {
      expect(page).toContain(`<code>${tool}</code>`);
      expect(md).toContain(`\`${tool}\``);
    }
    // Placeholders in the code blocks are escaped, not parsed as tags.
    expect(page).toContain("Bearer%20&lt;ingest token&gt;");
    expect(page).not.toContain("<ingest token>");
    expect(md).toContain("   ```sh\n   OTEL_EXPORTER_OTLP_ENDPOINT=https://sensorium.example.com\n");
    expect(page).toContain("<pre><code>docker compose up -d</code></pre>");
    // Links that leave zyx.tw open in a new tab with no referrer; zyx.tw's own do not.
    expect(page).toContain('<a class="link" href="https://github.com/zyx1121/sensorium" target="_blank" rel="noopener noreferrer">GitHub</a>');
    expect(page).toContain('<a href="https://github.com/zyx1121/sensorium/blob/main/.env.example" target="_blank" rel="noopener noreferrer">.env.example</a>');
    expect(page).toContain("route <code>/mcp</code> to port 8788");
    expect(page).toContain('<a class="link" href="https://www.zyx.tw/privacy">Privacy</a>');
    expect(md).toContain("[.env.example](https://github.com/zyx1121/sensorium/blob/main/.env.example)");
    // A Collector re-exports with gzip unless told not to, and ingest refuses gzip.
    expect(page).toContain("<code>compression: none</code>");
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

  // Over a real socket: Bun.serve, not the handler, strips a HEAD body, and it
  // must still announce the length a GET gets.
  test("HEAD gets a GET's headers and length without the body", async () => {
    const server = Bun.serve({ port: 0, fetch: on.fetch });
    try {
      for (const path of ["/", "/index.md", "/favicon.ico", "/fonts/InterVariable.woff2"]) {
        const full = await fetch(new URL(path, server.url));
        const length = (await full.arrayBuffer()).byteLength;
        const head = await fetch(new URL(path, server.url), { method: "HEAD" });
        expect(head.status).toBe(200);
        expect(head.headers.get("content-type")).toBe(full.headers.get("content-type"));
        expect(Number(head.headers.get("content-length"))).toBe(length);
        expect(length).toBeGreaterThan(0);
        expect(await head.text()).toBe("");
      }
    } finally {
      server.stop(true);
    }
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
