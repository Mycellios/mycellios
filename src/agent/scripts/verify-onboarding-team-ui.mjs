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
  const codexOnly = [{ id: "codex", name: "Codex", available: true }];
  let engineList = codexOnly, installs = 0;
  let bots = [], connects = 0, creates = [], normalCreates = 0, mycelliosModels = [], enables = [], roles = [];
  const mycelliosConnection = { id: "fixture-mycellios", provider: "openai-compatible", label: "Mycellios", baseUrl: "https://www.mycellios.com/v1", modelId: "fixture-paid", enabledModelIds: ["fixture-paid"], hasKey: true };
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
      case "models/list": return result([
        { provider: "openai-codex", providerName: "ChatGPT", id: "fixture-codex", label: "Fixture Codex", billing: "Subscription", auth: "oauth", subscription: true, signIn: "device-code", oauthLabel: "Sign in with ChatGPT" },
        { provider: "anthropic", providerName: "Anthropic", id: "fixture-claude", label: "Fixture Claude", billing: "Subscription", auth: "both", subscription: true, signIn: "auth-url", oauthLabel: "Sign in with Claude" },
      ]);
      case "models/mycelliosModels": return result(mycelliosModels);
      case "models/connect": { const input = request.postDataJSON().json; enables.push(input); return result({ ...mycelliosConnection, enabledModelIds: input.enabledModelIds }); }
      case "models/setRole": { const input = request.postDataJSON().json; roles.push(input); return result({ primary: input.primary, backups: [] }); }
      case "bots/list": return result(bots);
      case "engines/list": return result(engineList);
      case "engines/installOpenCode": installs++; engineList = engineList.map(engine => engine.id === "opencode" ? { ...engine, available: true, canInstall: false } : engine); return result({ installed: true });
      case "models/connectMycellios":
        connects++;
        if (!unavailable) { needsModel = false; return result(mycelliosConnection); }
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
  async function open(query = "") {
    await page.goto(origin + "/__onboarding_team?start=" + encodeURIComponent("/onboarding/team?builder=1") + query.replace("?", "&"));
    await expect(page.getByTestId("onboarding-team")).toBeVisible();
  }
  async function gallery() { await page.getByRole("button", { name: "Or start from a role", exact: true }).click(); }
  async function createSEO() { await gallery(); await page.getByRole("button", { name: "Create and open this team: SEO", exact: true }).click(); }
  // First run asks one question. Free models connect Mycellios, select the managed AntSeed free route
  // it recommends (never a recommended paid one, nor a zero-priced network model) and open the team.
  needsModel = true;
  const zeroPrice = { currency: "credits", unit: "token", serviceFeeBasisPoints: 400, input: "0", output: "0" };
  mycelliosModels = [
    { provider: "openai-compatible", id: "mycellios/managed/fixture-paid", label: "Paid", billing: "Credits", recommended: true, mycelliosProcessing: "external", mycelliosPricing: { ...zeroPrice, input: "1", output: "2" } },
    { provider: "openai-compatible", id: "fixture-network", label: "Network", billing: "0 Credits", recommended: true, mycelliosProcessing: "network", mycelliosPricing: { ...zeroPrice, serviceFeeBasisPoints: 0 } },
    { provider: "openai-compatible", id: "mycellios/managed/fixture-free-other", label: "Other free", billing: "0 Credits", mycelliosProcessing: "external", mycelliosPricing: zeroPrice },
    { provider: "openai-compatible", id: "mycellios/managed/free", label: "Free", billing: "0 Credits", recommended: true, mycelliosProcessing: "external", mycelliosPricing: zeroPrice },
  ];
  for (const lang of ["es", "en"]) {
    await page.goto(origin + "/__onboarding_team" + (lang === "es" ? "?lang=es" : ""));
    await expect(page.getByTestId("first-run-choice")).toBeVisible();
    await page.screenshot({ path: path.join(output, `first-run-choice${lang === "es" ? "-es" : ""}.png`) });
  }
  // A saved team-builder address from an older first run still lands on the single choice.
  await page.goto(origin + "/__onboarding_team?start=/onboarding/team");
  await expect(page.getByTestId("first-run-choice")).toBeVisible();
  await expect(page.getByTestId("onboarding-team")).toHaveCount(0);
  await page.getByRole("button", { name: "Use free models", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(connects, 1);
  assert.deepEqual(enables.map(input => input.enabledModelIds), [["fixture-paid", "mycellios/managed/free"]]);
  assert.equal(roles.length, 1);
  assert.deepEqual(roles[0].primary, { provider: "openai-compatible", modelId: "mycellios/managed/free", credentialId: "fixture-mycellios" });
  assert(bots.length >= 2 && creates.every(input => !input.agentEngine && input.expectedUserId === "fixture-owner"));
  proof.freeModelsStart = true;
  // Free models only come through AntSeed: without the managed free route the start says so instead
  // of opening the team on a paid model, a zero-priced network model or OpenCode's anonymous models,
  // whether or not OpenCode is installed or downloadable.
  const withOpenCode = [...codexOnly, { id: "opencode", name: "OpenCode", available: false, canInstall: true }];
  for (const [accountUnavailable, models] of [[true, []], [false, mycelliosModels.slice(0, 2)]]) {
    bots = []; creates = []; roles = []; installs = 0; unavailable = accountUnavailable; needsModel = true; engineList = withOpenCode; mycelliosModels = models;
    await page.goto(origin + "/__onboarding_team");
    await page.getByRole("button", { name: "Use free models", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("No free models are available right now. Try again in a few minutes or use your AI subscription.");
    await expect(page.getByTestId("team-created")).toHaveCount(0);
    assert.equal(bots.length, 0); assert.equal(roles.length, 0); assert.equal(installs, 0);
  }
  unavailable = false; engineList = codexOnly; needsModel = true;
  proof.freeStartNeverPaid = true;
  bots = []; creates = []; connects = 0; enables = []; roles = []; mycelliosModels = [];
  // A subscription goes straight to its connection, then opens the same team on it.
  await page.goto(origin + "/__onboarding_team");
  await page.getByRole("button", { name: "Use my AI subscription", exact: true }).click();
  await page.screenshot({ path: path.join(output, "subscription-step.png") });
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(connects, 0); assert.equal(roles.length, 0);
  assert(bots.length >= 2 && creates.every(input => input.agentEngine === "codex"));
  proof.subscriptionStart = true;
  bots = []; creates = []; needsModel = false;
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
  assert(creates.every(input => !input.model && !input.agentEngine && input.computerMode === "isolated" && input.expectedUserId === "fixture-owner"));
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
  // Installed-account selection after a proposal must retain every role.
  bots = []; creates = []; needsModel = true;
  const connectionsBeforeNativeChoice = connects;
  await open();
  await page.getByRole("textbox").fill("Review customer requests");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const answer of ["Support", "A small team", "Draft work for me to review"]) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByRole("button", { name: "Use your own provider", exact: true }).click();
  await page.getByRole("button", { name: "Use my account", exact: true }).click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(page.getByTestId("team-created")).toBeVisible();
  assert.equal(bots.length, 3); assert.equal(connects, connectionsBeforeNativeChoice);
  assert(creates.every(input => input.agentEngine === "codex" && input.computerMode === "team" && input.expectedUserId === "fixture-owner"));
  proof.installedAccountPreservesTeam = true;
  needsModel = false;
  bots = []; await page.setViewportSize({ width: 390, height: 844 });
  await open("?lang=es");
  await expect(page.getByRole("heading", { name: "¿Qué debe hacer tu equipo?", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "team-first-run-es-mobile.png") });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: path.join(output, "team-first-run-es-mobile-dark.png") });
  // The connection step uses the same grouped rows and a single back link.
  await page.setViewportSize({ width: 1100, height: 840 });
  await page.getByRole("button", { name: "Usa tu propio proveedor", exact: true }).click();
  await expect(page.getByTestId("connection-path")).toBeVisible();
  await page.screenshot({ path: path.join(output, "connection-path-es-dark.png") });
  await page.getByRole("button", { name: "Poner una clave API", exact: true }).click();
  await page.screenshot({ path: path.join(output, "connection-key-es-dark.png") });
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  proof.passed = true;
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally { await browser?.close(); await server.close(); }
