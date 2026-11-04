import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("integration setup failures show actionable copy without provider details", async ({
  page,
}, testInfo) => {
  await signup(
    page,
    `integration-auth-${Date.now()}@rakazo.test`,
    "password12",
    "Integration Auth",
  );
  await completeOnboarding(page);
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            connectorId: "composio",
            slug: "twitter",
            name: "X",
            logo: null,
            connected: false,
            noAuth: false,
          },
        ],
      },
    }),
  );
  let attempts = 0;
  await page.route("**/rpc/connections/begin", (route) => {
    attempts++;
    return route.fulfill({
      status: 400,
      json: {
        json: {
          defined: false,
          code: "BAD_REQUEST",
          status: 400,
          message: "INTEGRATION_AUTH_SETUP_REQUIRED",
        },
      },
    });
  });
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await page.getByRole("textbox", { name: "Search apps", exact: true }).fill("X");
  await page.locator("#integration-list").getByRole("button", { name: "Add", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("This integration needs server setup. Contact the administrator.");
  expect(attempts).toBe(1);
  await captureScreenshot(page, testInfo, "integration-auth-setup-required");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(alert).toBeVisible();
  await captureScreenshot(page, testInfo, "integration-auth-setup-required-mobile");

  await page.route("**/rpc/connections/begin", (route) =>
    route.fulfill({
      status: 400,
      json: {
        json: {
          defined: false,
          code: "BAD_REQUEST",
          status: 400,
          message:
            '400 {"error":{"slug":"ToolRouterV2_NoManagedAuth","request_id":"private-request"}}',
        },
      },
    }),
  );
  await page.locator("#integration-list").getByRole("button", { name: "Add", exact: true }).click();
  await expect(alert).toHaveText("Could not connect");
  await expect(page.getByRole("dialog")).not.toContainText("private-request");
  await expect(page.getByRole("dialog")).not.toContainText("ToolRouter");
});

test("signup never grants server authority and settings contain only account controls", async ({
  page,
}, testInfo) => {
  await signup(page, `ordinary-account-${Date.now()}@rakazo.test`, "password12", "Test Account");
  await completeOnboarding(page);
  const me = await page.request.post("/rpc/me", { data: { json: null } });
  expect((await me.json()).json.isDeploymentOwner).toBe(false);
  for (const [path, input] of [
    ["deployment/update", { signupsEnabled: true }],
    ["updater/apply", {}],
    ["security/events", {}],
    ["integrationSetup/save", { provider: "composio", apiKey: "fake-key" }],
  ] as const) {
    expect((await page.request.post(`/rpc/${path}`, { data: { json: input } })).status()).toBe(403);
  }
  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("user-settings")).toBeVisible();
  await expect(page.getByRole("link", { name: "Server integrations", exact: true })).toBeHidden();
  await expect(page.getByTestId("settings-nav-updates")).toBeHidden();
  await captureScreenshot(page, testInfo, "account-settings-without-server-admin");
});

test("ordinary accounts can add personal MCP connections without server setup", async ({
  page,
}, testInfo) => {
  await signup(page, `personal-mcp-${Date.now()}@rakazo.test`, "password12", "Personal MCP");
  await completeOnboarding(page);
  await page.goto("/integrations/setup");
  await expect(page.getByRole("heading", { name: "Add MCP server" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search apps", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Server integrations" })).toBeHidden();
  for (const name of ["Composio", "Pipedream", "Executor"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeHidden();
  }
  await page.route("**/rpc/capabilities/catalogSearch", (route) =>
    route.fulfill({
      json: {
        json: {
          enabled: true,
          results: [
            {
              domain: "notion.example.test",
              name: "Notion",
              description: "",
              pageUrl: null,
              surfaces: [
                {
                  kind: "mcp",
                  slug: "notion",
                  source: "https://mcp.notion.example.test/mcp",
                  auth: null,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.route("**/rpc/mcp/oauth/begin", (route) =>
    route.fulfill({ json: { json: { status: "already_connected" } } }),
  );
  await page.getByRole("textbox", { name: "Search apps", exact: true }).fill("Notion");
  await page.getByRole("button", { name: "Search integrations.sh", exact: true }).click();
  await expect(page.getByText("Notion", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connected", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "personal-mcp-without-server-admin");
});
