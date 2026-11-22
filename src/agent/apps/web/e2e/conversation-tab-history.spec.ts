import { expect, test } from "@playwright/test";
import { activeBotId, completeOnboarding, rpc, signup } from "./helpers";

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
  const message = {
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
  await expect(transcript.getByText(text)).toBeVisible();
  expect(historyReads).toBe(1);

  await page.getByRole("button", { name: "Main chat", exact: true }).click();
  await expect(transcript.getByText(text)).toHaveCount(0);
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(transcript.getByText(text)).toBeVisible({ timeout: 1_500 });
  expect(bootstrapReads).toBe(0);
});
