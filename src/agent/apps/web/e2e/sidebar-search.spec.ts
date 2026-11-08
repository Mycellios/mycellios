import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("desktop sidebar search stays visible and is accessible when collapsed", async ({
  page,
}, testInfo) => {
  await signup(page, `sidebar-search-${Date.now()}@rakazo.test`, "password12", "Search Sample");
  await completeOnboarding(page);
  const sidebar = page.locator("aside").first();
  const trigger = sidebar.getByTestId("sidebar-search-trigger");
  const search = sidebar.getByRole("textbox", { name: "Search", exact: true });
  await expect(search).toBeVisible();
  await expect(trigger).toHaveCount(0);
  const header = await sidebar.getByTestId("sidebar-topbar").boundingBox();
  expect((await search.boundingBox())?.y).toBeGreaterThan(header!.y + header!.height);
  await captureScreenshot(page, testInfo, "sidebar-search-visible");

  // Leaving an empty field keeps the roster still, so a chat click lands.
  const chief = sidebar.getByRole("button", { name: /^Chief/ }).first();
  const before = await chief.boundingBox();
  await chief.click();
  await expect(search).toBeVisible();
  expect((await chief.boundingBox())?.y).toBe(before?.y);

  await search.fill("no roster matches");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(search).toHaveCount(0);
  await trigger.click();
  await expect(search).toBeFocused();
});
