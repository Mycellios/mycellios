import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const destination = "https://docs.example.test/guide?from=chat";

test("opening a bot reply link goes directly to a new tab", async ({ page }, testInfo) => {
  await page
    .context()
    .route("https://docs.example.test/**", (route) =>
      route.fulfill({ body: "Docs", contentType: "text/plain" }),
    );
  const stamp = Date.now();
  await signup(page, `external-link-${stamp}@rakazo.test`, "password12", "External Link");
  await completeOnboarding(page);

  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(`Read the [guide](${destination})`);
  await composer.press("Enter");

  const link = page.getByTestId("message-bot-bubble").last().getByRole("link", { name: "guide" });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noreferrer noopener");
  await captureScreenshot(page, testInfo, "external-link-direct");

  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(destination);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\//);
});
