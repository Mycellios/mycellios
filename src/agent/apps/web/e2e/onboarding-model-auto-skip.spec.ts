import { expect, test } from "@playwright/test";
import { MICO_PRIMARY_AVATAR, productBrand } from "@rakazo/contracts";
import { captureScreenshot, rpc, signup } from "./helpers";

test("onboarding skips model connect when a default model is already available", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { json: { ...body.json, needsModel: false } },
    });
  });

  await page.route("**/rpc/integrationSetup/get", (route) =>
    route.fulfill({
      json: {
        json: {
          canConfigure: false,
          needsSetup: false,
          webUrl: "https://example.test/integrations/setup",
          providers: [],
        },
      },
    }),
  );

  const stamp = Date.now();
  await signup(
    page,
    `model-auto-skip-${stamp}@rakazo.test`,
    "password12",
    `Model auto skip ${stamp}`,
  );

  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
  const setup = page.getByTestId("first-mico-setup");
  await expect(setup.getByRole("heading", { name: "Create your first Mico" })).toBeVisible();
  expect(await rpc(page, "bots/list", {})).toEqual([]);
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeHidden();
  await expect(setup.getByRole("textbox", { name: "Name" })).toHaveValue(productBrand.companionName);
  await expect(setup.locator('[data-mascot="mushroom"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveCount(0);
  await setup.getByRole("textbox", { name: "Name" }).fill("Scout");
  await setup.getByRole("textbox", { name: "What should this Mico help with?" }).fill("Plan trips.");
  for (const name of ["Composio", "Pipedream", "Executor"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeHidden();
  }

  const createRequest = page.waitForRequest("**/rpc/bots/create");
  await setup.getByRole("button", { name: "Create Mico", exact: true }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    json: {
      name: "Scout",
      description: "Plan trips.",
      instructions: "Plan trips.",
      color: MICO_PRIMARY_AVATAR,
      spawnKey: "onboarding:first",
    },
  });
  await expect(page.getByRole("combobox", { name: "Message Scout" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Message Scout" })).toBeVisible();
  expect(await rpc(page, "bots/list", {})).toHaveLength(1);
  await captureScreenshot(page, testInfo, "onboarding-model-auto-skip");
});
