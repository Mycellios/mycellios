import { expect, test } from "@playwright/test";
import type { Bot, ModelRoleSettings } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

test("models are searched and selected directly in the Mico header", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `model-picker-${stamp}@rakazo.test`, "password12", `Model picker ${stamp}`);
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const original = await rpc<ModelRoleSettings>(page, "models/role", { role: "main" });
  await rpc(page, "models/connect", {
    provider: "openrouter",
    apiKey: "fake-picker-api-key",
    makeDefault: false,
  });

  await openUserSettings(page, "models");
  await expect(page.getByTestId("model-providers")).toBeVisible();
  await expect(page.getByTestId("model-role-main")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search providers" })).toBeVisible();
  await page.goto(`/app/${botId}`);

  const header = page.getByTestId("chat-header-model").getByRole("button", { name: "Model", exact: true });
  await header.click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("group", { name: /OpenRouter/ }).first()).toBeVisible();
  await search.fill("claude");
  const options = page.locator('[data-slot="command-list"]').getByRole("option");
  await expect(options.first()).toBeVisible();
  expect((await options.allTextContents()).every((text) => /claude/i.test(text))).toBe(true);
  await captureScreenshot(page, testInfo, "mico-model-picker-filtered");
  await search.press("Enter");
  await expect(search).toBeHidden();
  await expect.poll(async () =>
    (await rpc<Bot[]>(page, "bots/list", {})).find((bot) => bot.id === botId)?.modelProvider,
  ).toBe("openrouter");
  expect(await rpc<ModelRoleSettings>(page, "models/role", { role: "main" })).toEqual(original);

  await header.click();
  await search.fill("no-model-matches-this");
  await expect(page.getByText("No matching models")).toBeVisible();
  await expect(options).toHaveCount(0);
});
