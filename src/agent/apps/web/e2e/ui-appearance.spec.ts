import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openIntegrations,
  openMobileFooter,
  rpc,
  signup,
} from "./helpers";

async function captureSidebarSearchSelected(
  page: Page,
  testInfo: Parameters<typeof captureScreenshot>[1],
  name: string,
) {
  const aside = page.locator("aside").first();
  const search = aside.getByTestId("sidebar-search");
  const selected = aside.getByRole("button", { name: /^Chief/ }).first();
  await expect(search).toBeVisible();
  await expect(selected).toBeVisible();
  await search.scrollIntoViewIfNeeded();

  const searchBox = await search.boundingBox();
  const selectedBox = await selected.boundingBox();
  expect(searchBox).toBeTruthy();
  expect(selectedBox).toBeTruthy();
  if (searchBox && selectedBox) {
    expect(Math.abs(searchBox.x - selectedBox.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(searchBox.x + searchBox.width - (selectedBox.x + selectedBox.width)),
    ).toBeLessThanOrEqual(1);
  }

  const box = await aside.boundingBox();
  if (box) {
    const screenshotPath = testInfo.outputPath(`${name}.png`);
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      path: screenshotPath,
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width + 24, 360),
        height: Math.min(Math.max(box.height * 0.45, 280), 420),
      },
    });
    await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
    return;
  }
  await captureScreenshot(page, testInfo, name);
}

test("account settings appearance control switches to light mode", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-appearance-${stamp}@mycellios.test`, "password12", "Appearance QA");
  await completeOnboarding(page, testInfo);

  await page.getByTestId("workspace-rail").getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();

  const picker = settings.getByTestId("ui-appearance-select");
  await expect(picker).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-appearance-control");

  await settings.getByTestId("ui-appearance-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await captureScreenshot(page, testInfo, "ui-appearance-dark-settings");

  await settings.getByTestId("ui-appearance-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(settings.getByTestId("ui-appearance-light")).toHaveAttribute("aria-pressed", "true");
  await captureScreenshot(page, testInfo, "ui-appearance-light-settings");

  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await captureScreenshot(page, testInfo, "ui-appearance-light-shell");
  await captureSidebarSearchSelected(page, testInfo, "sidebar-search-selected-light");

  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill("Please review `shared/PROJECT_CHECKPOINT_WRAPUP.md`.");
  await composer.press("Enter");
  const assistantReply = page
    .getByTestId("transcript")
    .locator("[data-message-id]")
    .filter({ hasText: "done. i handled:" });
  const inlinePath = assistantReply
    .locator("code")
    .filter({ hasText: "shared/PROJECT_CHECKPOINT_WRAPUP.md" });
  await expect(inlinePath).toBeVisible({ timeout: 30_000 });
  await expect(inlinePath).toHaveCSS("color", "rgb(28, 28, 28)");
  await captureScreenshot(page, testInfo, "inline-code-light");

  await page.getByTestId("workspace-rail").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByTestId("ui-appearance-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await captureSidebarSearchSelected(page, testInfo, "sidebar-search-selected-dark");
});

test("workspace rail footer follows the reference app and reaches integrations from Hifa Store", async ({
  page,
}, testInfo) => {
  await signup(page, `footer-web-${Date.now()}@mycellios.test`, "password12", "Footer Demo");
  await completeOnboarding(page);
  const rail = page.getByTestId("workspace-rail");
  await expect(rail).toBeVisible();
  // Desktop has no account footer: no avatar menu, no Connect apps pill, in the rail or the chat sidebar.
  await expect(page.getByTestId("sidebar-footer")).toHaveCount(0);
  await expect(page.getByTestId("user-menu-trigger")).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "Connect apps", exact: true })).toHaveCount(0);
  const chatSidebar = page.getByTestId("bots-sidebar");
  await expect(chatSidebar.getByTestId("mycellios-micos")).toBeVisible();
  const store = rail.getByRole("button", { name: "Hifa Store", exact: true });
  const help = rail.getByRole("button", { name: "Help", exact: true });
  const settings = rail.getByRole("button", { name: "Settings", exact: true });
  const labels = await rail
    .locator("button[aria-label]")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  expect(labels.indexOf("Hifa Store")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("Hifa Store")).toBeLessThan(labels.indexOf("Help"));
  expect(labels.indexOf("Help")).toBeLessThan(labels.indexOf("Settings"));
  // Server connections sit below Settings at the very bottom of the rail.
  const servers = rail
    .getByTestId("desktop-server-menu")
    .or(rail.getByRole("button", { name: "Servers", exact: true }))
    .first();
  const [storeBox, helpBox, settingsBox, serversBox] = await Promise.all(
    [store, help, settings, servers].map((control) => control.boundingBox()),
  );
  expect(storeBox!.y).toBeLessThan(helpBox!.y);
  expect(helpBox!.y).toBeLessThan(settingsBox!.y);
  expect(settingsBox!.y).toBeLessThan(serversBox!.y);
  await captureScreenshot(page, testInfo, "workspace-rail-footer");

  await help.click();
  await expect(page.getByTestId("help-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help-menu")).toHaveCount(0);

  await openIntegrations(page);
  await page.getByRole("button", { name: "Back to chat", exact: true }).click();
  await expect(page.getByTestId("marketplace-workspace")).toHaveCount(0);

  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(chatSidebar).toHaveCSS("width", "72px");
  await expect(settings).toBeInViewport();
  await expect(page.getByTestId("user-menu-trigger")).toHaveCount(0);
  await page.getByTestId("restore-bots-sidebar").click();
  await expect(settings).toBeInViewport();
});

test("mobile navigation footer keeps the account identity readable and a ready desktop update installs", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = {
      phase: "ready",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      percent: 100,
      message: null,
      checkedAt: null,
    };
    Object.defineProperty(window, "mycelliosDesktop", {
      value: {
        platform: "darwin",
        window: {
          close: async () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
        },
        oauth: { onCallback: () => () => {} },
        update: {
          state: async () => state,
          check: async () => state,
          download: async () => state,
          install: async () => {
            document.documentElement.dataset.updateInstalled = String(
              Number(document.documentElement.dataset.updateInstalled ?? 0) + 1,
            );
            return state;
          },
        },
      },
    });
  });
  const email = `footer-${Date.now()}@mycellios.test`;
  await signup(page, email, "password12", "Footer Demo");
  await completeOnboarding(page);
  await page.request.post("/api/auth/update-user", { data: { name: "Footer Demo" } });
  await page.reload();
  const session = await (await page.request.get("/api/auth/get-session")).json();
  // Desktop installs the ready update from the chat sidebar; the rail has no account footer.
  await expect(page.getByTestId("workspace-rail").getByTestId("sidebar-footer")).toHaveCount(0);
  const sidebarUpdate = page
    .getByTestId("bots-sidebar")
    .getByRole("button", { name: "Install update", exact: true });
  await expect(sidebarUpdate).toBeVisible();
  await sidebarUpdate.click();
  await expect(page.locator("html")).toHaveAttribute("data-update-installed", "1");

  await page.setViewportSize({ width: 320, height: 900 });
  const footer = await openMobileFooter(page);
  const avatar = footer.getByTestId("user-menu-trigger");
  await expect(avatar).toHaveAccessibleName(`Account menu for ${session.user.name}`);
  await expect(avatar).toBeInViewport();
  // The phone footer has no update button; updates stay in the navigation's update slot.
  await expect(footer.getByRole("button", { name: "Install update", exact: true })).toHaveCount(0);
  await avatar.click();
  const header = page.getByTestId("account-menu-header");
  await expect(header).toHaveText(`${session.user.name}${email}`);
  await captureScreenshot(page, testInfo, "mobile-footer-account-menu");
  await page.keyboard.press("Escape");
  await expect(header).toBeHidden();
  await openMobileFooter(page);

  // Font metrics can change the count at this viewport; exact bands are covered below.
  await expect(footer.locator('span[aria-hidden="true"] > span:visible').first()).toBeVisible();
  const pill = footer.getByRole("button", { name: "Connect apps", exact: true });
  const label = pill.locator("span").first();
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const boxes = await Promise.all([avatar, pill].map((control) => control.boundingBox()));
  expect(boxes.every((box) => box?.height === 36 && box.y === boxes[0]?.y)).toBe(true);
  expect(await footer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await avatar.click();
  await avatar.click();
  expect(await avatar.evaluate((el) => el.matches(":focus-visible"))).toBe(false);
  await pill.focus();
  expect(await pill.evaluate((el) => el.matches(":focus-visible"))).toBe(false);
  await page.keyboard.press("Tab");
  await pill.focus();
  expect(await pill.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await pill.evaluate((el) => el.blur());

  // Width changes must drop marks before taking space from the label or padding.
  // Measure the fixed controls and label, then target the middle of each band.
  // Marks need 26px initially and 22px per additional mark, leaving 11px margin.
  const fixedWidth = await pill.evaluate((el) => {
    const style = getComputedStyle(el);
    return (
      el.parentElement!.getBoundingClientRect().width -
      el.clientWidth +
      Number.parseFloat(style.paddingLeft) +
      Number.parseFloat(style.paddingRight) +
      el.querySelector("span")!.scrollWidth +
      Number.parseFloat(style.columnGap)
    );
  });
  for (const [availableWidth, count] of [
    [17, 0],
    [37, 1],
    [59, 2],
    [81, 3],
  ]) {
    const width = fixedWidth + availableWidth!;
    await footer.evaluate((el, width) => {
      el.style.width = `${width}px`;
    }, width);
    const marks = footer.locator('span[aria-hidden="true"] > span');
    await expect(marks).toHaveCount(count!);
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (count) {
      const rightInset = await pill.evaluate((el) => {
        const marks = el.querySelector('span[aria-hidden="true"]')!;
        return el.getBoundingClientRect().right - marks.getBoundingClientRect().right;
      });
      expect(rightInset).toBeGreaterThanOrEqual(11);
    }
  }
  await footer.evaluate((el) => el.style.removeProperty("width"));
  // A translation wider than the pill must still truncate inside the footer.
  await label.evaluate((el) => {
    el.textContent = "Connecter des applications";
  });
  await expect(footer.locator('span[aria-hidden="true"] > span')).toHaveCount(0);
  const translatedPill = footer.getByRole("button", {
    name: "Connecter des applications",
    exact: true,
  });
  const translatedLabel = translatedPill.locator("span").first();
  expect(await translatedLabel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(translatedLabel).toHaveCSS("text-overflow", "ellipsis");
  const labelBox = await translatedLabel.boundingBox();
  const pillBox = await translatedPill.boundingBox();
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(pillBox!.x + pillBox!.width - 11);
  expect(await footer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 740, height: 320 });
  await (await openMobileFooter(page)).getByTestId("user-menu-trigger").click();
  const menu = page.locator('[data-slot="popover-content"]').filter({ has: header });
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      return box && box.y >= 0 && box.y + box.height <= 320;
    })
    .toBe(true);
  await expect(header).toBeInViewport();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  const logOut = menu.getByRole("button", { name: "Log out", exact: true });
  await logOut.scrollIntoViewIfNeeded();
  await expect(logOut).toBeInViewport();
  expect((await logOut.boundingBox())!.height).toBe(36);
  await captureScreenshot(page, testInfo, "sidebar-footer-short-screen");
  await menu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("user-settings")).toBeVisible();
});

test("mobile footer app marks follow the integrations overlay", async ({ page }) => {
  await signup(page, `footer-apps-${Date.now()}@mycellios.test`, "password12", "Footer Demo");
  await completeOnboarding(page);
  let connected = true;
  let listed = true;
  let failCatalog = false;
  let failConnections = false;
  const logo =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Ctext x='5' y='15'%3ES%3C/text%3E%3C/svg%3E";
  await page.route("**/rpc/connections/list", async (route) => {
    if (failConnections) {
      await route.fulfill({ status: 503, json: { message: "Demo connections unavailable" } });
      return;
    }
    await route.continue();
  });
  await page.route("**/rpc/connections/catalog", async (route) => {
    if (failCatalog) {
      await route.fulfill({ status: 503, json: { message: "Demo catalog unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        json:
          listed && !failConnections
            ? [
                {
                  connectorId: "demo",
                  slug: "slack",
                  name: "Slack",
                  logo,
                  connected,
                  noAuth: false,
                },
              ]
            : [],
      },
    });
  });
  // App marks only appear in the phone navigation footer; desktop actions stay in the rail.
  const desktop = { width: 1280, height: 720 };
  const phone = { width: 390, height: 844 };
  const expectFooterMark = async (src: string | null) => {
    await page.setViewportSize(phone);
    const marks = (await openMobileFooter(page)).locator("img");
    if (src) await expect(marks).toHaveAttribute("src", src);
    else await expect(marks).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Returning to desktop closes the phone navigation.
    await page.setViewportSize(desktop);
  };
  const backToChat = async () => {
    await page.getByRole("button", { name: "Back to chat", exact: true }).click();
    await expect(page.getByTestId("marketplace-workspace")).toHaveCount(0);
  };
  await page.setViewportSize(phone);
  await (await openMobileFooter(page)).getByRole("button", { name: "Connect apps", exact: true }).click();
  await expect(page.getByTestId("marketplace-workspace")).toBeVisible();
  await page.setViewportSize(desktop);
  await backToChat();
  await expectFooterMark(logo);
  failCatalog = true;
  await openIntegrations(page);
  await expect(page.getByText("Could not reach the server", { exact: true })).toBeVisible();
  await backToChat();
  await expectFooterMark(logo);
  failCatalog = false;
  connected = false;
  await openIntegrations(page);
  await backToChat();
  // Disconnected catalog entries remain available as suggestions.
  await expectFooterMark(logo);
  failCatalog = true;
  const failedRefresh = page.waitForResponse(
    (response) => response.url().includes("connections/catalog") && response.status() === 503,
  );
  await page
    .getByRole("button", { name: /^Chief/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Chief copy/ }).first()).toBeVisible();
  await failedRefresh;
  await expectFooterMark(logo);
  failCatalog = false;
  failConnections = true;
  const failedConnections = page.waitForResponse(
    (response) => response.url().includes("connections/list") && response.status() === 503,
  );
  await page
    .getByRole("button", { name: /^Chief copy/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Chief copy copy/ }).first()).toBeVisible();
  await failedConnections;
  await expectFooterMark(logo);
  failConnections = false;
  for (const name of [/^Chief copy copy/, /^Chief copy/, /^Chief/]) {
    const bot = page.getByRole("button", { name }).first();
    await bot.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(bot).toBeHidden();
  }
  await page.reload();
  await expectFooterMark(logo);
  listed = false;
  await openIntegrations(page);
  await backToChat();
  await expectFooterMark(null);
});

test("sidebar list fades above the credits foot and keeps the last row reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signup(page, `footer-scroll-${Date.now()}@mycellios.test`, "password12", "Demo User");
  await completeOnboarding(page);
  for (let index = 0; index < 20; index++) {
    await rpc(page, "bots/create", {
      name: `Demo chat ${index}`,
      title: "",
      description: "",
      notifyOnFinish: true,
      computerMode: "team",
    });
  }
  await page.reload();
  const sidebar = page.getByTestId("bots-sidebar");
  // Desktop has no account footer; the chat list ends above the credits block.
  await expect(page.getByTestId("sidebar-footer")).toHaveCount(0);
  const foot = sidebar.getByTestId("mycellios-micos");
  const list = sidebar.locator(".rk-scroll").first();
  const lastRow = list.getByRole("button", { name: /^Demo chat 19/ }).first();
  await expect(lastRow).toHaveCount(1);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("mycellios.uiAppearance", theme), theme);
    await page.reload();
    await expect(lastRow).toHaveCount(1);
    await expect(foot).toBeVisible();
    await list.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
    await expect
      .poll(() =>
        list.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--scroll-fade-b"))),
      )
      .toBeGreaterThan(20);
    const listBox = await list.boundingBox();
    const footBox = await foot.boundingBox();
    expect(listBox!.y + listBox!.height).toBeLessThan(footBox!.y);
    // Disabling animations fast-forwards the scroll timeline and removes its fade.
    const screenshotPath = testInfo.outputPath(`sidebar-list-scrolled-${theme}.png`);
    await page.screenshot({ path: screenshotPath, animations: "allow" });
    await testInfo.attach(`sidebar-list-scrolled-${theme}`, {
      contentType: "image/png",
      path: screenshotPath,
    });
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect
      .poll(() =>
        list.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--scroll-fade-b"))),
      )
      .toBe(0);
    await lastRow.focus();
    await expect(lastRow).toBeFocused();
    await expect(lastRow).toBeInViewport();
    const rowBox = await lastRow.boundingBox();
    expect(rowBox!.y + rowBox!.height).toBeLessThan(footBox!.y);
  }
});
