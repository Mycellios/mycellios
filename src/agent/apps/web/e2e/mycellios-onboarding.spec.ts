import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { productBrand } from "@rakazo/contracts";
import { signupThroughForm } from "./helpers";

// Opt in against the isolated development stack, with real auth and persistence.
// Model keys, traces and request bodies never become test attachments.
test.use({ video: "off", trace: "off" });
test.skip(process.env.AGENT_CONNECTED_E2E !== "1", "Requires the isolated connected stack.");

for (const width of [1280, 390]) {
  test(`Mycellios is ready for an account key at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await signupThroughForm(
      page,
      `${randomUUID()}@example.test`,
      `${randomUUID()}-Aa1!`,
      "Preview user",
    );
    await page.waitForURL("**/onboarding");
    await expect(page.getByRole("combobox", { name: "Provider", exact: true })).toHaveText(
      productBrand.shortName,
    );
    // Password inputs intentionally have no implicit textbox role.
    await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
    await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("required", "");
    await expect(page.getByLabel("OpenAI-compatible server URL", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Find models", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("mycellios-first-connection.png"),
      fullPage: true,
    });
    // Switching to a generic endpoint is explicit and clears the typed credential.
    await page.getByLabel("API key", { exact: true }).fill("example-account-key");
    await page.getByRole("combobox", { name: "Provider", exact: true }).click();
    await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
    await expect(page.getByLabel("OpenAI-compatible server URL", { exact: true })).toHaveValue("");
    await page.getByRole("combobox", { name: "Provider", exact: true }).click();
    await page.getByRole("option", { name: productBrand.shortName, exact: true }).click();
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  });
}

test("discovers real Mycellios models using the entered account credential", async ({ page }) => {
  const keyPath = process.env.AGENT_E2E_API_KEY_FILE;
  test.skip(!keyPath, "A private development account key is required.");
  await signupThroughForm(
    page,
    `${randomUUID()}@example.test`,
    `${randomUUID()}-Aa1!`,
    "Connected preview user",
  );
  await page.waitForURL("**/onboarding");
  await page.getByLabel("API key", { exact: true }).fill(readFileSync(keyPath!, "utf8").trim());
  await page.getByRole("button", { name: "Find models", exact: true }).click();
  const models = page.getByRole("combobox", { name: "Models from server", exact: true });
  await expect(models).toBeVisible();
  await expect(models).not.toHaveText("");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});
