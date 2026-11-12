// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { register } = vi.hoisted(() => ({ register: vi.fn(async () => undefined) }));
vi.mock("./rpc", () => ({ rpc: { notifications: { webRegister: register } } }));
vi.mock("./notification-preferences", () => ({ notificationPreferences: () => ({ enabled: true }), subscribeNotifications: () => () => {} }));
import { clearNotificationDevice, enableWebPush, notificationClientId } from "./web-push";

beforeEach(() => { localStorage.clear(); register.mockClear(); vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {}); vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("MessageChannel", class {
    port1 = { onmessage: null as null | ((event: { data: string }) => void), close: () => {} };
    port2 = { reply: () => this.port1.onmessage?.({ data: "bound" }) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("rotates an unowned subscription and pins enrollment to its account", async () => {
  const unsubscribe = vi.fn(async () => true);
  const subscription = { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer }, unsubscribe,
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fixture", keys: { p256dh: "fixture", auth: "fixture" } }) };
  const subscribe = vi.fn(async () => subscription);
  const worker = { active: { postMessage: (_data: unknown, ports: Array<{ reply: () => void }> = []) => ports[0]?.reply() },
    pushManager: { getSubscription: async () => subscription, subscribe } };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => worker } });
  await Promise.all([enableWebPush("AQID", "owner"), enableWebPush("AQID", "owner")]);
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(subscribe).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledOnce(); expect(register).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: "owner" }));
  expect(localStorage.getItem("mycellios:notification-owner")).toBe("owner");
});
it("keeps a stable in-memory client id when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(notificationClientId()).toBe(notificationClientId());
});
it("clears the durable account binding and unsubscribes on explicit sign-out", async () => {
  localStorage.setItem("mycellios:notification-owner", "owner");
  const unsubscribe = vi.fn(async () => true);
  const postMessage = vi.fn((_data: unknown, ports: Array<{ reply: () => void }> = []) => ports[0]?.reply());
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ active: { postMessage }, pushManager: { getSubscription: async () => ({ unsubscribe }) } }) } });
  await clearNotificationDevice();
  expect(localStorage.getItem("mycellios:notification-owner")).toBeNull();
  expect(postMessage).toHaveBeenCalledWith({ type: "mycellios:push-binding", accountId: null }, expect.any(Array));
  expect(unsubscribe).toHaveBeenCalledOnce();
});
