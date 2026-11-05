/** Opt-in, synthetic-account qualification through the real Electron bridge/model.
 * Run the complete process once through compilar.ps1. No nested queue in child tests.
 * Only the existing unexpired access token is read; refresh credentials are not copied.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { appendFileSync } from "node:fs";
import { projectLocalEnvironment } from "./project-local-env.mjs";

if (!process.argv.includes("--allow-real-model")) throw Error("Real-model qualification requires --allow-real-model");
const authFile = process.env.MYCELLIOS_DESKTOP_QUALIFICATION_AUTH;
if (!authFile || !path.isAbsolute(authFile)) throw Error("Supply the existing model auth file explicitly");
const osEnv = projectLocalEnvironment();
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, osEnv);
const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(process.env.LOCALAPPDATA!, "Mycellios-project-qualification-"));
const stage = (name: string) => appendFileSync(path.join(directory, "stages.jsonl"), JSON.stringify({ at: Date.now(), pid: process.pid, stage: name }) + "\n");
process.on("exit", code => stage(`process-exit:${code}`));
process.on("uncaughtExceptionMonitor", error => stage(`uncaught:${error.name}:${(error as NodeJS.ErrnoException).code ?? ""}`));
stage("starting");
const profile = path.join(directory, "desktop"), repo = path.join(directory, "example-app");
await mkdir(profile); await mkdir(repo);
const exec = promisify(execFile);
const freePort = async () => {
  const socket = netServer(); await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve())); return port;
};
const [dbPort, apiPort, webPort, barrierPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
const base = `http://127.0.0.1:${webPort}`, apiBase = `http://127.0.0.1:${apiPort}`;
const databasePassword = randomBytes(24).toString("hex"), encryptionKey = randomBytes(32).toString("hex");
const url = `postgresql://postgres:${databasePassword}@127.0.0.1:${dbPort}/postgres`;
Object.assign(process.env, { DATABASE_URL: url, DATABASE_MIGRATION_URL: url, REALTIME_DATABASE_URL: url,
  API_URL: apiBase, API_PORT: String(apiPort), WEB_PORT: String(webPort), WEB_ORIGIN: base, BETTER_AUTH_URL: base,
  API_PROXY_TARGET: apiBase, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), ENCRYPTION_KEY: encryptionKey,
  SCREEN_PROXY_SECRET: randomBytes(32).toString("hex"), CONTENT_ENCRYPTION: "off", WAKEUP_DRIVER: "memory",
  DATA_DIR: path.join(directory, "api-data"), MYCELLIOS_DESKTOP_RELAY_ENABLED: "true",
  DB_POOL_MAX: "6", MCP_ALLOW_PRIVATE_ENDPOINT: "true", LOG_LEVEL: "warn",
});
// Refuse production hosts and refresh/token endpoints before importing the app.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!(target.protocol === "http:" && target.hostname === "127.0.0.1") &&
      !(target.protocol === "https:" && target.hostname === "chatgpt.com" && target.pathname.startsWith("/backend-api/codex/")))
    throw Error(`Qualification outbound destination refused: ${target.hostname}`);
  return originalFetch(input, init);
};
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const pg = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), user: "postgres", password: databasePassword,
  port: dbPort, persistent: true, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
let app: Awaited<ReturnType<typeof import("../apps/api/src/app.js").createApp>> | undefined;
let electronApp: Awaited<ReturnType<(typeof import("@playwright/test"))["_electron"]["launch"]>> | undefined;
let web: Awaited<ReturnType<typeof import("vite").createServer>> | undefined;
let http: ReturnType<typeof createServer> | undefined;
let diagnostic: ReturnType<typeof pg.getPgClient> | undefined;
let diagnosticTimer: ReturnType<typeof setInterval> | undefined;
const arrivals: Array<{ participant: string; pid: number; at: number }> = [];
const waiting: Array<import("node:http").ServerResponse> = [];
let barrierReleasedAt: number | undefined;
const barrier = createServer((req, res) => {
  const target = new URL(req.url!, `http://127.0.0.1:${barrierPort}`), participant = target.searchParams.get("participant");
  if (target.pathname !== "/ready" || !["math", "text"].includes(participant ?? "") || arrivals.some(a => a.participant === participant)) { res.writeHead(409).end(); return; }
  arrivals.push({ participant: participant!, pid: Number(target.searchParams.get("pid")), at: Date.now() }); waiting.push(res);
  if (waiting.length === 2) { barrierReleasedAt = Date.now(); for (const response of waiting) response.writeHead(200).end("both tests running"); }
});
let cookie = "", owner = "";
try {
  // Build the exact current native sources inside this qualification's single queue slot.
  await exec(process.execPath, ["scripts/build.mjs"], { cwd: path.join(root, "apps/desktop"), env: process.env,
    windowsHide: true, maxBuffer: 1024 * 1024 });
  await pg.initialise(); await pg.start();
  const encodingProbe = pg.getPgClient(); await encodingProbe.connect();
  try {
    assert.equal((await encodingProbe.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
    const unicode = "Español · 中文 · ✓ ✖ 🍄";
    await encodingProbe.query("CREATE TEMP TABLE unicode_probe(value text)");
    await encodingProbe.query("INSERT INTO unicode_probe VALUES ($1)", [unicode]);
    assert.equal((await encodingProbe.query("SELECT value FROM unicode_probe")).rows[0].value, unicode);
  } finally { await encodingProbe.end(); }
  console.log("Isolated PostgreSQL: UTF8 storage and Unicode round trip passed");
  diagnostic = pg.getPgClient(); await diagnostic.connect();
  await diagnostic.query("SET default_transaction_read_only=on");
  let sampling = false;
  diagnosticTimer = setInterval(() => {
    if (sampling) return; sampling = true;
    void diagnostic!.query("SELECT pid, state, wait_event_type, wait_event, left(query,220) AS query, EXTRACT(EPOCH FROM (now()-xact_start)) AS transaction_seconds FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid LIMIT 40")
      .then(result => writeFile(path.join(directory, "database-activity.json"), JSON.stringify({ at: Date.now(), rows: result.rows })))
      .catch(() => undefined).finally(() => { sampling = false; });
  }, 5000);
  await exec(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { cwd: root, windowsHide: true, env: process.env, maxBuffer: 1024 * 1024 });
  const { serve } = await import("@hono/node-server");
  const { createApp } = await import("../apps/api/src/app.js");
  app = await createApp();
  http = serve({ fetch: async request => {
    const response = await app!.app.fetch(request);
    const route = new URL(request.url).pathname;
    if (route.startsWith("/api/desktop-relay/") && response.status >= 400) {
      const value = await response.clone().json().catch(() => ({})) as { error?: string };
      await appendFile(path.join(directory, "relay-errors.jsonl"), JSON.stringify({ at: Date.now(), route, status: response.status, error: value.error }) + "\n");
    }
    if (["/api/desktop-relay/account", "/api/desktop-relay/poll", "/api/desktop-relay/identity", "/api/desktop-relay/bind"].includes(route))
      await appendFile(path.join(directory, "relay-traffic.jsonl"), JSON.stringify({ at: Date.now(), route, status: response.status }) + "\n");
    return response;
  }, hostname: "127.0.0.1", port: apiPort }) as unknown as ReturnType<typeof createServer>;
  await new Promise<void>(resolve => barrier.listen(barrierPort, "127.0.0.1", resolve));
  const { createServer: createVite } = await import("vite");
  // Lingui resolves its config from cwd, as in the normal web workspace command.
  process.chdir(path.join(root, "apps/web"));
  web = await createVite({ root: path.join(root, "apps/web"), configFile: path.join(root, "apps/web/vite.config.ts"), envDir: false,
    server: { host: "127.0.0.1", port: webPort, strictPort: true } });
  await web.listen();
  const signup = await fetch(`${apiBase}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: `projects-${randomUUID()}@example.invalid`, password: randomBytes(24).toString("hex"), name: "Desktop qualification" }) });
  if (!signup.ok) throw Error(`Local signup refused: ${signup.status} ${await signup.text()}`);
  const registered = await signup.json() as { user: { id: string } }; owner = registered.user.id;
  cookie = signup.headers.getSetCookie().map(v => v.split(";")[0]).join("; "); assert.ok(cookie);
  const { asSystem, createRepos, runAsTenant } = await import("@rakazo/db");
  const prisma = asSystem(app.prisma, "isolated real-model project qualification");
  let membership = await prisma.spaceMember.findFirst({ where: { userId: owner } });
  if (!membership) {
    const organizationId = randomUUID(), spaceId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Qualification", slug: organizationId, createdAt: new Date() } });
    await prisma.member.create({ data: { id: randomUUID(), organizationId, userId: owner, role: "owner", createdAt: new Date() } });
    await prisma.space.create({ data: { id: spaceId, organizationId, name: "Qualification" } });
    membership = await prisma.spaceMember.create({ data: { id: randomUUID(), organizationId, spaceId, userId: owner, role: "owner", createdAt: new Date() } });
  }
  const spaceId = membership.spaceId, scope = { userId: owner, spaceId };
  const auth = JSON.parse(await readFile(authFile, "utf8"));
  const claims = JSON.parse(Buffer.from(auth.tokens.access_token.split(".")[1], "base64url").toString("utf8"));
  assert.ok(claims.exp * 1000 > Date.now() + 60 * 60_000, "Access token must remain valid without refreshing");
  const { EncryptedSecretStore } = await import("../packages/adapters/src/secrets.js");
  const { serializeModelSecret } = await import("../packages/adapters/src/pi-oauth.js");
  const model = "gpt-6.1-sol";
  const secret = await new EncryptedSecretStore(encryptionKey).put(serializeModelSecret({ kind: "oauth", maxTokens: 4096,
    credential: { type: "oauth", access: auth.tokens.access_token, refresh: "", expires: claims.exp * 1000, accountId: auth.tokens.account_id } }),
    { ...scope, operationId: "qualification", traceId: "qualification", signal: AbortSignal.timeout(5000) });
  await prisma.secret.create({ data: { id: secret.id, userId: owner, kind: "model", ciphertext: secret.ciphertext } });
  const credential = await prisma.userModelCredential.create({ data: { userId: owner, provider: "openai-codex", label: "Existing subscription (qualification)", secretId: secret.id } });
  await prisma.userModelPreference.create({ data: { userId: owner, credentialId: credential.id, modelId: model, thinkingLevel: "low" } });
  for (const role of ["main", "approval"])
    await prisma.userModelRoleChoice.create({ data: { userId: owner, role, position: 0, provider: "openai-codex", modelId: model, credentialId: credential.id, thinkingLevel: "low" } });
  const { aiRecipient } = await import("../packages/adapters/src/ai-consent.js");
  const { AI_DISCLOSURE_VERSION } = await import("@rakazo/contracts");
  const recipient = aiRecipient({ provider: "openai-codex", modelId: model, use: "model" });
  assert.ok(recipient);
  await prisma.aiDataConsent.create({ data: { ...scope, recipientKey: recipient.key, version: AI_DISCLOSURE_VERSION } });
  await prisma.userActionAutoReviewPreference.create({ data: { userId: owner, enabled: false, skipApprovals: true } });
  // Use normal creation so the Mico receives its ordinary Team computer record.
  const bot = await runAsTenant(scope, () => createRepos(app!.prisma).createBot({ ...scope, email: "qualification@example.invalid", isDeploymentOwner: false }, {
    name: "Developer lab", title: "", description: "", notifyOnFinish: false,
    color: "#10B981", modelProvider: "openai-codex", modelId: model, thinkingLevel: "low",
    instructions: "Act directly on the requested isolated test project. Do not ask questions, browse external sites, alter tests or make commits. This qualification process already owns the workstation queue; never nest compilar.ps1.",
  }));
  const project = await prisma.developmentProject.create({ data: { ...scope, id: randomUUID(), name: "Parallel project qualification" } });
  const threads = await Promise.all(["Arithmetic", "Text cleanup"].map(title => prisma.thread.create({ data: { ...scope, taskBotId: bot.id,
    projectKey: `project:${project.id}`, taskKey: `project-task:${randomUUID()}`, title } })));
  const git = (...args: string[]) => exec("git", ["-c", `core.hooksPath=${process.execPath}`, "-c", "core.fsmonitor=false", "-C", repo, ...args], { windowsHide: true });
  await git("init"); await git("config", "core.autocrlf", "false"); await git("config", "user.name", "Qualification"); await git("config", "user.email", "qualification@example.invalid");
  await writeFile(path.join(repo, "add.mjs"), "export function add(a,b){throw new Error('not implemented')}\n");
  await writeFile(path.join(repo, "tidy.mjs"), "export function tidy(text){throw new Error('not implemented')}\n");
  await writeFile(path.join(repo, "AGENTS.md"), "Only modify the requested implementation. Do not change tests or commit. The parent qualification process owns the workstation queue; do not nest compilar.ps1.\n");
  for (const [participant, module, assertion] of [["math", "add", "assert.equal(add(2,3),5);assert.equal(add(-4,4),0)"], ["text", "tidy", "assert.equal(tidy('  hello   world  '),'hello world');assert.equal(tidy('a\\n b'),'a b')"]]) {
    await writeFile(path.join(repo, `${module}.test.mjs`), `import test from 'node:test';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {${module}} from './${module}.mjs';\ntest('${participant}',async()=>{${assertion};const started=Date.now();await fetch('http://127.0.0.1:${barrierPort}/ready?participant=${participant}&pid='+process.pid,{signal:AbortSignal.timeout(180000)}).then(r=>{assert.equal(r.status,200)});await writeFile('${participant}.receipt.json',JSON.stringify({pid:process.pid,started,finished:Date.now()}))});\n`);
  }
  await git("add", "."); await git("commit", "-m", "Synthetic qualification baseline");
  await writeFile(path.join(repo, "owner-uncommitted.txt"), "Preserve this original uncommitted file\n");
  const { prepareHostComputer, computerConsentScope } = await import("../apps/desktop/src/host-computer.js");
  const { writeSetup } = await import("../apps/desktop/src/setup-store.js");
  const host = await prepareHostComputer(profile); await host.grant(computerConsentScope(base, { userId: owner })); await host.close();
  await writeSetup(profile, { mode: "existing", serverUrl: base });
  const { ProjectWorkspaces } = await import("../apps/desktop/src/project-workspaces.js");
  const manager = new ProjectWorkspaces(path.join(profile, "project-conversations"));
  const folders = await Promise.all(threads.map(thread => manager.prepare(JSON.stringify([base, owner, spaceId]), project.id, thread.id, async () => repo, async () => {})));
  const { _electron } = await import("@playwright/test");
  electronApp = await _electron.launch({ args: [path.join(root, "apps/desktop")], cwd: path.join(root, "apps/desktop"),
    env: { ...process.env, RAKAZO_PERFORMANCE_USER_DATA: profile, RAKAZO_WEB_URL: base }, timeout: 60000 });
  electronApp.process().once("exit", (code, signal) => { void writeFile(path.join(directory, "desktop-exit.json"), JSON.stringify({ at: Date.now(), code, signal })); });
  let nativeStderr = "";
  electronApp.process().stderr?.on("data", chunk => {
    nativeStderr = (nativeStderr + String(chunk)).slice(-65536);
    void writeFile(path.join(directory, "desktop-stderr.txt"), nativeStderr);
  });
  // Windows has a separate native-chrome page; firstWindow() may be that page.
  await electronApp.firstWindow();
  const windowDeadline = Date.now() + 120000;
  let page = electronApp.windows().find(p => p.url().startsWith(base + "/"));
  while (!page && Date.now() < windowDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    page = electronApp.windows().find(p => p.url().startsWith(base + "/"));
  }
  assert.ok(page, "Missing Desktop chat window");
  await page.addInitScript(() => localStorage.setItem("mycellios.uiLocaleConfirmed", "en"));
  await writeFile(path.join(directory, "window.json"), JSON.stringify({ url: page.url() }));
  await page.waitForURL(url => url.origin === base, { timeout: 120000, waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded", { timeout: 120000 });
  await electronApp.evaluate(async ({ BrowserWindow }, { base, cookie }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(base)); if (!window) throw Error("Missing qualification window");
    for (const pair of cookie.split("; ")) { const separator = pair.indexOf("="); await window.webContents.session.cookies.set({ url: base, name: pair.slice(0, separator), value: pair.slice(separator + 1), httpOnly: true, sameSite: "lax" }); }
  }, { base, cookie });
  // Let the authenticated bootstrap finish its redirects before task navigation.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("Developer lab"), undefined, { timeout: 120000 });
  await writeFile(path.join(directory, "ready.json"), JSON.stringify({ base, apiBase, profile, repo, botId: bot.id, threads: threads.map(t => t.id), folders, model }));
  console.log(`Desktop qualification ready: ${directory}`);
  stage("desktop-ready");
  const prompts = [
    "Implement add(a,b) in add.mjs so add.test.mjs passes. Do not change any test or other implementation file. Run node --test add.test.mjs and wait for its exit; the test waits for a second parallel task, which is intentional. The qualification parent already owns the workstation queue: do not nest compilar.ps1. Do not commit. Report the actual test result.",
    "Implement tidy(text) in tidy.mjs to trim leading/trailing whitespace and collapse internal whitespace into one space so tidy.test.mjs passes. Do not change any test or other implementation file. Run node --test tidy.test.mjs and wait for its exit; it synchronizes with the other task. The qualification parent already owns the workstation queue: do not nest compilar.ps1. Do not commit. Report the actual test result.",
  ];
  for (let index = 0; index < threads.length; index++) {
    stage(`prepare-task-${index}`);
    await page.goto(`${base}/app/${bot.id}?task=${threads[index]!.id}`, { waitUntil: "commit" });
    await page.waitForFunction(() => Boolean((window as any).rakazoDesktop?.computer), undefined, { timeout: 120000 });
    await page.waitForFunction(() => document.body.innerText.includes("Developer lab"), undefined, { timeout: 120000 });
    await page.evaluate(async ({ botId, threadId }) => {
      const desktop = (window as any).rakazoDesktop;
      if (!(await desktop.computer.requestAccess())) throw Error("Native qualification consent unavailable");
      await desktop.computer.connect(botId);
      await desktop.computer.prepareTask({ botId, taskThreadId: threadId });
    }, { botId: bot.id, threadId: threads[index]!.id });
    stage(`prepared-task-${index}`);
  }
  // Exercise concurrent native shells before spending model calls.
  await Promise.all(threads.map(async (thread, index) => {
    stage(`start-shell-${index}`);
    const events = [];
    for await (const event of app!.sandbox.execute({ id: "preflight", botId: bot.id, kind: "desktop", providerRef: "preflight" },
      { commandId: randomUUID(), executionId: `parallel-probe-${index}`, argv: ["pwsh.exe", "-NoProfile", "-NonInteractive", "-Command", `Write-Output 'parallel-${index}-start'; Start-Sleep -Seconds 50; Write-Output 'parallel-${index}-end'`], timeoutMs: 65000 },
      { ...scope, botId: bot.id, projectSessionId: thread.id, runId: `parallel-probe-${randomUUID()}`, operationId: randomUUID(), traceId: "parallel-probe", signal: AbortSignal.timeout(80000) })) events.push(event);
    await writeFile(path.join(directory, `parallel-probe-${index}.json`), JSON.stringify(events));
    assert.ok(events.some(e => e.type === "stdout" && e.data.includes(`parallel-${index}-end`)), "Concurrent native shells must complete before model qualification");
    stage(`completed-shell-${index}`);
  }));
  for (let index = 0; index < threads.length; index++) {
    stage(`send-model-${index}`);
    await page.goto(`${base}/app/${bot.id}?task=${threads[index]!.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Developer lab"), undefined, { timeout: 120000 });
    await page.evaluate(async ({ botId, threadId, prompt, spaceId }) => {
      const response = await fetch('/rpc/threads/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rakazo-space-id': spaceId },
        body: JSON.stringify({ json: { botId, taskThreadId: threadId, text: prompt, clientNonce: crypto.randomUUID() } }) });
      if (!response.ok) throw Error(`Desktop send refused: ${response.status} ${await response.text()}`);
    }, { botId: bot.id, threadId: threads[index]!.id, prompt: prompts[index]!, spaceId });
  }
  const started = Date.now();
  let runs: any[] = [];
  while (Date.now() - started < 8 * 60_000) {
    runs = await prisma.run.findMany({ where: { botId: bot.id, threadId: { in: threads.map(t => t.id) }, trigger: "user" }, orderBy: { createdAt: "asc" } });
    await writeFile(path.join(directory, "live-status.json"), JSON.stringify({ at: Date.now(), arrivals, runs: runs.map(r => ({ id: r.id, threadId: r.threadId, status: r.status, error: r.error, startedAt: r.startedAt, completedAt: r.completedAt })) }));
    await writeFile(path.join(directory, "messages.json"), JSON.stringify(await prisma.message.findMany({ where: { threadId: { in: threads.map(t => t.id) } }, select: { threadId: true, role: true, blocks: true }, orderBy: { createdAt: "asc" } })));
    await writeFile(path.join(directory, "events.json"), JSON.stringify(await prisma.event.findMany({ where: { threadId: { in: threads.map(t => t.id) } }, select: { threadId: true, type: true, payload: true }, orderBy: { createdAt: "asc" } })));
    if (runs.length === 2 && runs.every(r => ["completed", "failed", "cancelled", "waiting_input", "waiting_approval"].includes(r.status))) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.equal(runs.length, 2, "Both Desktop conversations must have their own real run");
  const runStatus = runs.map(r => ({ id: r.id, threadId: r.threadId, status: r.status, error: r.error, startedAt: r.startedAt, completedAt: r.completedAt }));
  await writeFile(path.join(directory, "run-status.json"), JSON.stringify(runStatus, null, 2));
  assert.ok(runs.every(r => r.status === "completed"), `Model runs did not complete: ${JSON.stringify(runStatus)}`);
  assert.equal(arrivals.length, 2); assert.notEqual(arrivals[0]!.pid, arrivals[1]!.pid); assert.ok(barrierReleasedAt);
  const receipts = await Promise.all(folders.map((folder, index) => readFile(path.join(folder!, index === 0 ? "math.receipt.json" : "text.receipt.json"), "utf8").then(JSON.parse)));
  assert.ok(receipts.every(r => r.started <= barrierReleasedAt! && r.finished >= barrierReleasedAt!));
  assert.match(await readFile(path.join(folders[0]!, "tidy.mjs"), "utf8"), /not implemented/);
  assert.match(await readFile(path.join(folders[1]!, "add.mjs"), "utf8"), /not implemented/);
  for (const folder of folders) for (const file of ["add.test.mjs", "tidy.test.mjs"])
    assert.equal(createHash("sha256").update(await readFile(path.join(folder!, file))).digest("hex"), createHash("sha256").update(await readFile(path.join(repo, file))).digest("hex"));
  assert.match(await readFile(path.join(repo, "add.mjs"), "utf8"), /not implemented/);
  assert.match(await readFile(path.join(repo, "tidy.mjs"), "utf8"), /not implemented/);
  assert.equal(await readFile(path.join(repo, "owner-uncommitted.txt"), "utf8"), "Preserve this original uncommitted file\n");
  const usage = await prisma.usageRecord.findMany({ where: { runId: { in: runs.map(r => r.id) } },
    select: { runId: true, provider: true, model: true, inputTokens: true, outputTokens: true, totalTokens: true, costUsd: true, costSource: true } });
  for (const run of runs) assert.ok(usage.some(u => u.runId === run.id && (u.outputTokens ?? 0) > 0), "Each conversation must have observed real model usage");
  await page.screenshot({ path: path.join(directory, "desktop.png") });
  const result = { passed: true, model, productionAccess: false, modelsCalled: true, permissionSetup: "isolated preauthorized fixture profile; consent UI not automated",
    databaseEncoding: "UTF8", unicodeStorageRoundTrip: true, usage,
    sourceRepositoryPreserved: true, testsUnmodified: true, realTestProcessesOverlapped: true, arrivals, barrierReleasedAt, receipts, runs: runStatus, folders };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ passed: true, model, receipt: path.join(directory, "result.json") }));
} catch (error) {
  if (electronApp) {
    const pages = electronApp.windows();
    await writeFile(path.join(directory, "windows.json"), JSON.stringify(pages.map(p => p.url()))).catch(() => {});
    await pages.at(-1)?.screenshot({ path: path.join(directory, "failure.png"), timeout: 10000 }).catch(() => {});
  }
  await writeFile(path.join(directory, "failure.txt"), error instanceof Error ? error.message : String(error));
  console.error(`Desktop qualification failed; diagnostic: ${path.join(directory, "failure.txt")}`); process.exitCode = 1;
} finally {
  if (diagnosticTimer) clearInterval(diagnosticTimer);
  await diagnostic?.end().catch(() => {});
  if (app && owner) { const { asSystem } = await import("@rakazo/db"); await asSystem(app.prisma, "remove qualification model credential").secret.deleteMany({ where: { userId: owner } }).catch(() => {}); }
  await electronApp?.close().catch(() => {}); await web?.close();
  for (const response of waiting) response.end("qualification ended");
  barrier.close(); http?.closeAllConnections(); http?.close(); await app?.stop(); await pg.stop();
}
