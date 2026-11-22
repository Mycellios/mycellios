import { expect, test } from "@playwright/test";
import type { ThreadMessage } from "@mycellios/contracts";
import { activeBotId, completeOnboarding, rpc, signup } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mycellios.uiLocale", "en");
    localStorage.setItem("mycellios.uiLocaleConfirmed", "en");
  });
});

test.afterEach(async ({ page }) => {
  // A successful cache assertion can finish before the delayed refresh returns.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("conversation tabs render a slow first history read and reopen from cache", async ({ page }) => {
  await signup(page, `tab-history-${Date.now()}@example.test`, "password12", "Tab history");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const title = "Campaign draft";
  const { threadId } = await rpc<{ threadId: string }>(page, "development/open", {
    botId,
    projectKey: `mico:${botId}`,
    taskKey: `mico-task:${botId}:history-test`,
    title,
  });
  const transcript = page.getByTestId("transcript");
  await page.reload();
  await expect(transcript).toBeVisible();

  const text = "Saved message from the campaign tab";
  const message: ThreadMessage = {
    id: "fixture-campaign-message",
    threadId,
    seq: 0,
    role: "user",
    blocks: [{ kind: "text", text }],
    createdAt: new Date().toISOString(),
  };
  let historyReads = 0;
  let bootstrapReads = 0;
  await page.route("**/rpc/bootstrap", route => {
    bootstrapReads += 1;
    return route.continue();
  });
  await page.route("**/rpc/threads/get", async route => {
    if (route.request().postDataJSON()?.json?.taskThreadId !== threadId) return route.continue();
    historyReads += 1;
    const response = await route.fetch();
    const payload = await response.json();
    // The original deadline aborted this otherwise successful history read.
    await new Promise(resolve => setTimeout(resolve, 2_500));
    await route.fulfill({ response, json: { ...payload, json: { ...payload.json, messages: [message] } } });
  });

  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("status", { name: "Loading…" })).toBeVisible();
  await expect(page.getByText("What shall we work on?")).toHaveCount(0);
  await expect.poll(() => historyReads).toBe(1);
  // Reconnects can refresh after the first snapshot. Check for early retries
  // while the deliberately slow first response is still in flight.
  await page.waitForTimeout(2_100);
  expect(historyReads).toBe(1);
  await expect(transcript.getByText(text)).toBeVisible();

  await page.getByRole("button", { name: "Main chat", exact: true }).click();
  await expect(transcript.getByText(text)).toHaveCount(0);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(transcript.getByText(text)).toBeVisible({ timeout: 1_500 });
  expect(bootstrapReads).toBe(0);
});

test("Answer opens the exact task and uses its preloaded question", async ({ page }) => {
  await signup(page, `task-answer-${Date.now()}@example.test`, "password12", "Task answer");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const { threadId } = await rpc<{ threadId: string }>(page, "development/open", {
    botId,
    projectKey: `mico:${botId}`,
    taskKey: `mico-task:${botId}:answer-test`,
    title: "Waiting for a city",
  });
  const text = "Which city should I use?";
  const createdAt = new Date().toISOString();
  const run = { id: "fixture-waiting-run", botId, threadId, status: "waiting_input", trigger: "user", createdAt };
  const message: ThreadMessage = {
    id: "fixture-pending-question",
    threadId,
    botId,
    runId: run.id,
    seq: 0,
    role: "bot",
    blocks: [{ kind: "ask", text, status: "pending" }],
    createdAt,
  };
  let historyReads = 0;
  let aroundReads = 0;
  await page.route("**/rpc/threads/messages", route => {
    if (route.request().postDataJSON()?.json?.around) aroundReads += 1;
    return route.continue();
  });
  await page.route("**/rpc/threads/get", async route => {
    if (route.request().postDataJSON()?.json?.taskThreadId !== threadId) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    if (historyReads > 0) await new Promise(resolve => setTimeout(resolve, 2_500));
    await route.fulfill({ response, json: { ...payload, json: { ...payload.json, run, activeRuns: [run], messages: [message] } } });
    historyReads += 1;
  });
  await page.route("**/rpc/spaces/list", async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const bots = payload.json.current.bots.map((bot: { id: string }) => bot.id === botId
      ? { ...bot, status: "waiting_input", waitingTaskThreadId: threadId } : bot);
    await route.fulfill({ response, json: { ...payload, json: {
      ...payload.json, current: { ...payload.json.current, bots },
    } } });
  });
  const answer = page.locator(`[data-needs-you="answer"][data-needs-you-bot="${botId}"]`);
  await expect(answer).toBeVisible();
  await expect.poll(() => historyReads).toBe(1);
  await answer.click();
  await expect(page).toHaveURL(new RegExp(`[?&]task=${threadId}(?:&|$)`));
  await expect(page.getByTestId("transcript").getByText(text, { exact: true })).toBeVisible({ timeout: 1_500 });
  expect(aroundReads).toBe(0);
});
