import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { afterEach, describe, expect, it } from "vitest";
import { registerLandingEntryRoutes } from "../src/coordinator/landing-entry-routes.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function site() {
  const root = mkdtempSync(join(tmpdir(), "mycellios-marketing-"));
  mkdirSync(join(root, "stats")); mkdirSync(join(root, "compare", "grok-bot"), { recursive: true });
  mkdirSync(join(root, "changelog"));
  writeFileSync(join(root, "index.html"), "<h1>Mycellios</h1>");
  writeFileSync(join(root, "stats", "index.html"), "<h1>Mycellios Stats</h1>");
  writeFileSync(join(root, "changelog", "index.html"), "<h1>Mycellios Changelog</h1>");
  writeFileSync(join(root, "compare", "grok-bot", "index.html"), "<h1>Mycellios vs Grok Bot</h1>");
  mkdirSync(join(root, "es", "guias", "empezar"), { recursive: true });
  writeFileSync(join(root, "es", "guias", "empezar", "index.html"), '<html lang="es"><h1>Tu primer Mico</h1></html>');
  writeFileSync(join(root, "es", "guias", "empezar.md"), "# Tu primer Mico\nContenido en español");
  const app = Fastify();
  await app.register(fastifyStatic, { root });
  registerLandingEntryRoutes(app, root);
  app.get("/public/v1/snapshot", () => ({ source: "coordinator" }));
  cleanups.push(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  return app;
}
describe("marketing route entries", () => {
  it("serves translated HTML and Markdown, with canonical redirects and no duplicate indexing", async () => {
    const app = await site();
    expect((await app.inject("/es/guias/empezar")).body).toContain('lang="es"');
    const markdown = await app.inject("/es/guias/empezar.md");
    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.headers["x-robots-tag"]).toBe("noindex, follow");
    expect(markdown.headers.link).toContain("https://www.mycellios.com/es/guias/empezar");
    expect((await app.inject("/es/guias/empezar/?from=footer")).headers.location).toBe("/es/guias/empezar?from=footer");
    expect((await app.inject("/es/guias/nonexistent")).statusCode).toBe(404);
    expect((await app.inject("/guides/models-and-credits")).statusCode).toBe(404); // Missing build must not serve home as a guide.
    expect((await app.inject("/account")).headers["x-robots-tag"]).toContain("noindex");
    expect((await app.inject("/network?view=jobs")).headers["x-robots-tag"]).toContain("noindex");
  });
  it("selects the Stats document only on the exact Stats host and leaves APIs intact", async () => {
    const app = await site();
    expect((await app.inject({ url: "/", headers: { host: "stats.mycellios.com" } })).body).toContain("Mycellios Stats");
    expect((await app.inject({ url: "/", headers: { host: "www.mycellios.com" } })).body).not.toContain("Mycellios Stats");
    expect((await app.inject({ url: "/", headers: { host: "stats.mycellios.com.example.org" } })).body).not.toContain("Mycellios Stats");
    expect((await app.inject({ url: "/public/v1/snapshot", headers: { host: "stats.mycellios.com" } })).json()).toEqual({ source: "coordinator" });
  });
  it("preserves old bookmarks with permanent redirects and query strings", async () => {
    const app = await site();
    for (const [from, to] of [["/create", "/"], ["/spore/data/", "/stats"], ["/spore/treasury", "/spore/rewards"], ["/spore/treasure/", "/spore/rewards"]]) {
      const response = await app.inject(`${from}?from=bookmark`);
      expect(response.statusCode).toBe(308); expect(response.headers.location).toBe(`${to}?from=bookmark`);
    }
  });
  it("serves a comparison's own document instead of the marketing home", async () => {
    const app = await site();
    const response = await app.inject("/compare/grok-bot");
    expect(response.statusCode).toBe(200); expect(response.body).toContain("Mycellios vs Grok Bot");
  });
  it("serves the changelog document and retains product filters in slash redirects", async () => {
    const app = await site();
    const response = await app.inject("/changelog?product=desktop");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Mycellios Changelog");
    expect((await app.inject("/changelog/?product=agent")).headers.location).toBe("/changelog?product=agent");
  });
  it("sends old dashboard API key links to the Agent account", async () => {
    const app = await site();
    for (const url of ["/account?tab=api", "/account?tab=api&from=landing"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://www.mycellios.com/agent/app?settings=api-keys");
    }
    expect((await app.inject("/account/?tab=api")).headers.location).toBe("/account?tab=api");
    expect((await app.inject("/account?tab=billing")).statusCode).toBe(200);
    expect((await app.inject("/account")).statusCode).toBe(200);
  });
});
