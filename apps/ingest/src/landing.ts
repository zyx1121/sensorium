import path from "node:path";

/**
 * The page sensorium.zyx.tw answers / with, in the frame every zyx.tw site
 * shares: the zyx mark top left (mirrored on hover), Privacy and Terms bottom
 * left, the copyright bottom right, all 14 px on 20 px lines, 20 px in from
 * the corners. The colors are the zyx.tw dark tokens, the theme every zyx.tw
 * site starts in, and the font is the same Inter subset (static/README.md).
 * An agent that asks for text/markdown, or opens /index.md, gets the page as
 * Markdown with the endpoints.
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

const STYLE = `
@font-face{font-family:Inter;src:url(/fonts/InterVariable.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{color-scheme:dark;--background:oklch(0 0 0);--foreground:oklch(0.985 0 0);--muted-foreground:oklch(0.65 0 0);--ring:oklch(0.556 0 0)}
*{box-sizing:border-box;margin:0}
html{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-feature-settings:"liga" 1,"calt" 1,"ss01" 1,"zero" 1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{background:var(--background);color:var(--foreground);text-align:center}
main{min-height:100dvh;display:grid;place-content:center;padding:80px 20px}
h1{font-size:30px;line-height:36px;font-weight:400}
main p{margin-top:12px;font-size:16px;line-height:24px;color:var(--muted-foreground)}
.corner{position:fixed;z-index:50;display:flex;align-items:center;gap:16px;font-size:14px;line-height:20px}
.tl{top:20px;left:20px}.bl{bottom:20px;left:20px}.br{right:20px;bottom:20px}
a{color:inherit;text-decoration:none;border-radius:6px;outline-offset:4px}
a:focus-visible{outline:2px solid color-mix(in oklab,var(--ring) 50%,transparent)}
.link{position:relative;color:var(--muted-foreground);transition:color 150ms cubic-bezier(0.4,0,0.2,1)}
.link::after{content:"";position:absolute;inset:-2px -8px}
.link:hover{color:var(--foreground)}
.mark svg{display:block;height:20px;width:auto;fill:currentColor}
.mark:hover svg{transform:scaleX(-1)}
@media (prefers-reduced-motion:no-preference){.mark svg{transition:transform 300ms cubic-bezier(0.4,0,0.2,1)}}
.br p{color:var(--muted-foreground);font-variant-numeric:tabular-nums}
`;

function html(year: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sensorium</title>
<meta name="description" content="Observability for agents.">
<link rel="icon" href="/favicon.ico">
<link rel="alternate" type="text/markdown" href="/index.md">
<style>${STYLE}</style>
</head>
<body>
<header class="corner tl"><a class="mark" href="https://www.zyx.tw" aria-label="zyx.tw"><svg viewBox="0 0 4096 3615" aria-hidden="true" focusable="false"><path d="${MARK}"/></svg></a></header>
<main>
<h1>sensorium</h1>
<p>Observability for agents.</p>
</main>
<footer>
<nav class="corner bl" aria-label="Legal"><a class="link" href="https://www.zyx.tw/privacy">Privacy</a><a class="link" href="https://www.zyx.tw/terms">Terms</a></nav>
<div class="corner br"><p>© ${year}</p></div>
</footer>
</body>
</html>
`;
}

const MARKDOWN = `# sensorium

Observability for agents. Producers send OpenTelemetry over OTLP/HTTP (JSON or protobuf) to \`/v1/logs\`, \`/v1/traces\` and \`/v1/metrics\`; agents read it back over MCP at \`/mcp\`. Both take a bearer token.

Part of [zyx.tw](https://www.zyx.tw): [Privacy](https://www.zyx.tw/privacy), [Terms](https://www.zyx.tw/terms).
`;

// Hashes stand in for 'unsafe-inline': the one <style> block is all the page runs.
const CSP = `default-src 'none'; style-src 'sha256-${new Bun.CryptoHasher("sha256").update(STYLE).digest("base64")}'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

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
