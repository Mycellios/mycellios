import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MARKETING_COMPARISONS, RETIRED_MARKETING_PAGES, STATS_HOST } from "../contracts/marketing-pages.js";

const REPOSITORY_DOCS = "https://github.com/Mycellios/mycellios/blob/main/docs";
const CANONICAL_LANDING_HOST = "www.mycellios.com";
const CANONICAL_LANDING_PATHS = new Set([
  "/",
  "/network",
  "/create",
  "/earn",
  "/spore",
  "/spore/treasury",
  "/spore/data",
  "/spore/rewards",
  "/pricing",
  "/compare",
  "/stats",
  "/downloads",
  "/llms.txt",
  "/admin",
  "/dashboard",
  "/account",
  "/browser/",
]);

export function canonicalLandingRedirectLocation(
  method: string,
  hostname: string,
  requestUrl: string,
): string | null {
  if (!(["GET", "HEAD"].includes(method.toUpperCase())) || hostname.toLowerCase() !== "mycellios.com") return null;

  const queryIndex = requestUrl.indexOf("?");
  const pathname = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : requestUrl.slice(queryIndex);
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  const canonicalPath = normalizedPath === "/browser" || normalizedPath === "/mobile"
    ? "/browser/"
    : normalizedPath;
  const isLandingPath = CANONICAL_LANDING_PATHS.has(canonicalPath)
    || canonicalPath === "/blog"
    || canonicalPath.startsWith("/blog/")
    || canonicalPath.startsWith("/compare/");

  return isLandingPath ? `https://${CANONICAL_LANDING_HOST}${canonicalPath}${query}` : null;
}

export function registerCanonicalLandingHostRedirect(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const location = canonicalLandingRedirectLocation(request.method, request.hostname, request.url);
    if (location) return reply.redirect(location, 308);
  });
}

export function registerLandingEntryRoutes(app: FastifyInstance, assetsRoot: string): void {
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD"].includes(request.method) && request.hostname === STATS_HOST && request.url.split("?")[0] === "/") {
      return reply.sendFile(existsSync(resolve(assetsRoot, "stats/index.html")) ? "stats/index.html" : "index.html");
    }
  });
  const routeDocuments = {
    "/network": "network/index.html",
    "/dashboard": "dashboard/index.html",
    "/earn": "earn/index.html",
    "/account": "account/index.html",
    "/spore": "spore/index.html",
    "/spore/rewards": "spore/rewards/index.html",
    "/pricing": "pricing/index.html",
    "/compare": "compare/index.html",
    "/stats": "stats/index.html",
    "/admin": "admin/index.html",
    "/downloads": "downloads/index.html",
  } as const;
  for (const [path, documentName] of Object.entries(routeDocuments)) {
    const document = existsSync(resolve(assetsRoot, documentName)) ? documentName : "index.html";
    app.get(path, async (_request, reply) => reply.sendFile(document));
  }
  for (const [slug] of MARKETING_COMPARISONS) {
    const documentName = `compare/${slug}/index.html`;
    app.get(`/compare/${slug}`, async (_request, reply) => reply.sendFile(existsSync(resolve(assetsRoot, documentName)) ? documentName : "index.html"));
  }
  for (const [path, destination] of Object.entries(RETIRED_MARKETING_PAGES)) {
    for (const alias of [path, `${path}/`]) app.get(alias, async (request, reply) => {
      const queryIndex = request.url.indexOf("?");
      return reply.redirect(`${destination}${queryIndex === -1 ? "" : request.url.slice(queryIndex)}`, 308);
    });
  }

  const redirects = [
    ["/join", "/earn"], ["/join/", "/earn"],
    ["/docs", `${REPOSITORY_DOCS}/README.md`], ["/docs/", `${REPOSITORY_DOCS}/README.md`],
    ["/docs/protocol", `${REPOSITORY_DOCS}/ARCHITECTURE.md`], ["/docs/protocol/", `${REPOSITORY_DOCS}/ARCHITECTURE.md`],
    ["/docs/downloads", "/downloads"], ["/docs/network", "/network"], ["/docs/blog", "/blog"],
    ["/docs/downloads/", "/downloads"], ["/docs/network/", "/network"], ["/docs/blog/", "/blog"],
  ] as const;
  for (const [path, destination] of redirects) {
    app.get(path, async (_request, reply) => reply.redirect(destination));
  }
  for (const path of ["/dashboard", "/account", "/spore", "/spore/rewards", "/stats", "/pricing", "/compare"]) {
    app.get(`${path}/`, async (request, reply) => {
      const queryIndex = request.url.indexOf("?");
      return reply.redirect(`${path}${queryIndex === -1 ? "" : request.url.slice(queryIndex)}`);
    });
  }
}
