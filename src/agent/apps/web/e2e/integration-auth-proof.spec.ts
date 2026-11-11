import { expect, test } from "@playwright/test";

test("Cadencia opens without Desktop, analyzes synthetic media and exports before/after", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:") && /^https?:/.test(request.url()))
      external.push(request.url());
  });
  await page.goto("/?cadencia=1");
  await expect(page.getByRole("heading", { name: "Hifa Store", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abrir Cadencia", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Cadencia/ })).toBeVisible();
  await testInfo.attach("cadencia-empty", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Probar con la demo", exact: true }).click();
  await expect(page.getByText("Demo sintetizada", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // Native codec availability changes tiny gaps (AAC here, Opus on Linux CI).
  // Identify the sustained-vowel proposal by meaning, never its ordinal number.
  const vowel = page.locator(".cd-cut").filter({ hasText: "Posible vocal alargada" });
  await expect(vowel).toHaveCount(1);
  await expect(vowel.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("button", { name: "Crear versión editada", exact: true }).click();
  const download = page.getByRole("link", { name: /Descargar (MP4|WebM|M4A)/ });
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.locator("video").evaluate(
    video => Number.isFinite(video.duration) && video.duration < 10,
  )).toBe(true);
  await testInfo.attach("cadencia-desktop", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await testInfo.attach("cadencia-mobile", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const downloading = page.waitForEvent("download");
  await download.click();
  expect((await downloading).suggestedFilename()).toMatch(/^cadencia-.*\.(mp4|webm|m4a)$/);
  expect(external).toEqual([]);
});

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
    await expect
      .poll(async () => {
        const bounds = await page.getByRole("dialog").boundingBox();
        return Boolean(bounds && bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      })
      .toBe(true);
    const geometry = await page.getByRole("dialog").boundingBox();
    expect(geometry?.x).toBeGreaterThanOrEqual(15);
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(width - 15);
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

test("integration authorization opens an external target and completes without a popup handle", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const calls: Array<{ url: string; target: string | undefined; features: string | undefined }> =
      [];
    Object.defineProperty(window, "__integrationOpenCalls", { value: calls });
    window.open = (url, target, features) => {
      calls.push({ url: String(url), target, features });
      return null;
    };
  });
  await page.goto("/?external=1");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Twitter");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Agregado", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__integrationOpenCalls"))).toEqual([
    {
      url: "https://connect.composio.dev/link/fixture-not-a-real-connection",
      target: "_blank",
      features: "noopener,noreferrer",
    },
  ]);
  await testInfo.attach("external-integration-connected", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("account details identify each account and separate pending authorizations", async ({
  page,
}, testInfo) => {
  await page.goto("/?accounts=1");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Twitter");
  await page.getByRole("button", { name: "Agregado", exact: true }).click();
  const accounts = page.getByTestId("connection-accounts");
  await expect(accounts).toContainText("@forest_fixture");
  await expect(accounts).toContainText("@mycelium_team");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius)),
  ).toBeGreaterThan(8);
  await expect(accounts).not.toContainText("Autorización pendiente");
  await expect(page.getByTestId("pending-connections")).toContainText("1 conexión pendiente");
  await expect(page.getByRole("button", { name: "Desconectar todo", exact: true })).toBeVisible();
  await page
    .getByRole("group", { name: "@forest_fixture", exact: true })
    .getByRole("button", { name: "Cambiar nombre", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Etiqueta de cuenta", exact: true }).fill("Personal");
  await page.getByRole("textbox", { name: "Etiqueta de cuenta", exact: true }).press("Enter");
  await expect(page.getByRole("group", { name: "@forest_fixture", exact: true })).toContainText(
    "Personal",
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(accounts).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await page.getByRole("dialog").boundingBox();
        return Boolean(bounds && bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      })
      .toBe(true);
    const geometry = await page.getByRole("dialog").boundingBox();
    expect(geometry?.height).toBeLessThan(650);
    expect(geometry?.x).toBeGreaterThanOrEqual(15);
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(width - 15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await testInfo.attach(`account-identities-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await page
    .getByRole("group", { name: "@forest_fixture", exact: true })
    .getByRole("button", { name: "Desconectar", exact: true })
    .click();
  await expect(accounts).not.toContainText("@forest_fixture");
  await expect(accounts).toContainText("@mycelium_team");
  await page
    .getByTestId("pending-connections")
    .getByText("1 conexión pendiente", { exact: true })
    .click();
  await page
    .getByRole("group", { name: "Autorización pendiente", exact: true })
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(page.getByTestId("pending-connections")).toBeHidden();
  await expect(accounts).toContainText("@mycelium_team");
});
