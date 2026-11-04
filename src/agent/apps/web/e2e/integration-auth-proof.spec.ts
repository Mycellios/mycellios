import { expect, test } from "@playwright/test";

test("server setup is translated, bounded on small screens, and does not prevent another app connecting", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Twitter");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "Esta integración necesita configuración en el servidor. Contacta con el administrador.",
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(alert).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await testInfo.attach(`integration-setup-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Gmail");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Agregado", exact: true })).toBeVisible();
  await expect(alert).toBeHidden();
});

test("old API provider dumps never reach the screen", async ({ page }, testInfo) => {
  await page.goto("/?legacy=1");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Twitter");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("No se pudo conectar");
  await expect(page.getByRole("dialog")).not.toContainText("private-request");
  await expect(page.getByRole("dialog")).not.toContainText("ToolRouter");
  await testInfo.attach("legacy-integration-error", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
