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
  const app = Fastify();
  await app.register(fastifyStatic, { root });
  registerLandingEntryRoutes(app, root);
  app.get("/public/v1/snapshot", () => ({ source: "coordinator" }));
  cleanups.push(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  return app;
}
describe("marketing route entries", () => {
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
});
