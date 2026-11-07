import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("mobile browser has its own screen and keeps tabs and the conversation draft", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 844 });
  await page.route("https://preview.example.test/**", route =>
    route.fulfill({ contentType: "text/html", body: "<h1>Vista del proyecto</h1>" }));
  await page.goto("/e2e/fixtures/project-browser.html");
  const draft = page.getByRole("textbox", { name: "Borrador del chat" });
  await draft.fill("Borrador conservado");
  await page.getByRole("button", { name: "Abrir navegador" }).click();
  const browser = page.getByRole("region", { name: "Panel de vistas previas" });
  const address = browser.getByRole("textbox", { name: "URL de la página" });
  await address.fill("https://preview.example.test/first");
  await browser.getByRole("button", { name: "Abrir página" }).click();
  await expect(browser.locator("iframe")).toHaveAttribute("src", /\/first$/);
  await expect(browser.frameLocator("iframe").getByRole("heading", { name: "Vista del proyecto" })).toBeVisible();
  await expect(address).toBeHidden();
  expect((await browser.boundingBox())?.width).toBe(430);
  const help = browser.getByRole("button", { name: "Ayuda del navegador" });
  await help.click();
  await expect(browser.getByText("Toca el teclado", { exact: false })).toBeVisible();
  await help.click();
  const controls = browser.getByRole("navigation", { name: "Controles del navegador" });
  await controls.getByRole("button", { name: "URL de la página" }).click();
  await expect(address).toBeFocused();
  await address.fill("https://preview.example.test/second");
  await address.press("Enter");
  await controls.getByRole("button", { name: "Atrás" }).click();
  await expect(browser.locator("iframe")).toHaveAttribute("src", /\/first$/);
  await controls.getByRole("button", { name: "Adelante" }).click();
  await expect(browser.locator("iframe")).toHaveAttribute("src", /\/second$/);
  await captureScreenshot(page, testInfo, "mobile-project-browser");

  await browser.getByRole("button", { name: "Volver al chat" }).click();
  await expect(browser).toBeHidden();
  await expect(draft).toHaveValue("Borrador conservado");
  await page.getByRole("button", { name: "Abrir navegador" }).click();
  await controls.getByRole("button", { name: "Vistas abiertas" }).click();
  await expect(browser.getByRole("tab", { name: "preview.example.test", selected: true })).toBeVisible();
});

test("mobile browser offers an external link when the app cannot embed a page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/e2e/fixtures/project-browser.html", async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": "frame-src 'none'" },
    });
  });
  await page.goto("/e2e/fixtures/project-browser.html");
  await page.getByRole("button", { name: "Abrir navegador" }).click();
  await page.getByRole("textbox", { name: "URL de la página" }).fill("https://preview.example.test/");
  await page.getByRole("button", { name: "Abrir página" }).click();
  await expect(page.getByRole("link", { name: "Abrir en el navegador" })).toHaveAttribute("href", "https://preview.example.test/");
});
