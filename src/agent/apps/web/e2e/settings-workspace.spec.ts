import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { activeBotId, completeOnboarding, rpc, signup } from "./helpers";

test("unified settings persist real local changes, guard drafts and keep every supported section reachable", async ({
  page,
}, info) => {
  if (info.project.use.baseURL !== "http://127.0.0.1:5192")
    throw new Error("Isolated local API only");
  const failures: unknown[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith("http://127.0.0.1:5192/"))
      failures.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("http://127.0.0.1:5192/"))
      failures.push({
        network: request.failure()?.errorText,
        path: new URL(request.url()).pathname,
      });
  });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    Object.defineProperty(window, "__settingsNotifications", { value: calls });
    class FixtureNotification {
      static permission = "granted";
      static async requestPermission() {
        return "granted";
      }
      constructor(title: string, options: unknown) {
        calls.push({ title, options });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", {
      value: FixtureNotification,
      configurable: true,
    });
  });
  const fixture = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "settings-fixture", object: "model" }] }));
      return;
    }
    for await (const _chunk of req) {
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Ready." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture");
  try {
    await signup(
      page,
      `settings-${Date.now()}@example.test`,
      "local-fixture-password12",
      "Settings qualification",
    );
    await rpc(page, "models/connect", {
      provider: "openai-compatible",
      scope: "account",
      modelId: "settings-fixture",
      apiKey: "fixture-only",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      enabledModelIds: ["settings-fixture"],
      makeDefault: true,
      maxTokens: 2048,
      contextWindow: 32768,
    });
    await page.goto("/onboarding");
    await completeOnboarding(page);
    const botId = activeBotId(page);
    const foreignSpace = await rpc<{ id: string }>(page, "spaces/create", {
      name: "Other settings space",
    });
    const foreignCreate = await page.request.post("/rpc/bots/create", {
      headers: { "x-rakazo-space-id": foreignSpace.id },
      data: {
        json: {
          name: "Other settings Mico",
          instructions: "Local fixture only.",
          notifyOnFinish: true,
        },
      },
    });
    expect(foreignCreate.ok()).toBe(true);
    const foreignBot = (await foreignCreate.json()).json as { id: string };
    await page.reload();
    await expect(page.getByRole("combobox", { name: /^Message/ })).toBeVisible();
    const composer = page.getByRole("combobox", { name: /^Message/ });
    await composer.fill("Preserve settings draft.");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByTestId("user-settings");
    const nav = page.getByTestId("settings-nav");
    for (const section of [
      "general",
      "profile",
      "agents",
      "models",
      "notifications",
      "voice",
      "confirmations",
      "space",
      "memory",
      "usage",
      "computer",
      "mobile",
      "updates",
    ]) {
      await page.getByTestId(`settings-nav-${section}`).click();
      await expect(settings).toHaveAttribute("data-settings-section", section);
      await expect(page.getByTestId("settings-scroll")).not.toBeEmpty();
    }
    await page.getByTestId("settings-search").fill("contraseña");
    await expect(nav.locator("button[data-testid^='settings-nav-']")).toHaveCount(1);
    await page.getByTestId("settings-search").press("Enter");
    await expect(settings).toHaveAttribute("data-settings-section", "profile");
    await page.getByTestId("settings-search").press("Escape");
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("model-settings").locator('[data-slot="spinner"]')).toHaveCount(
      0,
    );
    await settings.getByRole("button", { name: "OpenAI-compatible", exact: true }).click();
    const connection = page.getByTestId("model-connection");
    const advanced = connection.getByRole("button", { name: "Advanced settings", exact: true });
    if ((await advanced.getAttribute("aria-expanded")) === "false") await advanced.click();
    await connection.getByLabel("Maximum output tokens", { exact: true }).fill("4096");
    await page.getByTestId("settings-nav-general").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await connection.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => {
        const rows = await rpc<Array<{ maxTokens?: number }>>(page, "models/credentials", {});
        return rows[0]?.maxTokens;
      })
      .toBe(4096);
    await page.getByTestId("settings-nav-memory").click();
    await settings.getByRole("button", { name: "Connect memory provider", exact: true }).click();
    await page
      .getByTestId("memory-settings")
      .getByRole("textbox")
      .first()
      .fill("pending-memory-draft");
    await page.getByTestId("settings-nav-general").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page.getByTestId("settings-nav-voice").click();
    await settings.getByLabel("API key", { exact: true }).fill("pending-voice-key-not-submitted");
    await page.getByTestId("settings-nav-general").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page.getByTestId("settings-nav-profile").click();
    await page
      .getByTestId("account-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await settings.getByRole("textbox", { name: "Name", exact: true }).fill("Unsent profile edit");
    await page.getByTestId("settings-nav-updates").click();
    const discard = page.getByRole("alertdialog");
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
      "Unsent profile edit",
    );
    await page.getByTestId("settings-nav-updates").click();
    await discard.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(settings).toHaveAttribute("data-settings-section", "updates");
    await page.getByTestId("settings-nav-profile").click();
    await page
      .getByTestId("account-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await settings
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Settings saved locally");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("account-card")).toContainText("Settings saved locally");
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("ui-appearance-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("bots-sidebar-density-compact").click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("bots-sidebar-density-compact")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("ui-appearance-light").click();
    await page.getByTestId("settings-nav-profile").click();
    await expect(page.getByTestId("account-card")).toContainText("Settings saved locally");
    await page.getByTestId("settings-nav-notifications").click();
    await page.getByTestId("notification-preview").click();
    await page.getByTestId("notification-enabled").click();
    await page.reload();
    await expect(page.getByTestId("notification-enabled")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("notification-preview")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("notification-enabled").click();
    const micoNotice = settings.getByRole("switch").last();
    await micoNotice.click();
    await expect(micoNotice).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(settings.getByRole("switch").last()).toHaveAttribute("aria-checked", "false");
    await settings.getByRole("button", { name: "Send test", exact: true }).click();
    await expect(settings.getByRole("status")).toContainText("Test notification sent.");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __settingsNotifications: unknown[] }).__settingsNotifications
            .length,
      ),
    ).toBe(1);
    const originalSpaceName = (await page.getByTestId("settings-space").textContent())!.trim();
    await page.getByTestId("settings-space").click();
    await page.getByRole("option", { name: "Other settings space", exact: true }).click();
    const foreignNotice = settings.getByRole("switch", {
      name: "Other settings Mico",
      exact: true,
    });
    await expect(foreignNotice).toHaveAttribute("aria-checked", "true");
    expect(activeBotId(page)).toBe(botId);
    await foreignNotice.click();
    await expect(foreignNotice).toHaveAttribute("aria-checked", "false");
    const foreignRead = await page.request.post("/rpc/bots/list", {
      headers: { "x-rakazo-space-id": foreignSpace.id },
      data: { json: {} },
    });
    const foreignRows = (await foreignRead.json()).json as Array<{
      id: string;
      notifyOnFinish: boolean;
    }>;
    expect(foreignRows.find((row) => row.id === foreignBot.id)?.notifyOnFinish).toBe(false);
    await page.getByTestId("settings-space").click();
    await page.getByRole("option", { name: originalSpaceName, exact: true }).click();
    await expect(settings.getByRole("switch").last()).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("settings-nav-mobile").click();
    await settings.getByRole("button", { name: "How to install", exact: true }).click();
    const guide = page.getByRole("dialog").last();
    await expect(
      guide.getByText("Use your same account and Micos. Add the web app to your Home Screen."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-nav-updates").click();
    await settings.getByRole("button", { name: "What's new", exact: true }).click();
    await expect(page.getByTestId("release-notes-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(composer).toHaveValue("Preserve settings draft.");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByTestId("settings-nav-agents").click();
    await settings.getByRole("button", { name: "Manage", exact: true }).first().click();
    await expect(page.getByTestId("user-settings")).not.toBeVisible();
    await expect(page.getByTestId("bot-settings")).toBeVisible();
    await page.goto(`/app/${botId}?settings=agents`);
    await expect(settings).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("settings-space").click();
    await page.getByRole("option", { name: "Other settings space", exact: true }).click();
    await expect(settings).toContainText("Other settings Mico");
    await settings.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(page.getByTestId("bot-settings")).toBeVisible();
    await expect.poll(() => activeBotId(page)).toBe(foreignBot.id);
    await page.goto(`/app/${botId}?settings=general`);
    await expect(settings).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("ui-locale-select").click();
    await page.getByRole("option", { name: "Español", exact: true }).click();
    await expect(page.getByTestId("settings-nav-profile")).toContainText("Perfil y seguridad");
    await page.getByTestId("settings-nav-updates").click();
    await page.screenshot({
      path: info.outputPath("settings-updates-es.png"),
      animations: "disabled",
    });
    await page.getByTestId("settings-search").fill("zzzz-unavailable");
    await expect(
      settings.getByRole("status").filter({ hasText: "No se han encontrado ajustes." }),
    ).toBeVisible();
    await page.getByTestId("settings-search").press("Escape");
    await expect(page.getByTestId("settings-search")).toHaveValue("");
    await expect(settings).toBeVisible();
    await page.getByTestId("settings-nav-notifications").click();
    await page.screenshot({
      path: info.outputPath("settings-notifications-es.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("settings-search").fill("modelo");
    await page.getByTestId("settings-search").press("Enter");
    await expect(settings).toHaveAttribute("data-settings-section", "models");
    await page.getByTestId("settings-search").press("Escape");
    await expect(page.getByTestId("model-settings").locator('[data-slot="spinner"]')).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath("settings-mobile-es.png"),
      animations: "disabled",
    });
  } finally {
    await info.attach("redacted-local-network", {
      body: JSON.stringify(failures, null, 2),
      contentType: "application/json",
    });
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
