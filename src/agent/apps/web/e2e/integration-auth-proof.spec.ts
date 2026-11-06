import { expect, test } from "@playwright/test";

test("temporary readiness failure offers Retry and never starts authorization", async ({
  page,
}) => {
  const attempts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/connections/begin")) attempts.push(request.url());
  });
  await page.goto("/?unavailable=1");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("TikTok");
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeEnabled();
  expect(attempts).toEqual([]);
});

test("existing accounts remain manageable when another connection is Coming soon", async ({
  page,
}) => {
  await page.goto("/?accounts=1&setup=1");
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Twitter");
  await page.getByRole("button", { name: "Agregado", exact: true }).click();
  await expect(page.getByRole("button", { name: "Coming soon", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Desconectar todo", exact: true })).toBeEnabled();
  await expect(page.getByTestId("connection-accounts")).toContainText("@forest_fixture");
});

test("unconfigured integrations show Coming soon without starting authorization", async ({
  page,
}, testInfo) => {
  const attempts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/connections/begin")) attempts.push(request.url());
  });
  await page.goto("/");
  for (const name of ["Google Contacts", "TikTok"]) {
    await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill(name);
    await expect(page.getByRole("button", { name: "Coming soon", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toHaveCount(0);
  }
  expect(attempts).toEqual([]);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => {
        const bounds = await page.getByTestId("marketplace-workspace").boundingBox();
        return Boolean(bounds && bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      })
      .toBe(true);
    await expect(page.getByRole("button", { name: "Coming soon", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await testInfo.attach(`integration-coming-soon-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await page.getByRole("textbox", { name: "Buscar apps", exact: true }).fill("Gmail");
  await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeEnabled();
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
        const bounds = await page.getByTestId("marketplace-workspace").boundingBox();
        return Boolean(bounds && bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      })
      .toBe(true);
    const geometry = await page.getByTestId("marketplace-workspace").boundingBox();
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
  await expect(page.getByTestId("marketplace-workspace")).not.toContainText("private-request");
  await expect(page.getByTestId("marketplace-workspace")).not.toContainText("ToolRouter");
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
  await expect(page.getByTestId("marketplace-workspace")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
        const bounds = await page.getByTestId("marketplace-workspace").boundingBox();
        return Boolean(bounds && bounds.x >= 15 && bounds.x + bounds.width <= width - 15);
      })
      .toBe(true);
    const geometry = await page.getByTestId("marketplace-workspace").boundingBox();
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
