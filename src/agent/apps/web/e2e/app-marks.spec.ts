import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

// Cached public catalog artwork keeps visual coverage offline and repeatable.
const apps = ["gmail", "github", "notion"];
const catalogApps = ["gmail", "obscure-app", "notion", "github"];
test.use({ deviceScaleFactor: 3 });

for (const theme of ["light", "dark"]) {
  test(`familiar app suggestions are visible in the workspace rail in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("rakazo.uiAppearance", theme), theme);
    for (const app of catalogApps) {
      await page.route(`https://logos.composio.dev/api/${app}`, (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: readFileSync(
            new URL(
              `./fixtures/app-marks/${app === "obscure-app" ? "notion" : app}.svg`,
              import.meta.url,
            ),
          ),
        }),
      );
    }
    await page.route("**/rpc/connections/catalog", (route) =>
      route.fulfill({
        json: {
          json: catalogApps.map((slug) => ({
            connectorId: "composio",
            slug,
            name: slug,
            connected: false,
            noAuth: false,
            logo: `https://logos.composio.dev/api/${slug}`,
          })),
        },
      }),
    );
    await signup(page, `app-marks-${theme}-${Date.now()}@rakazo.test`, "password12", "Demo User");
    await completeOnboarding(page);
    const footer = page.getByTestId("workspace-rail").getByTestId("sidebar-footer");
    const pill = footer.getByRole("button", { name: "Connect apps", exact: true });
    const tiles = pill.locator('span[aria-hidden="true"] > span');
    await expect(tiles).toHaveCount(3);
    const images = tiles.locator("img");
    await expect(images).toHaveCount(apps.length);
    for (const index of apps.keys()) {
      await expect(images.nth(index)).toHaveAttribute(
        "src",
        `https://logos.composio.dev/api/${apps[index]}`,
      );
      await expect
        .poll(() => images.nth(index).evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    for (const hover of [false, true]) {
      if (hover) await pill.hover();
      else await page.mouse.move(1000, 400);
      const boxes = await tiles.evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            background: style.backgroundColor,
          };
        }),
      );
      for (const [index, box] of boxes.entries()) {
        expect(box).toMatchObject({
          width: 21,
          height: 21,
          background: "rgb(255, 255, 255)",
        });
        expect(box.x).toBe(boxes[0]!.x);
        if (index) expect(box.y).toBeGreaterThan(boxes[index - 1]!.y + box.height);
      }
      const path = testInfo.outputPath(`app-marks-${theme}${hover ? "-hover" : ""}.png`);
      await footer.screenshot({ path, animations: "disabled" });
      await testInfo.attach(`app-marks-${theme}${hover ? "-hover" : ""}`, {
        path,
        contentType: "image/png",
      });
    }
  });
}
