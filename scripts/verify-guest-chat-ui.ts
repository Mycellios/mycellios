/**
 * Real-browser qualification of registration-free guest chat (specs/guest-chat/spec.md).
 * The Agent web Dev server proxies /mobile/v1/guest to a loopback coordinator that mounts the
 * real guest routes on an isolated PostgreSQL cluster and a fictional zero-priced seller.
 * No production account, credential, model or paid supplier is involved; external traffic is blocked.
 *
 *   npx tsx scripts/verify-guest-chat-ui.ts [--output=<folder for screenshots>]
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import postgres from "postgres";
import Fastify from "fastify";
import { chromium } from "../src/agent/node_modules/@playwright/test/index.mjs";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet } from "../src/economy/contribution-credit-wallet.js";
import { ManagedPurchases } from "../src/economy/managed-purchases.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { ManagedGateway } from "../src/coordinator/managed-gateway.js";
import { GuestChat } from "../src/coordinator/guest-chat.js";
import { mountGuestChat } from "../src/coordinator/guest-chat-routes.js";
import { guestChatConfigSchema } from "../src/core/guest-chat-config.js";
import { createGuestChatSchema } from "../tests/fixtures/guest-chat-postgres.js";

const output = process.argv.find(arg => arg.startsWith("--output="))?.slice("--output=".length);
const ANSWER = "Mycellios is a distributed network. In guest mode I can only chat.";
const freePort = async () => {
  const server = createServer(); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port; await new Promise<void>(done => server.close(() => done()));
  return port;
};
const children: ChildProcess[] = [];
let cluster: string | undefined, pgBin: string | undefined;
const exe = (name: string) => join(pgBin!, process.platform === "win32" ? name + ".exe" : name);

async function startPostgres(): Promise<string> {
  if (process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL) return process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
  pgBin = process.env.MYCELLIOS_TEST_POSTGRES_BIN
    ?? resolve("src/agent/node_modules/@embedded-postgres/windows-x64/native/bin");
  if (!existsSync(exe("initdb"))) throw new Error("Set MYCELLIOS_TEST_POSTGRES_BIN or MYCELLIOS_REFERRAL_TEST_POSTGRES_URL");
  cluster = mkdtempSync(join(tmpdir(), "mycellios-guest-ui-pg-"));
  const port = await freePort();
  execFileSync(exe("initdb"), ["-D", cluster, "--auth=trust", "--no-locale", "-U", "postgres", "-E", "UTF8"], { stdio: "ignore" });
  execFileSync(exe("pg_ctl"), ["-D", cluster, "-l", join(cluster, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=20`, "-w", "start"], { stdio: "ignore" });
  return `postgresql://postgres@127.0.0.1:${port}/postgres`;
}

async function main() {
  const url = await startPostgres();
  const schema = "guest_ui_" + randomBytes(4).toString("hex");
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  await createGuestChatSchema(sql, schema, schema + "_native");
  const db = await MeshDatabase.openPostgres(url, schema);
  const wallet = new ContributionCreditWallet(db, new EconomicLedger(db, { receiptSigning: {
    keyId: "test-only", privateKey: generateKeyPairSync("ed25519").privateKey } }), true);
  await wallet.initialize();
  const api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 1000, maxConcurrent: 10, maxActiveKeys: 1 }, {}, true);
  const purchases = new ManagedPurchases(db, wallet, 10_000_000); await purchases.initialize();
  const requests: unknown[] = [];
  const provider = {
    provider: "fictional-test", ensureFresh: async () => {}, catalog: () => [],
    quote: () => ({ maximumUsd: "0", maximumMicrounits: 0, expiresAt: Date.now() + 60_000, body: { max_tokens: 800 }, fundingCostBasisPoints: 0 }),
    async execute(_quote: unknown, chunk?: (v: Record<string, unknown>) => void, _submitted?: unknown, options?: unknown) {
      requests.push(options);
      for (const word of ANSWER.split(/(?<= )/)) { chunk?.({ choices: [{ delta: { content: word } }] }); await new Promise(r => setTimeout(r, 25)); }
      return { receiptId: "test-receipt-" + randomUUID(), usd: "0", inputTokens: 20, outputTokens: 14, response: { id: "test-only",
        model: "mycellios/managed/free", choices: [{ index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }] } };
    },
  };
  const gateway = new ManagedGateway(db, purchases, api, provider, 200_000);
  const webPort = await freePort(), coordinatorPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`, coordinator = `http://127.0.0.1:${coordinatorPort}`;
  const service = new GuestChat(guestChatConfigSchema.parse({ publicOrigin: webOrigin, secret: randomBytes(32).toString("base64url"),
    powDifficulty: 14, messagesPerSession: 3 }), db, gateway);
  assert.equal(await service.initialize(), true);
  const app = Fastify();
  // The signed-out visitor: Agent's session read answers "no session" like the real API.
  app.get("/api/auth/get-session", async () => null);
  mountGuestChat(app, service, request => request.ip);
  await app.listen({ host: "127.0.0.1", port: coordinatorPort });

  const vite = spawn(process.execPath, [resolve("src/agent/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
    cwd: resolve("src/agent/apps/web"), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, RAKAZO_PROJECT_LOCAL: "1", MYCELLIOS_BROWSER_COORDINATOR: coordinator, API_PROXY_TARGET: coordinator },
  });
  children.push(vite);
  for (let i = 0; ; i++) {
    try { if ((await fetch(webOrigin + "/")).ok) break; } catch { /* starting */ }
    if (i > 240) throw new Error("Agent web Dev server did not start");
    await new Promise(r => setTimeout(r, 500));
  }

  const browser = await chromium.launch();
  const results: Record<string, unknown> = {};
  try {
    for (const [name, locale, options] of [
      ["desktop", "en", { viewport: { width: 1280, height: 800 } }],
      ["mobile", "es", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ] as const) {
      const context = await browser.newContext(options);
      // The visitor already answered Agent's one-time language question.
      await context.addInitScript(value => {
        try { localStorage.setItem("mycellios.uiLocale", value); localStorage.setItem("mycellios.uiLocaleConfirmed", value); } catch { /* fixture */ }
      }, locale);
      await context.route("**/*", route => {
        const target = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(target.hostname) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const failed: string[] = [];
      page.on("response", response => { if (response.status() >= 400) failed.push(response.status() + " " + new URL(response.url()).pathname); });
      await page.goto(webOrigin + "/");
      await page.locator("[data-guest-chat]").waitFor({ timeout: 60_000 }).catch(async error => {
        if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `guest-${name}-failure.png`) }); }
        console.error(JSON.stringify({ url: page.url(), failed, errors, text: (await page.locator("body").innerText()).slice(0, 600) }));
        throw error;
      });
      const notice = await page.locator("[data-guest-notice]").innerText();
      assert.match(notice, locale === "es" ? /No compartas información sensible/ : /Do not share sensitive information/);
      if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `guest-${name}-empty.png`) }); }

      const composer = page.locator("textarea");
      for (let turn = 1; turn <= 3; turn++) {
        await composer.fill(`Question ${turn}: what is Mycellios?`);
        if (name === "mobile") await page.locator('form button[type="submit"]').tap();
        else await composer.press("Enter");
        await page.locator('[data-role="assistant"]:not([aria-busy])').nth(turn - 1).filter({ hasText: "distributed network" })
          .waitFor({ timeout: 30_000 }).catch(async error => {
            if (output) await page.screenshot({ path: join(output, `guest-${name}-turn-failure.png`) });
            console.error(JSON.stringify({ turn, failed, errors, text: (await page.locator("main").innerText()).slice(0, 1200) }));
            throw error;
          });
        if (turn === 1) {
          const cookies = await context.cookies(webOrigin + "/mobile/v1/guest/chat");
          const guest = cookies.find(cookie => cookie.name === "mycellios-guest-local");
          assert.ok(guest, "guest cookie set");
          assert.equal(guest.path, "/mobile/v1/guest"); assert.equal(guest.httpOnly, true); assert.equal(guest.sameSite, "Strict");
          assert.equal((await context.cookies(webOrigin + "/")).some(cookie => cookie.name.includes("guest")), false);
          if (output) await page.screenshot({ path: join(output, `guest-${name}-answer.png`) });
          // A reload in the same tab keeps the transcript.
          await page.reload();
          await page.locator("[data-guest-chat]").waitFor();
          assert.equal(await page.locator("[data-role]").count(), 2);
        }
      }
      await page.locator('[data-guest-alert="guest_session_limit_reached"]').waitFor();
      assert.equal(await composer.isDisabled(), true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `no horizontal page scroll (${overflow})`);
      if (output) await page.screenshot({ path: join(output, `guest-${name}-limit.png`) });
      await page.locator('[data-guest-alert="guest_session_limit_reached"] button').first().click();
      await page.waitForURL(/\/sign-up$/);
      // A deep link keeps the ordinary sign-in flow instead of guest chat.
      await page.goto(webOrigin + "/?task=test-only");
      await page.waitForTimeout(1500);
      assert.equal(await page.locator("[data-guest-chat]").count(), 0);
      assert.deepEqual(errors, []);
      results[name] = { turns: 3, cookie: "scoped", reload: "kept", limit: "account offered", deepLink: "sign-in flow" };
      await context.close();
    }
    // Installed web apps keep requiring sign-in.
    const standalone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await standalone.newPage();
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => query.includes("display-mode: standalone")
        ? { ...original(query), matches: true, media: query } as MediaQueryList : original(query);
    });
    await page.goto(webOrigin + "/");
    await page.waitForTimeout(3000);
    assert.equal(await page.locator("[data-guest-chat]").count(), 0);
    results.standalone = "sign-in flow";
    await standalone.close();
    assert.equal(requests.length, 6);
    assert.ok(requests.every(options => JSON.stringify(options) === JSON.stringify({ freeRefusalRetries: 0 })));
    const stored = JSON.stringify(await db.raw.prepare("SELECT * FROM guest_chat_sessions").all());
    assert.ok(!stored.includes("Mycellios") && !stored.includes("Question"), "no content stored");
    console.log(JSON.stringify({ passed: true, ...results, inferences: requests.length, paidSuppliers: 0 }));
  } finally {
    await browser.close();
    await app.close();
    await db.close();
    await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${schema}_native`).catch(() => {});
    await sql.end();
  }
}

try { await main(); }
finally {
  for (const child of children) child.kill();
  if (cluster && pgBin) {
    try { execFileSync(exe("pg_ctl"), ["-D", cluster, "-m", "immediate", "stop"], { stdio: "ignore" }); } catch { /* already stopped */ }
    rmSync(cluster, { recursive: true, force: true });
  }
}
