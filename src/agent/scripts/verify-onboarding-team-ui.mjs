import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? "onboarding-team-proof");
await mkdir(output, { recursive: true });
const root = path.resolve("apps/web");
process.chdir(root);
const server = await createServer({ root, envFile: false, configFile: path.join(root, "vite.config.ts"),
  optimizeDeps: { entries: [path.join(root, "e2e/fixtures/onboarding-team.tsx")] },
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "isolated-team-onboarding", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/__onboarding_team")) return next();
      const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/onboarding-team.tsx"></script></body></html>');
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }] });
let browser;
const proof = { passed: false, realPage: true, defaultProviderPreserved: false, profileOnly: false, oldServerFailsClosed: false, retryWithoutDuplicates: false, externalRequests: 0, paidInferenceCalls: 0, productionAccess: false };
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch(existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {});
  const errors = [], unexpected = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 840 } });
  page.on("pageerror", error => errors.push(error.message));
  let needsModel = false, unavailable = false, oldServer = false, interrupted = false;
  let bots = [], connects = 0, creates = [], normalCreates = 0;
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname === "/api/auth/capabilities") return route.fulfill({ json: { mycelliosAccount: true, sso: null, passwordAuth: true } });
    const rpc = url.pathname.split("/rpc/")[1];
    if (!rpc) {
      if (/^\/(?:agent\/)?(?:api|v1|mobile|public)\//.test(url.pathname)) { unexpected.push(url.pathname); return route.abort(); }
      return route.continue();
    }
    const result = json => route.fulfill({ json: { json } });
    switch (rpc) {
      case "me": return result({ userId: "fixture-owner", spaceId: "fixture-space", needsSignupSurvey: false, needsModel, billingEnabled: false, defaultProvider: needsModel ? null : "fixture-personal", defaultModel: needsModel ? null : "fixture-model" });
      case "models/list": case "models/mycelliosModels": return result([]);
      case "bots/list": return result(bots);
      case "models/connectMycellios":
        connects++;
        if (!unavailable) { needsModel = false; return result({}); }
        return route.fulfill({ status: 503, json: { json: { defined: false, code: "SERVICE_UNAVAILABLE", status: 503, message: "Synthetic unavailable account" } } });
      case "bots/create": normalCreates++; return route.abort();
      case "bots/createProfile": {
        assert.equal(request.headers()["x-rakazo-space-id"], "fixture-space");
        if (oldServer) return route.fulfill({ status: 404, json: { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Synthetic older server" } } });
        const input = request.postDataJSON().json;
        creates.push(input);
        if (interrupted && bots.length === 1) { interrupted = false; return route.abort(); }
        const bot = bots.find(bot => bot.spawnKey === input.spawnKey) ?? { id: `fixture-mico-${bots.length + 1}`, ...input };
        if (!bots.includes(bot)) bots.push(bot);
        return result(bot);
      }
      default: unexpected.push(rpc); return route.abort();
    }
  });
  async function open(query = "") { await page.goto(origin + "/__onboarding_team" + query); await expect(page.getByTestId("onboarding-team")).toBeVisible(); }
  async function gallery() { await page.getByRole("button", { name: "Or start from a role", exact: true }).click(); }
  async function createSEO() { await gallery(); await page.getByRole("button", { name: "Create and open this team: SEO", exact: true }).click(); }
  // A configured personal model still reaches the team builder and is never replaced.
  await open();
  await expect(page.getByText("Creating your team uses no credits. You choose when to start.", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, "team-first-run-en.png") });
  await page.getByRole("textbox").fill("Review customer requests");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const answer of ["Support", "A small team", "Draft work for me to review"]) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.screenshot({ path: path.join(output, "team-proposal-en.png") });
  await page.getByRole("button", { name: "Create and open this team", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(connects, 0); assert.equal(bots.length, 3); assert.equal(normalCreates, 0);
  assert(creates.every(input => !input.model && !input.agentEngine && input.expectedUserId === "fixture-owner"));
  proof.defaultProviderPreserved = true; proof.profileOnly = true;
  bots = []; creates = [];
  await open();
  await page.getByRole("button", { name: "Start with one Mico", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(creates.length, 0);
  // Account discovery failure never creates profiles or selects another payer.
  bots = []; creates = []; needsModel = true; unavailable = true;
  await open(); await createSEO();
  await expect(page.getByRole("alert")).toContainText("No credits were spent.");
  assert.equal(bots.length, 0); assert.equal(creates.length, 0); assert.equal(connects, 1);
  await page.screenshot({ path: path.join(output, "team-credit-recovery.png") });
  unavailable = false; needsModel = false; oldServer = true;
  await page.getByRole("button", { name: "Create and open this team: SEO", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not create the team.");
  assert.equal(bots.length, 0); assert.equal(normalCreates, 0); proof.oldServerFailsClosed = true;
  oldServer = false; interrupted = true;
  await page.getByRole("button", { name: "Create and open this team: SEO", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not create the team.");
  assert.equal(bots.length, 1);
  await page.getByRole("button", { name: "Create and open this team: SEO", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(bots.length, 3); assert.equal(new Set(bots.map(bot => bot.spawnKey)).size, 3);
  proof.retryWithoutDuplicates = true;
  bots = []; await page.setViewportSize({ width: 390, height: 844 });
  await open("?lang=es");
  await expect(page.getByRole("heading", { name: "¿Qué debe hacer tu equipo?", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "team-first-run-es-mobile.png") });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: path.join(output, "team-first-run-es-mobile-dark.png") });
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  proof.passed = true;
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
