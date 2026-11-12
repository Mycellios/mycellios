import { randomUUID } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter } from "./router.js";
import type { RouterDeps } from "./router.js";

function fixture(
  actor: Actor | null = {
    userId: "owner",
    spaceId: "space",
    email: "owner@example.invalid",
    isDeploymentOwner: false,
  },
  sessionId: string | undefined = "owned-session",
  androidConfigured = true,
) {
  const webPush = {
    config: { publicKey: "public" },
    status: vi.fn(async () => ({
      configured: true,
      publicKey: "public",
      registered: false,
      settings: { level: "all", previews: false, mutedUntil: null, bots: {} },
      bots: [],
    })),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    presence: vi.fn(async () => undefined),
    settings: vi.fn(async () => ({ level: "all", previews: false, mutedUntil: null, bots: {} })),
    saveSettings: vi.fn(async (userId, input) => input),
  };
  const deps = {
    prisma: {},
    dataDir: "/notification-fixture",
    secrets: {},
    webPush,
    androidPushConfigured: androidConfigured,
    androidPushProjectId: "mycellios-test",
    pushTokens: { save: vi.fn(async () => undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1",
      screenProxySecret: "fixture",
      sandboxProvider: "fake",
    },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: { actor, sessionId } as never });
  return { client, webPush, pushTokens: deps.pushTokens };
}
describe("notification account RPC", () => {
  it("binds FCM enrollment to the current account, session and Firebase project", async () => {
    const f = fixture();
    const input = { token: "android-device-token-for-fixture", expectedUserId: "owner", projectId: "mycellios-test" };
    await expect(f.client.notifications.registerAndroidPush({ ...input, expectedUserId: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.client.notifications.registerAndroidPush({ ...input, projectId: "different-project" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.pushTokens.save).not.toHaveBeenCalled();
    await expect(f.client.notifications.registerAndroidPush(input)).resolves.toEqual({ ok: true });
    expect(f.pushTokens.save).toHaveBeenCalledWith("owner", input.token, "owned-session", "fcm");
    const disabled = fixture(undefined, "owned-session", false);
    await expect(disabled.client.notifications.registerAndroidPush(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(fixture(null).client.notifications.androidStatus()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects subscription enrollment after an account switch", async () => {
    const f = fixture();
    await expect(f.client.notifications.webRegister({ clientId: randomUUID(), expectedUserId: "previous-owner",
      subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) } },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.webPush.register).not.toHaveBeenCalled();
  });
  it("does not expose notification state without authentication", async () => {
    const f = fixture(null);
    await expect(
      f.client.notifications.webStatus({ clientId: randomUUID() }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.webPush.status).not.toHaveBeenCalled();
  });
  it("binds registration to the authenticated account and session, never renderer owner IDs", async () => {
    const f = fixture(),
      clientId = randomUUID(),
      subscription = {
        endpoint: "https://fcm.googleapis.com/test",
        keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
      };
    await f.client.notifications.webRegister({ clientId, subscription });
    expect(f.webPush.register).toHaveBeenCalledWith(
      "owner",
      "owned-session",
      clientId,
      subscription,
    );
    await f.client.notifications.webPresence({ clientId, focused: true });
    expect(f.webPush.presence).toHaveBeenCalledWith("owner", "owned-session", clientId, true);
  });
  it("refuses registration without an authenticated session", async () => {
    const f = fixture(undefined, undefined); // override the default below with a genuinely absent session
    const client = createRouterClient(
      createRouter({
        prisma: {},
        dataDir: "/fixture",
        secrets: {},
        webPush: f.webPush,
      } as unknown as RouterDeps),
      {
        context: {
          actor: { userId: "owner", spaceId: "space", email: "owner@example.invalid" },
        } as never,
      },
    );
    await expect(
      client.notifications.webRegister({
        clientId: randomUUID(),
        subscription: {
          endpoint: "https://fcm.googleapis.com/test",
          keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
        },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.webPush.register).not.toHaveBeenCalled();
  });
  it("applies preference changes only to the signed-in account", async () => {
    const f = fixture(),
      settings = { level: "off" as const, previews: false, mutedUntil: null, bots: {} };
    await f.client.notifications.saveSettings(settings);
    expect(f.webPush.saveSettings).toHaveBeenCalledWith("owner", settings);
  });
});
