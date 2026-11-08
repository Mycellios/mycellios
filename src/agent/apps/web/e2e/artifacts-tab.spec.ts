import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("opens the Library from the account menu and rail, and previews an existing file", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `artifacts-tab-${stamp}@rakazo.test`, "password12", "Artifacts Tab");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  const chiefId = activeBotId(page);

  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).toBeVisible();
  const rail = page.getByTestId("workspace-rail");
  await expect(rail.getByRole("button", { name: "Connect apps" })).toBeVisible();
  await page.getByTestId("user-menu-trigger").click();
  const artifactsItem = page.getByRole("dialog").getByRole("button", { name: "Library", exact: true });
  const settingsItem = page.getByRole("button", { name: "Settings", exact: true });
  await expect(artifactsItem).toBeVisible();
  await expect(settingsItem).toBeVisible();
  expect((await artifactsItem.boundingBox())?.y).toBeLessThan(
    (await settingsItem.boundingBox())?.y ?? 0,
  );
  await captureScreenshot(page, testInfo, "account-menu-artifacts");

  await artifactsItem.click();
  await expect(page).toHaveURL(/[?&]view=library/);
  await expect(rail.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(page.getByText("No files yet")).toBeVisible();
  await captureScreenshot(page, testInfo, "artifacts-empty");

  await page.setViewportSize({ width: 360, height: 700 });
  const narrowHeading = page.getByRole("heading", { name: "Library", exact: true });
  const narrowCardView = page.getByRole("button", { name: "Card view" });
  await expect(narrowHeading).toBeVisible();
  await expect(narrowCardView).toBeVisible();
  const headingBox = await narrowHeading.boundingBox();
  const cardViewBox = await narrowCardView.boundingBox();
  expect(headingBox?.width).toBeGreaterThan(40);
  expect(headingBox?.x).toBeGreaterThanOrEqual(0);
  expect((headingBox?.x ?? 0) + (headingBox?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(cardViewBox?.x).toBeGreaterThanOrEqual(0);
  expect((cardViewBox?.x ?? 0) + (cardViewBox?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 720 });

  const file = await rpc<{ id: string }>(page, "artifacts/create", {
    botId: chiefId,
    name: "notes/artifacts-tab.md",
    mimeType: "text/markdown",
    contentBase64: Buffer.from("# Artifacts tab").toString("base64"),
  });
  await rpc(page, "artifacts/create", {
    botId: chiefId,
    name: "library-thumbnail.png",
    mimeType: "image/png",
    contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOwmZgDAAJGATqiNjldAAAAAElFTkSuQmCC",
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByText("notes/artifacts-tab.md")).toBeVisible();
  const thumbnail = page.getByRole("link", { name: /library-thumbnail.png/ }).locator("img").first();
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 1);
  await page.getByRole("searchbox", { name: "Search the library" }).fill("missing");
  await expect(page.getByText("No files match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "List view" }).click();
  await captureScreenshot(page, testInfo, "artifacts-list");

  await page.getByRole("link", { name: /notes\/artifacts-tab\.md/ }).click();
  await expect(page).toHaveURL(/[?&]file=[^&]+/);
  await expect(page.getByRole("heading", { name: "notes/artifacts-tab.md" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifacts tab" })).toBeVisible();
  await captureScreenshot(page, testInfo, "artifacts-preview");

  await rail.getByRole("button", { name: "Micos" }).click();
  await expect(page).toHaveURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  await expect(page.getByTestId("transcript")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTestId("bots-sidebar").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "library-mobile");

  await page.goto(`/app/artifacts/${file.id}`);
  await expect(page.getByRole("heading", { name: "notes/artifacts-tab.md" })).toBeVisible();
});
