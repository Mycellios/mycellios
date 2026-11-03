import { expect, test } from "@playwright/test";

for (const scenario of ["verify", "ready", "error"]) {
  test(`Spanish contribution controls: ${scenario}`, async ({ page }, testInfo) => {
    await page.goto(`/?case=${scenario}`);
    if (scenario === "verify") {
      await page.getByRole("button", { name: "Verificar este equipo", exact: true }).click();
    } else if (scenario === "error") {
      await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Contribuir con este equipo", exact: true })).toBeVisible();
    const actions = page.getByLabel("Fixture actions");
    await expect(actions).not.toContainText(/control:|enroll|grant/);
    if (scenario === "verify") await expect(actions).toContainText("identify");
    await testInfo.attach(`contribution-${scenario}`, { body: await page.screenshot(), contentType: "image/png" });
  });
}
