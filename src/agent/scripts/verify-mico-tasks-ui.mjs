import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Only a loopback component fixture, with synthetic RPCs and no account or backend.
process.env.RAKAZO_PROJECT_LOCAL = "1";
process.env.SCREEN_PROXY_SECRET = randomBytes(32).toString("hex");
const root = path.resolve("apps/web");
process.chdir(root);
const output = process.env.MICO_ACCEPTANCE_OUTPUT ? path.resolve(process.env.MICO_ACCEPTANCE_OUTPUT) : await mkdtemp(path.join(tmpdir(), "mycellios-task-ui-"));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [{ name: "private-task-acceptance", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const fixture = req.url === "/__task_acceptance" ? "mico-task-preview" : req.url === "/__surfaces_acceptance" ? "conversation-surfaces-preview" : null;
      if (!fixture) return next();
      const html = await server.transformIndexHtml(req.url, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/fixtures/${fixture}.tsx"></script></body></html>`);
      res.setHeader("content-type", "text/html"); res.end(html);
    });
  } }],
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/__task_acceptance`;
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : existsSync(chromium.executablePath()) ? {} : { channel: "chrome" }) });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const reviewTab = () => page.locator('[data-thread-tab="task-one"] button:not([aria-label])');
  await reviewTab().waitFor({ timeout: 90_000 });
  const picker = () => page.locator('[data-slot="popover-content"]');
  const chevron = () => page.getByRole("button", { name: /^Conversations/ });
  const openPicker = async () => {
    await chevron().click();
    await picker().waitFor();
  };
  const active = () => page.getByTestId("active-task").textContent();
  const tabIds = () => page.locator("[data-thread-tab]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-thread-tab")));
  const storedTabs = () => page.evaluate(() => JSON.parse(localStorage.getItem("mycellios:open-task-tabs:fixture") ?? "{}").ids ?? []);
  const tab = (id) => page.locator(`[data-thread-tab="${id}"]`);
  const menu = () => page.locator('[role="menu"]');
  const openTabMenu = async (id) => { await tab(id).click({ button: "right" }); await menu().waitFor(); };
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  for (const [name, width, height, theme] of [["desktop", 1280, 800, "light"], ["desktop-dark", 1280, 800, "dark"], ["mobile", 390, 844, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await noOverflow();
    assert.equal(await page.locator('button[aria-label="New conversation"]').isVisible(), true);
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
    await openPicker();
    await noOverflow();
    await page.screenshot({ path: path.join(output, `${name}-picker.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await picker().waitFor({ state: "hidden" });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await reviewTab().click();
  assert.equal(await active(), "task-one");
  // The status mark is part of the tab's accessible name.
  assert.equal(await reviewTab().getAttribute("aria-current"), "page");
  assert.match(await page.getByRole("button", { name: /Review API/ }).first().textContent(), /Review API/);

  // Status marks on tabs; the picker keeps New conversation first, open threads by activity with
  // their mark and time, kind labels, and the Archived group last.
  assert.equal(await tab("task-one").locator("[data-thread-status]").getAttribute("data-thread-status"), "working");
  await openPicker();
  const rows = await picker().locator("button:not([aria-label])").allTextContents();
  assert.deepEqual(rows.slice(0, 2), ["New conversation", "Main chat"]);
  assert.ok(rows.some(row => row.startsWith("Daily digestRoutine")) && rows.some(row => row.startsWith("Check supplier pricesDelegated")), rows.join(" | "));
  assert.ok(rows.at(-1).startsWith("Old budget"), rows.join(" | "));
  const marks = await picker().locator("[data-thread-status]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-thread-status")));
  for (const mark of ["working", "unread", "waiting", "failed", "queued"]) assert.ok(marks.includes(mark), `${mark} in ${marks}`);
  assert.ok(await picker().locator("time[data-thread-time]").count() >= 6);
  const archived = picker().getByRole("group", { name: "Archived", exact: true });
  assert.equal(await archived.locator("button:not([aria-label])").count(), 1);
  // Choosing an archived conversation restores it and opens its tab.
  await archived.locator("button:not([aria-label])").first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "task-archived");
  assert.ok((await storedTabs()).includes("task-archived"));

  // Archive closes the tab; the picker then lists the conversation under Archived.
  await openTabMenu("task-two");
  await menu().getByRole("menuitem", { name: "Archive" }).click();
  await tab("task-two").waitFor({ state: "detached" });
  await openPicker();
  assert.ok((await picker().getByRole("group", { name: "Archived" }).textContent()).includes("A task with a deliberately long"));
  await page.keyboard.press("Escape");
  await picker().waitFor({ state: "hidden" });

  // + opens a draft tab; nothing is created until the first message, and the draft survives a reload.
  const before = await storedTabs();
  await page.locator('button[aria-label="New conversation"]').click();
  assert.equal(await active(), "Draft");
  await tab("new-conversation").waitFor();
  const message = page.getByRole("textbox", { name: "Start a new conversation with Existing Mico" });
  await message.fill("Plan the spring trip\nWith hotels and trains");
  await page.screenshot({ path: path.join(output, "draft-tab.png"), animations: "disabled" });
  await page.reload();
  await tab("new-conversation").waitFor();
  await tab("new-conversation").locator("button:not([aria-label])").click();
  assert.equal(await message.inputValue(), "Plan the spring trip\nWith hotels and trains");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent?.startsWith("mico-task:mico-fixture:"));
  const created = await active();
  assert.equal(await tab("new-conversation").count(), 0);
  assert.equal(await tab(created).locator("button:not([aria-label])").textContent(), "Plan the spring trip");
  assert.equal((await storedTabs()).length, before.length + 1);
  await page.screenshot({ path: path.join(output, "created-task.png"), animations: "disabled" });

  // A tab's menu: open, close actions, then rename, archive and delete; delete waits while it works.
  await openTabMenu(created);
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(),
    ["Open", "Close tab", "Close other tabs", "Close tabs to the right", "Rename conversation", "Archive", "Delete"]);
  assert.equal(await menu().getByRole("menuitem", { name: "Delete" }).getAttribute("data-disabled"), "");
  await page.screenshot({ path: path.join(output, "tab-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });

  // Delete hides the tab at once; Undo puts it back in the same place.
  const order = await tabIds();
  await openTabMenu("task-archived");
  await menu().getByRole("menuitem", { name: "Delete" }).click();
  await tab("task-archived").waitFor({ state: "detached" });
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Old budget deleted" });
  await toast.waitFor();
  await page.screenshot({ path: path.join(output, "delete-undo.png"), animations: "disabled" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await tab("task-archived").waitFor();
  assert.deepEqual(await tabIds(), order);

  // A conversation the Mico starts joins the end of the tabs without taking focus.
  const shown = await active();
  await page.getByRole("button", { name: "Mico starts a task", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-thread-tab^="mico-started-"]'));
  assert.equal(await active(), shown);
  const stored = await storedTabs();
  assert.ok(stored.at(-1).startsWith("mico-started-"), stored.join(","));

  // Keyboard: Delete closes a focused tab; Ctrl+Shift+O starts a conversation; Alt+Shift+Up steps back.
  const startedId = stored.at(-1);
  await tab(startedId).locator("button:not([aria-label])").focus();
  await page.keyboard.press("Delete");
  await tab(startedId).waitFor({ state: "detached" });
  await page.keyboard.press("Control+Shift+O");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "Draft");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent !== "Draft");

  // Below 200 px the row becomes a switcher with the current title.
  await page.getByRole("button", { name: "Narrow header", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("nav[data-tabs-layout]")?.getAttribute("data-tabs-layout") === "compact");
  await page.screenshot({ path: path.join(output, "compact.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Narrow header", exact: true }).click();

  // On a phone, Delete asks first and offers no Undo.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // A phone shows one readable tab; the others stay in the picker.
  await chevron().waitFor({ timeout: 60_000 });
  await openPicker();
  await picker().locator("button:not([aria-label])").filter({ hasText: "Old budget" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="active-task"]')?.textContent === "task-archived");
  assert.equal(await page.locator("[data-thread-tab]").count(), 1);
  await openTabMenu("task-archived");
  await menu().getByRole("menuitem", { name: "Delete" }).click();
  await page.getByText("Delete this conversation?", { exact: true }).waitFor();
  await noOverflow();
  await page.screenshot({ path: path.join(output, "mobile-delete-confirm.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await openTabMenu("task-archived");
  await page.screenshot({ path: path.join(output, "mobile-dark-tab-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  // Back to the main chat and on to the Mico's other work surfaces.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPicker();
  await picker().getByRole("button", { name: "Main chat", exact: true }).click();
  assert.equal(await active(), "Main chat");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("combobox", { name: "Simultaneous tasks", exact: true }).selectOption("2");
  assert.equal(await page.getByRole("combobox", { name: "Simultaneous tasks" }).inputValue(), "2");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Cancel task", exact: true }).click();
  await page.getByText("Cancelled", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("textbox", { name: "Workflow name" }).fill("Synthetic workflow");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Run: Start", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("cancelled", { exact: true }).waitFor();
  await noOverflow();
  await page.locator('[data-slot="dialog-content"]').evaluate(root => { for (const node of [root, ...root.querySelectorAll('*')]) if (node instanceof HTMLElement) node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "workflow-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getBoundingClientRect().width > 1000);
  assert.ok((await page.getByRole("dialog").boundingBox()).width > 1000, "desktop workflow editor must use the available width");
  assert.ok((await page.getByLabel("Workflow canvas").boundingBox()).width > 700, "desktop graph must remain visible beside its properties");
  await page.screenshot({ path: path.join(output, "workflow-desktop.png"), animations: "disabled" });

  // Conversation surfaces: the side panel's Conversations pane, a conversation beside the chat,
  // requests mirrored into the main chat, the sidebar's Mico rows, Needs you and Mark all as read.
  await page.goto(`http://127.0.0.1:${address.port}/__surfaces_acceptance`);
  const pane = () => page.getByTestId("conversations-pane");
  await pane().waitFor({ timeout: 90_000 });
  const opened = () => page.getByTestId("opened").textContent();
  const sidebar = () => page.getByTestId("fixture-sidebar");
  for (const [name, width, height, theme] of [["surfaces-desktop", 1440, 900, "light"], ["surfaces-desktop-dark", 1440, 900, "dark"], ["surfaces-mobile", 390, 844, "light"], ["surfaces-mobile-dark", 390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
    await noOverflow();
    await page.getByTestId("mirrored-requests").waitFor();
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled", fullPage: width < 768 });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const paneRows = await pane().locator("[data-conversation-row]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-conversation-row")));
  assert.deepEqual(paneRows, ["plan", "asks", "offers", "invoices", "notes", "budget", "recipes", "travel"]);
  assert.equal(await pane().getByTestId("conversations-waiting").textContent(), "Waiting for you: 1");
  const besideToggle = (id) => pane().locator(`[data-conversation-row="${id}"] button[aria-pressed]`);
  await besideToggle("offers").click();
  await page.locator('[data-side-conversation="offers"]').getByText("Two options look good", { exact: false }).waitFor();
  await pane().getByRole("tab", { name: "Conversations" }).click();
  await besideToggle("notes").click();
  await page.locator('[data-side-conversation="notes"]').waitFor();
  await page.screenshot({ path: path.join(output, "surfaces-split-view.png"), animations: "disabled" });
  // Closing the shown tab shows its neighbour; Open in the chat moves it into the chat.
  await pane().getByRole("button", { name: "Actions for Meeting notes" }).click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await page.locator('[data-side-conversation="offers"]').waitFor();
  await page.locator('[data-side-conversation="offers"]').getByRole("button", { name: "Open in the chat" }).click();
  assert.equal(await opened(), "/app/mico?task=offers");
  await pane().locator('[data-conversation-row="offers"]').waitFor();
  assert.equal(await page.locator("[data-side-conversation]").count(), 0);

  // Open waits: what each wait is for, its request, and Cancel the wait that never claims a woken wait.
  const waitsCard = page.getByTestId("open-waits");
  assert.equal(await waitsCard.locator("[data-open-wait]").count(), 2);
  assert.match(await waitsCard.textContent(), /Waits for the next run of Nightly sales report/);
  assert.equal(await pane().locator('[data-conversation-row="offers"] [data-open-waits]').count(), 1);
  await waitsCard.locator('[data-open-wait="wait-report"]').getByText("Show the request").click();
  await waitsCard.locator('[data-open-wait="wait-report"]').getByText("When the nightly report lands", { exact: false }).waitFor();
  await waitsCard.screenshot({ path: path.join(output, "surfaces-open-waits.png"), animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await waitsCard.screenshot({ path: path.join(output, "surfaces-open-waits-dark.png"), animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await waitsCard.locator('[data-open-wait="wait-report"]').getByRole("button", { name: "Cancel the wait" }).click();
  await waitsCard.locator('[data-open-wait="wait-report"]').waitFor({ state: "detached" });
  await waitsCard.locator('[data-open-wait="wait-deploy"]').getByRole("button", { name: "Cancel the wait" }).click();
  await waitsCard.locator('[data-open-wait="wait-deploy"][data-wait-status="woke"]').waitFor();
  assert.equal(await waitsCard.locator('[data-open-wait="wait-deploy"] [role="alert"]').textContent(),
    "This wait already woke, so it was not cancelled. Its request goes on.");
  assert.equal(await waitsCard.getByRole("button", { name: "Cancel the wait" }).count(), 0);
  await page.screenshot({ path: path.join(output, "surfaces-open-waits-cancelled.png"), animations: "disabled" });

  // A conversation's approval, answered from the main chat through that conversation.
  const mirrored = page.getByTestId("mirrored-requests");
  assert.match(await mirrored.textContent(), /Approval needed in Choose a supplier/);
  await page.screenshot({ path: path.join(output, "surfaces-mirrored-request.png"), animations: "disabled" });
  await mirrored.getByRole("button", { name: "Allow once" }).click();
  await page.locator('[data-mirrored-request="asks"]').waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-mirrored-request="plan"]').count(), 1);
  await page.locator('[data-mirrored-request="plan"]').getByRole("button", { name: "Open conversation" }).click();
  assert.equal(await opened(), "/app/mico?task=plan");

  // Sidebar: the main chat's count, a numberless badge for replies only in conversations, Needs you.
  assert.equal(await sidebar().locator('[data-roster-bot-id="mico"] [data-roster-unread-count]').textContent(), "3");
  assert.equal(await sidebar().locator('[data-roster-bot-id="writer"] [data-roster-conversation-unread]').count(), 1);
  const needs = await sidebar().getByTestId("sidebar-needs-you").locator("[data-needs-you]").evaluateAll(nodes =>
    nodes.map(node => `${node.getAttribute("data-needs-you-bot")}:${node.getAttribute("data-needs-you")}`));
  assert.deepEqual(needs, ["helper:answer"]);
  // A Mico row expands into its conversations: those needing a look, three recent, then Show more.
  await sidebar().locator('[data-roster-expand="mico"]').click();
  const listedInSidebar = () => sidebar().locator("[data-sidebar-conversation]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-sidebar-conversation")));
  await sidebar().getByTestId("sidebar-mico-conversations").waitFor();
  assert.deepEqual(await listedInSidebar(), ["plan", "asks", "offers", "invoices", "notes", "budget", "recipes"]);
  await sidebar().getByRole("button", { name: "Show 1 more" }).click();
  assert.equal((await listedInSidebar()).at(-1), "travel");
  await page.screenshot({ path: path.join(output, "surfaces-sidebar-expanded.png"), animations: "disabled" });
  await sidebar().getByRole("button", { name: "Show less" }).click();
  await sidebar().locator('[data-sidebar-conversation="budget"]').click();
  assert.equal(await opened(), "/app/mico?task=budget");
  // Resting on a Mico opens its card after a pause; it shows loaded conversations and reads nothing.
  await sidebar().locator('[data-roster-bot-id="writer"]').hover();
  await page.getByTestId("roster-conversation-card").waitFor({ timeout: 5_000 });
  assert.match(await page.getByTestId("roster-conversation-card").textContent(), /Draft the forum post/);
  await page.screenshot({ path: path.join(output, "surfaces-hover-card.png"), animations: "disabled" });
  assert.equal(await sidebar().locator('[data-roster-bot-id="writer"] [data-roster-conversation-unread]').count(), 1);
  await page.mouse.move(900, 600);

  // Mark all as read from the sidebar's view menu; then a Mico's Mark as Unread and Mark as Read.
  await page.getByTestId("sidebar-view-menu").click();
  await page.getByRole("button", { name: "Recent activity" }).waitFor();
  await page.screenshot({ path: path.join(output, "surfaces-view-menu.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await sidebar().locator("[data-roster-unread-count]").waitFor({ state: "detached" });
  assert.equal(await sidebar().locator("[data-roster-conversation-unread]").count(), 0);
  await sidebar().locator('[data-roster-bot-id="mico"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mark as Unread", exact: true }).click();
  await sidebar().locator('[data-roster-bot-id="mico"] [data-roster-unread-count]').waitFor();
  await sidebar().locator('[data-roster-bot-id="mico"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mark as Read", exact: true }).click();
  await sidebar().locator("[data-roster-unread-count]").waitFor({ state: "detached" });
  // A filter with no match says so and clears; the default order and grouping never change.
  await page.getByTestId("sidebar-view-menu").click();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await page.keyboard.press("Escape");
  await sidebar().getByTestId("sidebar-filter-empty").waitFor();
  await sidebar().getByRole("button", { name: "Clear filters" }).click();
  await sidebar().locator('[data-roster-bot-id="mico"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  assert.deepEqual(errors, []);
  const result = { passed: true, fixtureOnly: true, productionAccess: false, screenshots: output, checks: [
    "desktop and mobile overflow", "light and dark theme", "select private task", "status marks on tabs and picker rows",
    "picker kind labels, activity order with times and archived group last", "restore an archived conversation into its tab",
    "draft tab creates nothing until the first message and keeps its text across a reload", "first message creates the conversation in the draft's place",
    "tab menu with close, rename, archive and delete; delete disabled while working", "archive closes the tab",
    "delete hides the tab with Undo that restores its place", "Mico-started conversation opens as a background tab",
    "Delete key, Ctrl+Shift+O and Alt+Shift+Up", "compact switcher below 200 px", "phone delete asks first",
    "return to main chat", "change Mico concurrency", "save and execute visual workflow", "stop workflow",
    "Conversations pane lists open conversations with state, time and Waiting for you", "a conversation opens beside the chat and its tab menu closes it with neighbour fallback",
    "Open in the chat moves a beside conversation into the chat", "Open waits card shows each wait, its request, cancels one and never claims a woken wait",
    "a conversation's approval answers from the main chat and resolves there",
    "sidebar unread count, numberless conversation badge and Needs you", "expanded Mico row with Show more / Show less opens a conversation",
    "hover card after a pause shows loaded conversations without reading them", "Mark all as read, Mico Mark as Unread and Mark as Read",
    "filter empty state and Clear filters", "surfaces at desktop and phone widths in light and dark", "no browser errors"] };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await server.close(); }
