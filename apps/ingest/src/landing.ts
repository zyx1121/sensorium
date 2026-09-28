import path from "node:path";

/**
 * The page sensorium.zyx.tw answers / with: what sensorium is, what it does,
 * how to deploy, use and configure it (the README's sections, shorter), in the
 * frame every zyx.tw site shares (the zyx mark top left, mirrored on hover;
 * GitHub top right; Privacy and Terms bottom left; the copyright bottom right;
 * all 14 px on 20 px lines, 20 px in from the corners, each with its tip, see
 * TIPS). The column, type sizes (20 px body text on a phone, 16 px from 640 px
 * up) and dark tokens are www.zyx.tw's, and the font is the same Inter subset
 * (static/README.md). An agent that asks for text/markdown, or opens
 * /index.md, gets the same page as Markdown: both are rendered from PAGE.
 *
 * Only an instance started with SENSORIUM_LANDING=1 serves it; the others
 * keep answering / with the JSON 404.
 */

const STATIC = path.join(import.meta.dirname, "..", "static");

/** Files under static/, by path: the font and the favicon every zyx.tw site uses. */
const FILES: Record<string, { file: string; type: string }> = {
  "/fonts/InterVariable.woff2": { file: "InterVariable.woff2", type: "font/woff2" },
  "/favicon.ico": { file: "favicon.ico", type: "image/x-icon" },
};

// The zyx mark from www.zyx.tw (packages/ui/src/components/zyx-mark.tsx).
const MARK =
  "M2845.95 13.9357C2917.17 -5.94859 2998.62 -8.73553 3072 33.6369C3135.18 70.1192 3172.66 128.948 3193.36 190.107C3213.74 250.29 3220.34 319.143 3218.74 390.501C3215.54 533.321 3178.64 711.473 3116.9 908.909C3087.54 1002.79 3067.38 1067.46 3055.58 1116.28C3043.27 1167.21 3044.77 1183.61 3045.32 1186.44C3049.46 1207.64 3053.85 1217.91 3057.65 1224.5C3061.46 1231.08 3068.16 1240.01 3084.44 1254.2C3086.61 1256.09 3100.05 1265.59 3150.32 1280.4C3198.49 1294.59 3264.57 1309.46 3360.54 1330.97C3562.38 1376.22 3735.1 1433.34 3860.37 1501.97C3922.96 1536.27 3979.27 1576.42 4021.19 1624.15C4063.8 1672.67 4096 1734.54 4096 1807.5C4096 1892.25 4052.87 1961.41 4000.04 2013.15C3947.46 2064.65 3876.66 2107.96 3796.99 2144.95C3637.03 2219.22 3415.77 2279.62 3157.74 2323.89C2979.46 2354.48 2848.13 2377.03 2749.36 2396.67C2649.09 2416.6 2590.56 2432.05 2554.26 2446.64C2495.41 2470.29 2468.77 2482.03 2445.24 2495.62C2421.7 2509.22 2398.22 2526.42 2348.31 2565.57C2317.52 2589.71 2274.88 2632.68 2207.49 2709.56C2141.09 2785.3 2055.9 2887.77 1940.28 3026.89C1772.92 3228.25 1609.99 3389.69 1465.7 3491.1C1393.83 3541.61 1320.93 3581.28 1250.05 3601.07C1178.83 3620.95 1097.38 3623.73 1024 3581.36C960.82 3544.88 923.345 3486.05 902.64 3424.9C882.264 3364.71 875.65 3295.86 877.25 3224.5C880.452 3081.68 917.353 2903.53 979.096 2706.09C1008.45 2612.2 1028.61 2547.53 1040.41 2498.71C1052.72 2447.78 1051.22 2431.39 1050.67 2428.56C1046.53 2407.36 1042.14 2397.08 1038.34 2390.5C1034.54 2383.91 1027.84 2374.98 1011.55 2360.79C1009.38 2358.9 995.931 2349.4 945.669 2334.59C897.5 2320.41 831.421 2305.53 735.449 2284.02C533.619 2238.78 360.909 2181.67 235.64 2113.04C173.051 2078.74 116.735 2038.59 74.8088 1990.85C32.2045 1942.34 0.0020352 1880.47 0 1807.51C0.00115737 1722.76 43.1356 1653.6 95.9632 1601.86C148.539 1550.36 219.335 1507.05 299.007 1470.06C458.965 1395.78 680.22 1335.38 938.257 1291.1C1116.53 1260.51 1247.86 1237.96 1346.63 1218.33C1446.91 1198.39 1505.44 1182.95 1541.74 1168.36C1600.59 1144.7 1627.22 1132.96 1650.76 1119.37C1674.3 1105.78 1697.78 1088.58 1747.68 1049.43C1778.47 1025.28 1821.11 982.314 1888.51 905.431C1954.9 829.699 2040.09 727.225 2155.71 588.109C2323.07 386.75 2486 225.308 2630.29 123.899C2702.17 73.388 2775.07 33.7253 2845.95 13.9357Z";

/** A block of a section: a paragraph, label and text rows, or numbered steps. */
type Block =
  | { p: string }
  | { rows: [label: string, text: string][] }
  | { steps: { text: string; code?: string }[] };

// Text is plain with `backticks` for code and [text](url) for links, so the
// Markdown is the text itself. It follows the README, which has the details.
const PAGE: { title: string; tagline: string; sections: { heading: string; blocks: Block[] }[] } = {
  title: "sensorium",
  tagline: "Observability for agents: OpenTelemetry in, MCP out.",
  sections: [
    {
      heading: "What it is",
      blocks: [
        {
          p: "sensorium keeps the logs, traces and metrics of many services in one Postgres store and serves them to agents over MCP. There is no dashboard: the reader is an agent doing maintenance or analysis. It is open source under the MIT License.",
        },
      ],
    },
    {
      heading: "What it does",
      blocks: [
        {
          rows: [
            ["Ingest", "OpenTelemetry over HTTP, as JSON or protobuf, at `/v1/logs`, `/v1/traces` and `/v1/metrics`."],
            ["Projects", "Each project has its own ingest token, and the token decides where its records land."],
            [
              "MCP",
              "Eight read-only tools at `/mcp`: `list_projects`, `query_logs`, `query_traces`, `list_traces`, `error_summary`, `top_sources`, `query_metrics` and `search`.",
            ],
            ["Retention", "Metrics for 14 days, spans and logs for 30, by default."],
          ],
        },
      ],
    },
    {
      heading: "Deploy",
      blocks: [
        {
          steps: [
            {
              text: "On any machine with Docker, fetch the compose file and the env example. Set `POSTGRES_PASSWORD` and `SENSORIUM_MCP_TOKEN` in `.env`.",
              code: "curl -fsSLO https://raw.githubusercontent.com/zyx1121/sensorium/main/compose.yaml\ncurl -fsSL -o .env https://raw.githubusercontent.com/zyx1121/sensorium/main/.env.example",
            },
            {
              text: "Start it. The receiver on port 8787, the MCP endpoint on port 8788 and a daily retention sweep come up from one image, beside Postgres.",
              code: "docker compose up -d",
            },
            {
              text: "Put a reverse proxy with TLS in front, and route `/mcp` to port 8788 and everything else to port 8787. Both ports listen on 127.0.0.1, and tokens travel in the Authorization header.",
            },
          ],
        },
      ],
    },
    {
      heading: "Use",
      blocks: [
        {
          steps: [
            {
              text: "Register a project. The token is printed once, and running it again for the same name rotates it.",
              code: "docker compose run --rm ingest register-project my-service",
            },
            {
              text: "Point the service's OpenTelemetry exporter at sensorium. sensorium takes neither gzip nor gRPC. For an exporter that only speaks those, put an OpenTelemetry Collector in front and set `compression: none` on its otlphttp exporter.",
              code: "OTEL_EXPORTER_OTLP_ENDPOINT=https://sensorium.example.com\nOTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<ingest token>",
            },
            {
              text: "Connect an agent to the MCP endpoint.",
              code: 'claude mcp add --transport http sensorium https://sensorium.example.com/mcp \\\n  --header "Authorization: Bearer <SENSORIUM_MCP_TOKEN>"',
            },
            { text: "Ask it what broke. `error_summary` and `top_sources` are the usual first calls." },
          ],
        },
      ],
    },
    {
      heading: "Configure",
      blocks: [
        {
          p: "Every setting is an environment variable in `.env`. `POSTGRES_PASSWORD` and `SENSORIUM_MCP_TOKEN` are required, and the `SENSORIUM_RETENTION_*_DAYS` keys set how long data stays. [.env.example](https://github.com/zyx1121/sensorium/blob/main/.env.example) documents every key.",
        },
      ],
    },
  ],
};

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const REPO = "https://github.com/zyx1121/sensorium";

/** Attributes for a link: one that leaves zyx.tw opens in a new tab with no referrer. */
const target = (href: string) =>
  /^https?:\/\/([^/]+\.)?zyx\.tw(\/|$)/.test(href) ? "" : ' target="_blank" rel="noopener noreferrer"';

/** [text](url) in escaped text becomes a link, for http and https URLs only. */
const links = (escaped: string) =>
  escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text: string, href: string) => `<a href="${href}"${target(href)}>${text}</a>`);

/** Escapes the text and turns `backticks` into <code> and, outside code, [text](url) into a link. */
const inline = (text: string) =>
  text
    .split(/(`[^`]+`)/)
    .map((part) => (/^`[^`]+`$/.test(part) ? `<code>${escape(part.slice(1, -1))}</code>` : links(escape(part))))
    .join("");

/**
 * The corner tips every zyx.tw site shows (CornerTip in www.zyx.tw's
 * packages/ui), saying what an item's label leaves out. A tip opens at once on
 * hover and on keyboard focus of a link, toward the page and lined up with the
 * item's outer edge, and stays open while the pointer is on it (STYLE). Like
 * www.zyx.tw's, it is visual only.
 */
const TIPS = {
  mark: "www.zyx.tw",
  github: "zyx1121/sensorium",
  privacy: "What every zyx.tw site stores and logs",
  terms: "The rules for every zyx.tw site",
  copyright: "Loki (詹詠翔)",
};

const tip = (text: string) => `<span class="tip" aria-hidden="true">${escape(text)}</span>`;

/**
 * Closes the corner tips as Base UI does on www.zyx.tw: Escape or a press
 * closes the open one until the pointer enters it again or focus leaves it,
 * and a touch never opens one. The CSP allows it by its hash.
 */
const SCRIPT = `for(const t of document.querySelectorAll(".tipped")){t.addEventListener("pointerenter",e=>t.classList.toggle("off",e.pointerType==="touch"));t.addEventListener("pointerdown",()=>t.classList.add("off"));t.addEventListener("focusout",()=>t.classList.remove("off"))}addEventListener("keydown",e=>{if(e.key==="Escape")for(const t of document.querySelectorAll(".tipped:hover,.tipped:focus-within"))t.classList.add("off")})`;

function block(b: Block): string {
  if ("p" in b) return `<p>${inline(b.p)}</p>`;
  if ("rows" in b) {
    return `<dl class="rows">${b.rows.map(([label, text]) => `<dt>${escape(label)}</dt><dd>${inline(text)}</dd>`).join("")}</dl>`;
  }
  return `<ol class="steps">${b.steps
    .map(({ text, code }) => `<li><p>${inline(text)}</p>${code ? `<pre><code>${escape(code)}</code></pre>` : ""}</li>`)
    .join("")}</ol>`;
}

function markdownBlock(b: Block): string {
  if ("p" in b) return b.p;
  if ("rows" in b) return b.rows.map(([label, text]) => `- **${label}**: ${text}`).join("\n");
  return b.steps
    .map(({ text, code }, i) => {
      const item = `${i + 1}. ${text}`;
      if (!code) return item;
      const fenced = ["```sh", ...code.split("\n"), "```"].map((line) => `   ${line}`).join("\n");
      return `${item}\n\n${fenced}`;
    })
    .join("\n\n");
}

const STYLE = `
@font-face{font-family:Inter;src:url(/fonts/InterVariable.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{color-scheme:dark;--background:oklch(0 0 0);--foreground:oklch(0.985 0 0);--muted:oklch(0.269 0 0);--muted-foreground:oklch(0.65 0 0);--border:oklch(1 0 0 / 10%);--ring:oklch(0.556 0 0)}
*{box-sizing:border-box;margin:0;padding:0}
html{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-feature-settings:"liga" 1,"calt" 1,"ss01" 1,"zero" 1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;scrollbar-gutter:stable}
body{background:var(--background);color:var(--foreground);font-size:20px;line-height:28px}
@media (min-width:640px){body{font-size:16px;line-height:24px}}
main{margin:0 auto;width:100%;max-width:36rem;padding:120px 20px 100px}
@media (min-width:1024px){main{max-width:48rem}}
@media (min-width:1536px){main{max-width:64rem}}
h1{font-size:30px;line-height:36px;font-weight:400}
.sub{margin-top:12px;color:var(--muted-foreground)}
section{margin-top:60px}
section:first-of-type{margin-top:100px}
h2{font-size:24px;line-height:32px;font-weight:400}
section p{margin-top:12px;text-wrap:pretty}
.rows{margin-top:20px;display:grid;grid-template-columns:7rem 1fr;gap:12px 20px}
.rows dt{color:var(--muted-foreground)}
.steps{margin-top:20px;list-style:none;counter-reset:step;display:flex;flex-direction:column;row-gap:20px}
.steps li{counter-increment:step;display:grid;grid-template-columns:28px minmax(0,1fr)}
.steps li::before{content:counter(step);color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.steps li>*{grid-column:2}
.steps p{margin-top:0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em}
:not(pre)>code{background:var(--muted);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
pre{margin-top:12px;padding:12px 16px;border:1px solid var(--border);border-radius:8px;overflow-x:auto;line-height:1.45}
.corner{position:fixed;z-index:50;display:flex;align-items:center;gap:16px;font-size:14px;line-height:20px}
.tl{top:20px;left:20px}.tr{top:20px;right:20px}.bl{bottom:20px;left:20px}.br{right:20px;bottom:20px}
a{color:inherit;text-decoration:none;border-radius:6px;outline-offset:4px}
a:focus-visible{outline:2px solid color-mix(in oklab,var(--ring) 50%,transparent)}
.link{position:relative;color:var(--muted-foreground);transition:color 150ms cubic-bezier(0.4,0,0.2,1)}
.link::after{content:"";position:absolute;inset:-2px -8px}
.link:hover{color:var(--foreground)}
.mark svg{display:block;height:20px;width:auto;fill:currentColor}
.mark:hover svg{transform:scaleX(-1)}
@media (prefers-reduced-motion:no-preference){.mark svg{transition:transform 300ms cubic-bezier(0.4,0,0.2,1)}}
.br p{color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.tipped{position:relative;display:flex}
.tl .tipped,.tr .tipped{--tip-from:-8px}.bl .tipped,.br .tipped{--tip-from:8px}
.tip,.tipped::after{position:absolute;z-index:50;pointer-events:none;background:var(--foreground);opacity:0;visibility:hidden}
.tip{width:max-content;max-width:320px;padding:6px 12px;border-radius:8px;color:var(--background);font-size:12px;line-height:16px;font-weight:400;font-variant-numeric:normal;transform:scale(.95)}
.tip::before{content:"";position:absolute;left:0;right:0;height:4px}
.tipped::after{content:"";left:calc(50% - 5px);width:10px;height:10px;border-radius:2px;transform:rotate(45deg)}
.tl .tip,.tr .tip{top:calc(100% + 4px)}.tl .tip::before,.tr .tip::before{bottom:100%}.tl .tipped::after,.tr .tipped::after{top:calc(100% + 1px)}
.bl .tip,.br .tip{bottom:calc(100% + 4px)}.bl .tip::before,.br .tip::before{top:100%}.bl .tipped::after,.br .tipped::after{bottom:calc(100% + 1px)}
.tl .tip{left:0;transform-origin:top left}.tr .tip{right:0;transform-origin:top right}.bl .tip{left:0;transform-origin:bottom left}.br .tip{right:0;transform-origin:bottom right}
@media (hover:hover){.tipped:hover>.tip,.tipped:hover::after{opacity:1;visibility:visible;transition:visibility 0s}.tipped:hover>.tip{transform:none;pointer-events:auto}}
.tipped:has(>a:focus-visible)>.tip,.tipped:has(>a:focus-visible)::after{opacity:1;visibility:visible;transition:visibility 0s}.tipped:has(>a:focus-visible)>.tip{transform:none}
.tipped.off>.tip,.tipped.off::after{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
@media (prefers-reduced-motion:no-preference){.tip,.tipped::after{transition:opacity 150ms ease,transform 150ms ease,visibility 0s linear 150ms}.tipped.off>.tip,.tipped.off::after{transition:opacity 150ms ease,visibility 0s linear 150ms!important}.tipped:hover>.tip,.tipped:has(>a:focus-visible)>.tip{animation:tip-in 150ms ease}.tipped:hover::after,.tipped:has(>a:focus-visible)::after{animation:tip-arrow-in 150ms ease}}
@keyframes tip-in{from{opacity:0;transform:translateY(var(--tip-from)) scale(.95)}}
@keyframes tip-arrow-in{from{opacity:0;transform:translateY(var(--tip-from)) rotate(45deg)}}
.fade{pointer-events:none;position:fixed;left:0;right:0;z-index:40;height:64px}
.fade.top{top:0;background:linear-gradient(to bottom,var(--background) 60%,transparent)}
.fade.bottom{bottom:0;background:linear-gradient(to top,var(--background) 60%,transparent)}
`;

function html(year: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE.title}</title>
<meta name="description" content="${escape(PAGE.tagline)}">
<link rel="icon" href="/favicon.ico">
<link rel="alternate" type="text/markdown" href="/index.md">
<style>${STYLE}</style>
</head>
<body>
<header><div class="fade top"></div><div class="corner tl"><span class="tipped"><a class="mark" href="https://www.zyx.tw" aria-label="zyx.tw"><svg viewBox="0 0 4096 3615" aria-hidden="true" focusable="false"><path d="${MARK}"/></svg></a>${tip(TIPS.mark)}</span></div>
<nav class="corner tr" aria-label="Main"><span class="tipped"><a class="link" href="${REPO}"${target(REPO)}>GitHub</a>${tip(TIPS.github)}</span></nav></header>
<main>
<h1>${PAGE.title}</h1>
<p class="sub">${inline(PAGE.tagline)}</p>
${PAGE.sections.map(({ heading, blocks }) => `<section><h2>${escape(heading)}</h2>${blocks.map(block).join("")}</section>`).join("\n")}
</main>
<footer><div class="fade bottom"></div>
<nav class="corner bl" aria-label="Legal"><span class="tipped"><a class="link" href="https://www.zyx.tw/privacy">Privacy</a>${tip(TIPS.privacy)}</span><span class="tipped"><a class="link" href="https://www.zyx.tw/terms">Terms</a>${tip(TIPS.terms)}</span></nav>
<div class="corner br"><p class="tipped">© ${year}${tip(TIPS.copyright)}</p></div>
</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const MARKDOWN = `# ${PAGE.title}

${PAGE.tagline}

${PAGE.sections.map(({ heading, blocks }) => `## ${heading}\n\n${blocks.map(markdownBlock).join("\n\n")}`).join("\n\n")}

Part of [zyx.tw](https://www.zyx.tw): [Privacy](https://www.zyx.tw/privacy), [Terms](https://www.zyx.tw/terms).
`;

// Hashes stand in for 'unsafe-inline': the one <style> block is all the page runs.
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("base64");

const CSP = `default-src 'none'; style-src 'sha256-${sha256(STYLE)}'; script-src 'sha256-${sha256(SCRIPT)}'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

// HEAD gets the body too: Bun.serve drops it on the wire and sends the length a
// GET would, which a null body would announce as 0 (RFC 9110 9.3.2).
function respond(body: string | Blob, headers: Record<string, string>): Response {
  return new Response(body, {
    headers: { "x-content-type-options": "nosniff", ...headers },
  });
}

/** The landing page's routes; null for anything else, which falls through to the receiver. */
export function serveLanding(req: Request, url: URL): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;

  const wantsMarkdown = (req.headers.get("accept") ?? "").includes("text/markdown");

  if (url.pathname === "/index.md" || (url.pathname === "/" && wantsMarkdown)) {
    return respond(MARKDOWN, {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      vary: "accept",
    });
  }

  if (url.pathname === "/") {
    return respond(html(new Date().getUTCFullYear()), {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": CSP,
      link: '</index.md>; rel="alternate"; type="text/markdown"',
      vary: "accept",
    });
  }

  const asset = FILES[url.pathname];
  if (asset) {
    return respond(Bun.file(path.join(STATIC, asset.file)), {
      "content-type": asset.type,
      "cache-control": "public, max-age=604800",
    });
  }

  return null;
}
