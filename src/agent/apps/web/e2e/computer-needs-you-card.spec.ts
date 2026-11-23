import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  rpc,
  signup,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mycellios.uiLocale", "en");
    localStorage.setItem("mycellios.uiLocaleConfirmed", "en");
  });
});

test("needs-you computer card opens a group member bot computer", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `needs-you-group-${stamp}@mycellios.test`, "password12", "Needs You Group");
  await completeOnboarding(page);
  const chiefId = activeBotId(page);
  const writerId = await createNamedBot(page, "Writer");
  const group = await rpc<{ id: string }>(page, "groups/create", {
    name: "Needs you team",
    botIds: [chiefId, writerId],
  });

  await mockGroupComputerCard(page, group.id, writerId);
  await mockMemberComputerRpcs(page, writerId);

  await page.goto(`/app/g/${group.id}`);
  await expect(page.getByRole("combobox", { name: /Message Needs you team/ })).toBeVisible();

  const card = page.getByTestId("computer-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Computer", { exact: true })).toBeVisible();
  await expect(card.getByText("Needs you", { exact: true })).toBeVisible();
  const open = card.getByTestId("computer-card-open");
  await expect(open).toBeVisible();
  await expect(open).toHaveText("Open");
  await captureScreenshot(page, testInfo, "computer-needs-you-card-group");

  await open.click();
  await expect(page).toHaveURL(new RegExp(`/app/g/${group.id}`));
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByTestId("computer-viewport")).toBeVisible();
  await expectSidebarEdgeClickReachesComputer(page);
  await captureScreenshot(page, testInfo, "computer-needs-you-card-group-open");
});

test("Open focuses the waiting Mico’s browser tab and takes control in one click", async ({ page }, testInfo) => {
  await signup(page, `tab-handoff-${Date.now()}@mycellios.test`, "password12", "Browser handoff");
  await completeOnboarding(page);
  const chiefId = activeBotId(page);
  const botId = await createNamedBot(page, "Writer");
  const group = await rpc<{ id: string }>(page, "groups/create", {
    name: "Browser handoff team",
    botIds: [chiefId, botId],
  });
  const runId = "run-browser-handoff";
  await mockGroupComputerCard(page, group.id, botId, runId);
  await mockMemberComputerRpcs(page, botId, runId);
  await page.route("**/novnc/session/control/**", async route => {
    const tab = new URL(route.request().url()).pathname.endsWith("/tab.html");
    await route.fulfill({ contentType: "text/html", body: tab ? "<p>Waiting browser tab</p>" : "<p>Whole desktop</p>" });
  });
  const requests: string[] = [];
  page.on("request", request => {
    const method = new URL(request.url()).pathname.split("/").at(-1);
    if (method && ["focusBrowserTab", "boot", "takeover", "tabViewUrl", "screenUrl"].includes(method)) requests.push(method);
  });

  await page.goto(`/app/g/${group.id}`);
  await page.getByTestId("computer-card-open").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I’m done" })).toBeVisible();
  const frame = page.frameLocator("[data-testid=computer-viewport] iframe");
  await expect(frame.getByText("Waiting browser tab")).toBeVisible();
  // Only the tab is shown: no boot and no desktop screen for the handoff.
  await expect.poll(() => requests.slice(0, 3)).toEqual(["focusBrowserTab", "takeover", "tabViewUrl"]);
  expect(requests).not.toContain("boot");
  expect(requests).not.toContain("screenUrl");
  // Later refreshes keep the same stream instead of restarting it.
  expect(requests.filter(method => method === "tabViewUrl")).toHaveLength(1);
  await captureScreenshot(page, testInfo, "browser-handoff-direct");

  await page.getByTestId("computer-show-desktop").click();
  await expect(frame.getByText("Whole desktop")).toBeVisible();
  await expect(page.getByTestId("computer-show-desktop")).toHaveCount(0);
});

// The expanded bots sidebar's resize edge sits at x = 308-316px; the computer covers it.
async function expectSidebarEdgeClickReachesComputer(page: Page) {
  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).not.toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("bots-sidebar-edge")).toHaveCount(0);
  const point = { x: 312, y: Math.round((page.viewportSize()?.height ?? 720) / 2) };
  const hitsComputer = await page.evaluate(
    ({ x, y }) =>
      Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="computer-viewport"]')),
    point,
  );
  expect(hitsComputer).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("computer-viewport")).toBeVisible();
  await expect(sidebar).not.toHaveAttribute("data-collapsed", "true");
}

async function mockGroupComputerCard(page: Page, groupId: string, botId: string, runId?: string) {
  await page.route("**/rpc/threads/get", async (route) => {
    const post = route.request().postData() ?? "";
    if (!post.includes(groupId)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const parsed = (await response.json()) as {
      json?: { threadId: string; cursor: number; messages?: Array<{ id?: string }> };
    };
    const snap = parsed.json;
    if (!snap) {
      await route.fulfill({ response });
      return;
    }
    const messages = snap.messages ?? [];
    if (messages.some((message) => message.id === "msg-needs-you-computer")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ json: snap }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          ...snap,
          messages: [
            ...messages,
            {
              id: "msg-needs-you-computer",
              threadId: snap.threadId,
              ...(runId ? { runId } : {}),
              seq: Math.max(snap.cursor, 0) + 1,
              role: "bot",
              botId,
              blocks: [{ kind: "computer", state: "Needs you", text: "Sign in to continue." }],
              createdAt: new Date().toISOString(),
            },
          ],
        },
      }),
    });
  });
}

async function mockMemberComputerRpcs(page: Page, botId: string, runId?: string) {
  const status = {
    botId,
    mode: "team",
    kind: runId ? "docker" : "fake",
    state: "running",
    controlHolder: "user",
    controlBotId: botId,
    takeoverRequested: true,
    screenAvailable: true,
    screenWidth: 1024,
    screenHeight: 768,
    homeRevision: null,
    busyBotName: null,
    canUpdate: false,
  };
  const computerJson = JSON.stringify({ json: status });
  const fulfillForBot = async (route: Route, body: string) => {
    expect(route.request().postDataJSON()).toMatchObject({ json: { botId } });
    await route.fulfill({ contentType: "application/json", body });
  };
  await page.route("**/rpc/computer/boot", async (route) => {
    await fulfillForBot(route, computerJson);
  });
  await page.route("**/rpc/computer/status", async (route) => {
    await fulfillForBot(route, computerJson);
  });
  if (runId) await page.route("**/rpc/computer/focusBrowserTab", async route => {
    expect(route.request().postDataJSON()).toEqual({ json: { botId, runId } });
    await route.fulfill({ json: { json: { state: "focused" } } });
  });
  await page.route("**/rpc/computer/takeover", async (route) => {
    if (runId) expect(route.request().postDataJSON()).toEqual({ json: { botId, runId } });
    await fulfillForBot(
      route,
      JSON.stringify({
        json: {
          leaseId: "lease-needs-you",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
    );
  });
  if (runId) await page.route("**/rpc/computer/tabViewUrl", async route => {
    expect(route.request().postDataJSON()).toEqual({ json: { botId, runId } });
    await route.fulfill({ json: { json: { url: "/novnc/session/control/1.browser-handoff/tab.html" } } });
  });
  await page.route("**/rpc/computer/screenUrl", async (route) => {
    await fulfillForBot(route, JSON.stringify({ json: { url: runId ? "/novnc/session/control/1.browser-handoff/vnc.html" : null } }));
  });
  await page.route("**/rpc/computer/heartbeat", async (route) => {
    await fulfillForBot(route, JSON.stringify({ json: { ok: true } }));
  });
}
