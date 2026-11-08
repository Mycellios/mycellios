import { describe, expect, it, vi } from "vitest";
import {
  NotificationSettingsSchema,
  notificationAllowed,
  WebPushSubscriptionSchema,
} from "@rakazo/contracts";
import {
  notificationChannels,
  privateNotification,
  validatePushEndpoint,
  webPushConfig,
} from "./web-push.js";
import type { WebPushService } from "./web-push.js";
import type {
  AdapterContext,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import webpush from "web-push";

const message: NotificationMessage = {
  kind: "completion",
  title: "A private project",
  body: "Confidential content",
  botId: "bot",
  threadId: "thread",
};
describe("notification policy and privacy", () => {
  it("defaults to important updates without content previews", () => {
    const settings = NotificationSettingsSchema.parse({});
    expect(settings).toEqual({ level: "all", previews: false, mutedUntil: null, bots: {} });
    expect(notificationAllowed(settings, "bot", "completion")).toBe(true);
    expect(privateNotification(message, false)).toEqual({
      title: "Mycellios",
      body: expect.not.stringContaining("Confidential"),
    });
  });
  it.each(["failure", "help", "takeover"] as const)("needs-me includes %s", (kind) => {
    expect(
      notificationAllowed(NotificationSettingsSchema.parse({ level: "needs_me" }), "bot", kind),
    ).toBe(true);
  });
  it("honors per-Mico overrides, but never bypasses master off or pause", () => {
    const settings = NotificationSettingsSchema.parse({
      level: "needs_me",
      bots: { bot: "all", quiet: "off" },
    });
    expect(notificationAllowed(settings, "other", "completion")).toBe(false);
    expect(notificationAllowed(settings, "bot", "completion")).toBe(true);
    expect(notificationAllowed(settings, "quiet", "help")).toBe(false);
    expect(notificationAllowed({ ...settings, level: "off" }, "bot", "help")).toBe(false);
    expect(
      notificationAllowed(
        { ...settings, mutedUntil: new Date(2000).toISOString() },
        "bot",
        "help",
        1000,
      ),
    ).toBe(false);
    expect(
      notificationAllowed(
        { ...settings, mutedUntil: new Date(2000).toISOString() },
        "bot",
        "help",
        2001,
      ),
    ).toBe(true);
  });
  it("redacts credentials even in opt-in previews, and bounds the payload", () => {
    const value = privateNotification(
      {
        ...message,
        body: "token=secret-value Bearer secret-auth sk-secretkey " + "a".repeat(1000),
      },
      true,
    );
    expect(value.body).not.toMatch(/secret-value|secret-auth|sk-secretkey/);
    expect(value.body.length).toBeLessThanOrEqual(180);
  });
  it("requires valid subscription key sizes", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/test",
        keys: { p256dh: "a", auth: "b" },
      }).success,
    ).toBe(false);
  });
});
describe("vendor transport boundary", () => {
  it("uses encrypted Web Push transport with VAPID, without sending the payload in plaintext", () => {
    const keys = webpush.generateVAPIDKeys();
    const request = webpush.generateRequestDetails(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/test",
        keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16).toString("base64url") },
      },
      "private fixture message",
      {
        vapidDetails: { ...keys, subject: "mailto:fixture@example.invalid" },
        TTL: 300,
        contentEncoding: "aes128gcm",
      },
    );
    expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request.headers.Authorization).toMatch(/^vapid /);
    expect(request.body?.toString()).not.toContain("private fixture message");
  });
  it.each([
    "https://fcm.googleapis.com/fcm/send/test",
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://web.push.apple.com/test",
    "https://wns.notify.windows.com/test",
  ])("accepts %s", (endpoint) => expect(validatePushEndpoint(endpoint)).toBe(endpoint));
  it.each([
    "http://fcm.googleapis.com/test",
    "https://127.0.0.1/test",
    "https://fcm.googleapis.com.evil.example/test",
    "https://evilnotify.windows.com/test",
    "https://fcm.googleapis.com:444/test",
    "https://user:secret@fcm.googleapis.com/test",
    "https://web.push.apple.com/test#token",
  ])("rejects %s", (endpoint) => expect(() => validatePushEndpoint(endpoint)).toThrow());
  it("never silently creates new VAPID identities at boot", () => {
    expect(webPushConfig({})).toBeUndefined();
    expect(() =>
      webPushConfig({
        WEB_PUSH_VAPID_PUBLIC_KEY: "bad",
        WEB_PUSH_VAPID_PRIVATE_KEY: "bad",
        WEB_PUSH_SUBJECT: "mailto:test@example.invalid",
      }),
    ).toThrow();
  });
});
describe("native compatibility", () => {
  const context = { userId: "user", spaceId: "space" } as AdapterContext;
  const native = () =>
    ({ send: vi.fn(async () => undefined), describe: vi.fn() }) as unknown as NotificationProvider;
  it("a broken new channel cannot prevent native delivery", async () => {
    const existing = native();
    const web = {
      settings: async () => NotificationSettingsSchema.parse({}),
      enqueue: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as WebPushService;
    await notificationChannels(existing, web).send(message, context);
    expect(existing.send).toHaveBeenCalledOnce();
  });
  it("Web Push settings do not disable native delivery", async () => {
    const existing = native();
    const web = {
      settings: async () => NotificationSettingsSchema.parse({ level: "off" }),
      enqueue: vi.fn(async () => 0),
    } as unknown as WebPushService;
    await notificationChannels(existing, web).send(message, context);
    expect(existing.send).toHaveBeenCalledOnce();
    expect(web.enqueue).toHaveBeenCalledOnce();
  });
});
