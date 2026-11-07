import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];
const states = [
  { name: "active", live: true, reply: "Still finding a free slot…" },
  { name: "complete", live: false, reply: "Tuesday afternoon is free." },
];

test("chat shows mid-turn progress without Working…", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(`/e2e/fixtures/chat-progress-messages.html?live=${state.live ? 1 : 0}`);
      const bubbles = page.getByTestId("message-bot-bubble");
      await expect(bubbles).toHaveCount(2);
      await expect(bubbles.nth(0)).toHaveText("Checking your calendars…");
      await expect(bubbles.nth(1)).toHaveText(state.reply);
      // The mid-turn update is a normal message you can reply to.
      const progress = page.locator('[data-message-id="bot-progress"]');
      await expect(viewport.width < 768
        ? progress.getByRole("button", { name: "Message actions" })
        : progress.getByTestId("message-hover-actions")).toHaveCount(1);
      await expect(page.locator(".rk-chat-markdown-streaming")).toHaveCount(state.live ? 1 : 0);
      await expect(page.getByTestId("tool-activity")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.getByText("Working…")).toHaveCount(0);
      await expect(page.getByText("Done")).toHaveCount(0);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
      await captureScreenshot(page, testInfo, `${state.name}-${viewport.name}`);
    }
  }
});

test("a long mobile chat follows the latest reply without moving history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/fixtures/chat-progress-messages.html?motion");
  const chat = page.getByTestId("transcript");
  const distance = () => chat.evaluate(el => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop));
  await expect(page.getByText("History message 120", { exact: true })).toBeInViewport();
  await expect.poll(distance).toBe(0);
  await page.setViewportSize({ width: 390, height: 510 });
  await expect.poll(distance).toBe(0);
  await page.getByRole("button", { name: "Append reply" }).click();
  await expect(page.getByText("New reply", { exact: true })).toBeInViewport();
  await expect.poll(distance).toBe(0);

  const jump = page.getByRole("button", { name: "Jump to latest" });
  await chat.evaluate(el => { el.scrollTop = 900; });
  await expect(jump).toBeVisible();
  await page.getByRole("button", { name: "Append reply" }).click();
  await expect(page.getByText("New reply", { exact: true })).toHaveCount(2);
  expect(await chat.evaluate(el => el.scrollTop)).toBe(900);

  await jump.click();
  await expect.poll(distance).toBe(0);
});
