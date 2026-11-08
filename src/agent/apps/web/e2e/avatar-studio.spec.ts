import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("bot settings save the avatar shape and palette across reloads", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@rakazo.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings).toBeVisible();

  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(studio.getByText("Avatar Studio", { exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Mico", exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Upload", exact: true })).toBeVisible();
  await expect(studio.getByTestId("avatar-studio-bot-tab")).toBeVisible();
  await expect(studio.getByRole("button", { name: "Flat", exact: true })).toHaveAttribute("aria-pressed", "true");

  const hare = studio.getByRole("button", { name: "Hare", exact: true });
  const mint = studio.getByRole("button", { name: "Mint", exact: true });
  await expect(hare).toHaveAttribute("aria-pressed", "false");
  await hare.click();
  await expect(hare).toHaveAttribute("aria-pressed", "true");

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/bots/update") &&
      response.request().postData()?.includes("#67B793::shape_2832") === true &&
      response.ok(),
  );
  await mint.click();
  await saved;
  await expect(mint).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await page.getByTestId("bot-settings-trigger").click();
  await settings.getByTestId("avatar-studio-trigger").click();
  await expect(hare).toHaveAttribute("aria-pressed", "true");
  await expect(mint).toHaveAttribute("aria-pressed", "true");

  await captureScreenshot(page, testInfo, "avatar-studio-saved");
});
