import { expect, test } from "@playwright/test";

test.use({ video: "off" });

for (const viewport of [
  { width: 1280, height: 850 },
  { width: 390, height: 844 },
]) {
  for (const appearance of ["light", "dark"] as const) {
    test(`Mycellios entry and sign-in at ${viewport.width}px in ${appearance}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(
        (value) => localStorage.setItem("rakazo.uiAppearance", value),
        appearance,
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "A little help. A lot of possibility." }),
      ).toBeVisible();
      await expect(page.getByRole("img", { name: "Mico", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Get started" })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath("mycellios-welcome.png"), fullPage: true });
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Sign in to Mycellios" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
  }
}
