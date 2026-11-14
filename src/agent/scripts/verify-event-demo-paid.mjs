// Explicit manual production qualification only. Never imported by ordinary tests.
import assert from "node:assert/strict";
import { createCipheriv, createPublicKey, publicEncrypt, randomBytes, constants } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";

const limit = 200000;
const resume = process.env.MYCELLIOS_DEMO_RESUME === "true";
const savedState = process.env.MYCELLIOS_DEMO_BROWSER_STATE;
assert.ok(!resume || savedState, "Resume requires the same encrypted-recovered guest session");
assert.ok(resume || !savedState, "An existing guest cannot accidentally enter the fresh-guest path");
assert.equal(process.env.MYCELLIOS_DEMO_PAID_CONFIRM, "ONE_GUEST_UP_TO_0_20");
assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1", "Paid sends cannot be replayed by rerunning a job");
const deadline = Number(process.env.MYCELLIOS_DEMO_PAID_DEADLINE);
assert.ok(Number.isSafeInteger(deadline) && deadline > Date.now() && deadline - Date.now() <= 15 * 60_000);
const publicKey = createPublicKey(Buffer.from(process.env.MYCELLIOS_DEMO_STATE_PUBLIC_KEY ?? "", "base64").toString());
assert.ok((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048);
const output = path.resolve("event-paid-proof"); await mkdir(output, { recursive: true });
const origin = "https://www.mycellios.com", event = "encuentro-57b9aaa2a4ce";
const result = { authorizedMicrounits: limit, startedAt: new Date().toISOString(), model: "DeepSeek V4 Flash", replies: [], diagnostic: [] };
let browser, context, page;
async function save() {
  // A failed paid request can be investigated using the same guest. CI never
  // receives the private recovery key and no cookie/token appears in logs.
  if (context) {
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify(await context.storageState())), cipher.final()]);
    const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
    await writeFile(path.join(output, "browser-state.encrypted.json"), JSON.stringify({ wrapped: wrapped.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), payload: payload.toString("base64") }));
  }
  await writeFile(path.join(output, "qualification.json"), JSON.stringify(result, null, 2));
}
async function wallet() {
  const response = await context.request.get(origin + "/mobile/v1/demo/" + event + "/session");
  assert.equal(response.status(), 200); return response.json();
}
try {
  browser = await chromium.launch(); context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    ...(resume ? {storageState: JSON.parse(savedState)} : {}) });
  await context.addInitScript(() => { localStorage.setItem("rakazo.uiLocale", "en"); localStorage.setItem("mycellios.uiLocaleConfirmed", "en"); });
  page = await context.newPage();
  page.on("response", response => { const url = new URL(response.url()); if (url.origin === origin && response.status() >= 400) result.diagnostic.push({ path: url.pathname, status: response.status() }); });
  await page.goto(origin + "/agent/demo/" + event, { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page).toHaveURL(/\/agent\/app\/[^/]+$/, { timeout: 60000 });
  await expect(page.getByRole("combobox", { name: "Message Mico", exact: true })).toBeVisible({ timeout: 60000 });
  const before = await wallet();
  if (resume) {
    assert.equal(before.guest.number, 4, "Only the original canary guest can continue its 0.20 Credit budget");
    assert.ok(before.creditsMicrounits > 0 && before.creditsMicrounits + before.reservedMicrounits <= limit);
  } else { assert.equal(before.creditsMicrounits, limit); assert.equal(before.reservedMicrounits, 0); }
  const priorReserved = before.reservedMicrounits;
  result.guest = before.guest; result.initialWallet = before; result.botUrl = page.url(); await save();
  const botButton = name => page.locator("button[data-roster-bot-id]").filter({ has: page.getByText(name, { exact: true }) });
  const names = ["Mico", "El CEO", "Administrativo", "Contable", "Programador", "Ciberseguridad", "El Inventor", "El Asistente", "El de Marketing", "Ventas"];
  for (const name of names) await expect(botButton(name)).toBeVisible();
  result.company = names; await page.screenshot({ path: path.join(output, "company-before.png") });
  for (const [index, name] of (resume ? ["El CEO", "El Inventor", "El de Marketing"] : ["Mico", "El CEO", "El Inventor"]).entries()) {
    assert.ok(Date.now() < deadline, "Paid authorization window ended");
    const balance = await wallet(); assert.equal(balance.reservedMicrounits, priorReserved, "Stop if a new purchase is unresolved; do not replay the original failed Mico message");
    assert.equal(balance.earnedMicrounits, 0); assert.ok(balance.creditsMicrounits > 0 && balance.creditsMicrounits <= limit);
    if (index || resume) await botButton(name).click();
    const composer = page.getByRole("combobox", { name: "Message " + name, exact: true }); await expect(composer).toBeVisible();
    await expect(page.getByRole("button", { name: "Model", exact: true })).toContainText("DeepSeek V4 Flash");
    const marker = ["Demo Mycellios lista: 2 + 2 = 4.", "Demo CEO lista: prioridades claras.", "Demo Inventor lista: ideas en marcha."][index]
      + " Prueba " + process.env.GITHUB_RUN_ID + ".";
    const attempt = { bot: name, status: "started", beforeMicrounits: balance.creditsMicrounits, startedAt: new Date().toISOString() };
    result.replies.push(attempt); await save(); const started = performance.now();
    await composer.fill("Prueba de la demo: responde exactamente «" + marker + "». No uses herramientas, no busques en internet ni hagas preguntas.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 120000 });
    attempt.replyElapsedMs = Math.round(performance.now() - started);
    // Streaming content may precede the signed supplier invoice. Verify final
    // settlement independently rather than mistaking an in-flight hold for cost.
    await expect.poll(async () => (await wallet()).reservedMicrounits, {timeout: 45000}).toBe(priorReserved);
    const after = await wallet(); assert.equal(after.reservedMicrounits, priorReserved); assert.ok(after.creditsMicrounits <= balance.creditsMicrounits);
    assert.ok(limit - after.creditsMicrounits <= limit);
    Object.assign(attempt, { status: "completed", response: marker, afterMicrounits: after.creditsMicrounits,
      chargedMicrounits: balance.creditsMicrounits - after.creditsMicrounits, elapsedMs: Math.round(performance.now() - started) });
    await save(); await page.screenshot({ path: path.join(output, "reply-" + index + ".png") });
  }
  result.finalWallet = await wallet(); result.spentMicrounits = limit - result.finalWallet.creditsMicrounits; result.ok = true;
} catch (error) {
  result.ok = false; result.error = String(error);
  if (page) { result.pageText = (await page.locator("body").innerText()).slice(-20000); await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {}); }
  result.finalWallet = await wallet().catch(() => null); process.exitCode = 1;
} finally {
  await save(); await browser?.close(); console.log(JSON.stringify(result));
}
