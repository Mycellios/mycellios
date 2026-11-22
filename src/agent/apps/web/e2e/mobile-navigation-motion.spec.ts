import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test("mobile navigation retains the roster, dismisses the keyboard and respects reduced motion", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("mycellios.uiLocale", "en");
    localStorage.setItem("mycellios.uiLocaleConfirmed", "en");
  });
  // Account setup is outside this scenario; switch to touch layout after it.
  await page.setViewportSize({ width: 1024, height: 844 });
  await signup(page, `mobile-motion-${Date.now()}@mycellios.test`, "password12", "Mobile navigation");
  await completeOnboarding(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const composer = page.getByRole("combobox", { name: /Message/ });
  await composer.tap();
  await composer.fill("Keep this draft");
  await expect(composer).toBeFocused();
  await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
  await expect(composer).not.toBeFocused();
  const roster = page.getByTestId("bots-sidebar");
  await roster.getByRole("button", { name: "Workspace navigation", exact: true }).tap();
  const drawer = page.getByRole("dialog", { name: "Mycellios", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
  await expect.poll(async () => (await roster.boundingBox())?.x ?? 0).toBeGreaterThan(300);
  const bounds = await drawer.boundingBox();
  expect(bounds!.width).toBeLessThan(350);
  await captureScreenshot(page, testInfo, "mobile-workspace-navigation");
  // The visible strip dismisses the sheet, retaining the list and the draft.
  await page.touchscreen.tap(375, 400);
  await expect(drawer).not.toBeVisible();
  await roster.getByRole("button", { name: "Close navigation", exact: true }).tap();
  await expect(composer).toHaveValue("Keep this draft");
  await expect(composer).not.toBeFocused();
  await composer.evaluate(element => (element as HTMLElement).focus());
  await expect(composer).not.toBeFocused();
  await composer.tap();
  await expect(composer).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open navigation", exact: true }).tap();
  await roster.getByRole("button", { name: "Workspace navigation", exact: true }).tap();
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});
