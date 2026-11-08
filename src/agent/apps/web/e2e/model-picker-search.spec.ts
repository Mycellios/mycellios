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
  await page.getByRole("group", { name: "Providers", exact: true }).getByRole("button", { name: "OpenRouter", exact: true }).click();
  await expect(page.getByRole("button", { name: "OpenRouter", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Explore catalog" }).click();
  await page.getByRole("textbox", { name: "Search catalog" }).fill("claude");
  const catalogModels = page.getByRole("group", { name: "Model catalog" }).getByRole("button", { name: /claude/i });
  await expect(catalogModels.first()).toBeVisible();
  await captureScreenshot(page, testInfo, "mico-model-picker-filtered");
  await catalogModels.first().click();
  await page.getByRole("button", { name: "Use model", exact: true }).click();
  const options = page.locator('[data-slot="command-list"]').getByRole("option");
  await expect(search).toBeHidden();
  await expect.poll(async () =>
    (await rpc<Bot[]>(page, "bots/list", {})).find((bot) => bot.id === botId)?.modelProvider,
  ).toBe("openrouter");
  expect(await rpc<ModelRoleSettings>(page, "models/role", { role: "main" })).toEqual(original);

  await header.click();
  await search.fill("no-model-matches-this");
  await expect(page.getByText("No matching models")).toBeVisible();
  await expect(options).toHaveCount(0);

  await page.getByRole("button", { name: "Change general model" }).click();
  await page.getByRole("group", { name: "Providers", exact: true }).getByRole("button", { name: "OpenRouter", exact: true }).click();
  await search.fill("claude");
  await expect(options.first()).toBeVisible();
  await search.press("Enter");
  await expect(search).toBeHidden();
  expect((await rpc<ModelRoleSettings>(page, "models/role", { role: "main" })).primary?.provider).toBe("openrouter");
  const bot = (await rpc<Bot[]>(page, "bots/list", {})).find((entry) => entry.id === botId);
  expect(bot?.modelProvider).toBe("openrouter");
});
