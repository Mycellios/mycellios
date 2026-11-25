import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test.use({
  geolocation: { latitude: 40.416775, longitude: -3.70379, accuracy: 20 },
  permissions: ["geolocation"],
});

test("shares the position once and keeps it out of the chat", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `location-card-${stamp}@mycellios.test`, "password12", "Location Card");
  await completeOnboarding(page);

  const botId = activeBotId(page);
  await page.getByPlaceholder(/Message/).fill("find restaurants near me");
  await page.keyboard.press("Enter");

  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? null;
      },
      { timeout: 60_000 },
    )
    .toBe("waiting_input");

  // threads/get can observe waiting_input before the shell realtime feed paints the ask card.
  const card = page.getByTestId("location-ask-card");
  if ((await card.count()) === 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/Message/)).toBeVisible({ timeout: 15_000 });
  }
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Where should I look for restaurants?")).toBeVisible();
  await expect(card.getByLabel("Place")).toBeVisible();
  await expect(card.getByRole("button", { name: "Don't share" })).toBeVisible();
  await captureScreenshot(page, testInfo, "location-card");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByRole("button", { name: "Share location" })).toBeVisible();
  await captureScreenshot(page, testInfo, "location-card-narrow");
  await page.setViewportSize({ width: 1280, height: 720 });

  const answers: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/threads/answer")) answers.push(request.postData() ?? "");
  });
  await card.getByRole("button", { name: "Share location" }).click();
  await expect(card.getByText("Location shared", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Rounded on the device before it is sent.
  expect(answers.join("")).toContain("40.417");
  expect(answers.join("")).not.toContain("40.4167");

  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? "completed";
      },
      { timeout: 60_000 },
    )
    .toBe("completed");
  await expect(page.getByText("thanks. i have the place for this request.")).toBeVisible({
    timeout: 15_000,
  });
  const history = await rpc<unknown>(page, "threads/messages", { botId });
  expect(JSON.stringify(history)).not.toContain("40.417");
  expect(JSON.stringify(history)).toContain('"outcome":"shared"');
  await captureScreenshot(page, testInfo, "location-card-shared");
});
