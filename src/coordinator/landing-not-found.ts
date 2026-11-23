import type { FastifyReply, FastifyRequest } from "fastify";

/** Paths whose clients expect JSON errors, even when a browser opens them. */
const API_PREFIXES = ["/v1/", "/api/", "/public/", "/internal/", "/local/", "/webhooks/", "/updates/", "/mobile/v1/", "/health"];

/** A person navigating in a browser gets a page; API and script clients keep the JSON error. */
export function wantsNotFoundPage(request: FastifyRequest): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const pathname = request.url.split("?")[0] ?? "/";
  if (API_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) return false;
  if (/\.[a-z0-9]{1,8}$/i.test(pathname) && !pathname.endsWith(".html")) return false; // missing assets stay plain
  return String(request.headers.accept ?? "").includes("text/html");
}

// Self-contained so it renders even when the landing build is missing. No scripts:
// the CSP needs no extra hash. Colors follow the Agent paper/stone profile.
export const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found | Mycellios</title>
<link rel="icon" href="/assets/brand/favicon.png" type="image/png" sizes="32x32">
<style>
:root{--canvas:#f8f5f0;--ink:#1f1d1a;--muted:#5f5a52;--edge:#e3ddd2;--card:#efebe4;--action:#2f4a35;--on-action:#fff}
@media (prefers-color-scheme:dark){:root{--canvas:#161616;--ink:#ededed;--muted:#a8a8a8;--edge:#2c2c2c;--card:#1f1f1f;--action:#e8e8e8;--on-action:#161616}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--canvas);color:var(--ink);font-family:"Geist Variable","Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:520px}
.code{margin:0 0 12px;color:var(--muted);font-size:14px;font-weight:600;letter-spacing:.04em}
h1{margin:0 0 12px;font-size:clamp(32px,7vw,44px);line-height:1.1;font-weight:600;letter-spacing:-.02em}
p{margin:0 0 28px;color:var(--muted);font-size:17px;line-height:1.55}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:32px}
.primary{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;background:var(--action);color:var(--on-action);text-decoration:none;font-weight:600}
nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding-top:24px;border-top:1px solid var(--edge)}
nav a{display:flex;align-items:center;min-height:44px;padding:0 14px;border-radius:12px;background:var(--card);color:var(--ink);text-decoration:none}
nav a:hover,.primary:hover{opacity:.88}
</style>
</head>
<body>
<main>
<p class="code">404</p>
<h1>This page doesn't exist.</h1>
<p>The link may be old or mistyped. These pages are a good place to continue.</p>
<div class="actions"><a class="primary" href="/">Go to the home page</a></div>
<nav aria-label="Popular pages">
<a href="/agent">Mycellios Agent</a>
<a href="/guides">Guides</a>
<a href="/downloads">Downloads</a>
<a href="/network">Network status</a>
</nav>
</main>
</body>
</html>
`;

export function sendNotFound(request: FastifyRequest, reply: FastifyReply, error = "Not Found"): FastifyReply {
  reply.code(404);
  if (wantsNotFoundPage(request)) {
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-cache").header("X-Robots-Tag", "noindex").send(NOT_FOUND_PAGE);
  }
  return reply.send({ message: `Route ${request.method}:${request.url.split("?")[0]} not found`, error, statusCode: 404 });
}
