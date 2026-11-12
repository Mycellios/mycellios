import { createHmac } from "node:crypto";
import { HostedWebSlug } from "@rakazo/contracts";
import { listHostedWebs, type PrismaClient, publishedHostedWeb, runAsSystem } from "@rakazo/db";
import { type Context, Hono } from "hono";
import { admitStaticBundle, staticFilePath, staticFileType, staticResponse } from "./bundle.js";
import { readWebPreview } from "./preview.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
export function hostedWebHttp(
  db: PrismaClient,
  secret: string,
  clientIp: (c: Context) => string | undefined,
) {
  const app = new Hono();
  app.onError(() =>
    staticResponse(
      "Website temporarily unavailable. Try again later.",
      "text/plain; charset=utf-8",
      503,
    ),
  );
  // Called before auth/CORS middleware. Every response, including errors, stays sandboxed.
  app.get("/api/published-webs", (c) => c.redirect("./published-webs/", 308));
  app.on(["GET", "HEAD"], "/api/published-webs/", async (c) => {
    const rows = await listHostedWebs(
      db,
      null,
      c.req.query("sort") === "trending" ? "trending" : "discover",
    );
    // Relative links preserve the deployment namespace removed by the reverse proxy.
    const base = "./";
    const cards = rows
      .map(
        (row) =>
          `<article><h2><a href="${base}${encodeURIComponent(row.slug)}/">${escapeHtml(row.title)}</a></h2><p>${escapeHtml(row.summary)}</p><small>${row.views} visitas · v${row.revision}</small></article>`,
      )
      .join("");
    const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webs · Mycellios</title><style>body{font:16px system-ui;background:#f7f5ef;color:#233b2a;max-width:960px;margin:0 auto;padding:48px 24px}h1{font-size:40px;letter-spacing:-.03em}a{color:inherit;text-underline-offset:4px}nav{display:flex;gap:24px;margin:32px 0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}article{padding:24px;background:#e9e7df;border-radius:14px}h2{font-size:21px;margin-top:0}p{line-height:1.6}small{font-variant-numeric:tabular-nums}</style><h1>Webs de la comunidad</h1><p>Utilidades y webs publicadas en Mycellios.</p><nav><a href="${base}">Recientes</a><a href="${base}?sort=trending">Tendencias</a></nav><main>${cards || "<p>Todavía no hay webs publicadas.</p>"}</main></html>`;
    return staticResponse(c.req.method === "HEAD" ? null : html, "text/html; charset=utf-8");
  });
  app.on(["GET", "HEAD"], "/api/published-webs/:slug", (c) => {
    const slug = HostedWebSlug.safeParse(c.req.param("slug"));
    return slug.success
      ? c.redirect(`./${slug.data}/`, 308)
      : staticResponse("Not found", "text/plain", 404);
  });
  app.on(["GET", "HEAD"], "/api/published-webs/:slug/*", async (c) => {
    const slug = HostedWebSlug.safeParse(c.req.param("slug"));
    if (!slug.success) return staticResponse("Not found", "text/plain", 404);
    const requested = c.req.path.split(`/published-webs/${slug.data}/`)[1] || "index.html";
    const versioned = requested.startsWith("_versions/");
    const parts = requested.split("/");
    const revisionId = versioned ? parts[1] : undefined;
    if (
      versioned &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(revisionId ?? "")
    )
      return staticResponse("Not found", "text/plain", 404);
    const site = await publishedHostedWeb(db, slug.data, revisionId);
    if (!site) return staticResponse("Not found", "text/plain", 404);
    const requestedFile = versioned ? parts.slice(2).join("/") : requested;
    const path =
      !requestedFile || requestedFile.endsWith("/") ? `${requestedFile}index.html` : requestedFile;
    if (!staticFilePath(path)) return staticResponse("Not found", "text/plain", 404);
    const file = admitStaticBundle(site.bundle).bundle.files.find((file) => file.path === path);
    if (!file) return staticResponse("Not found", "text/plain", 404);
    // Pin relative CSS/module/image requests to the same frozen revision as the document.
    // The stable share URL always chooses the latest publication; withdrawal gates every version.
    if (!versioned && /\.html$/i.test(path)) {
      const relative = `${"../".repeat(path.split("/").length - 1)}_versions/${site.id}/${path}`;
      const response = staticResponse(null, "text/plain", 302);
      response.headers.set("Location", relative + new URL(c.req.url).search);
      return response;
    }
    const ip = clientIp(c);
    if (
      c.req.method === "GET" &&
      /\.html$/i.test(path) &&
      ip &&
      !/bot|crawler|spider|healthcheck/i.test(c.req.header("user-agent") ?? "")
    ) {
      const day = new Date().toISOString().slice(0, 10);
      const visitor = createHmac("sha256", secret)
        .update(day + "\0" + ip + "\0" + (c.req.header("user-agent") ?? "").slice(0, 256))
        .digest("hex");
      await runAsSystem(
        "hosted webs: count a deduplicated successful published document visit",
        () =>
          db.hostedWebView.upsert({
            where: { siteId_day_visitor: { siteId: site.siteId, day, visitor } },
            create: { siteId: site.siteId, day, visitor },
            update: {},
          }),
      );
    }
    return staticResponse(
      c.req.method === "HEAD" ? null : Buffer.from(file.base64, "base64"),
      staticFileType(file.path)!,
    );
  });
  app.on(["GET", "HEAD"], "/api/web-preview/:token/*", async (c) => {
    const preview = readWebPreview(c.req.param("token"));
    if (!preview)
      return staticResponse("Preview expired. Refresh it in the editor.", "text/plain", 404);
    const admitted = await runAsSystem(
      "hosted webs: revalidate a short-lived owner preview capability, never session authority",
      async () => {
        const owner = await db.spaceMember.findUnique({
          where: {
            spaceId_userId: { spaceId: preview.actor.spaceId, userId: preview.actor.userId },
          },
        });
        if (!owner) return false;
        return Boolean(
          await db.hostedWeb.findFirst({
            where: {
              id: preview.id,
              spaceId: preview.actor.spaceId,
              userId: preview.actor.userId,
              version: preview.version,
            },
            select: { id: true },
          }),
        );
      },
    );
    if (!admitted)
      return staticResponse("Preview expired. Refresh it in the editor.", "text/plain", 404);
    const path = c.req.path.split(`/web-preview/${c.req.param("token")}/`)[1] || "index.html";
    const file = staticFilePath(path)
      ? preview.bundle.files.find((file) => file.path === path)
      : null;
    if (!file) return staticResponse("Not found", "text/plain", 404);
    return staticResponse(
      c.req.method === "HEAD" ? null : Buffer.from(file.base64, "base64"),
      staticFileType(file.path)!,
    );
  });
  app.all("/api/published-webs/*", () => staticResponse("Not found", "text/plain", 404));
  app.all("/api/web-preview/*", () => staticResponse("Not found", "text/plain", 404));
  return app;
}
