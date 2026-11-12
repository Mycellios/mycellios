import { expect, it, vi } from "vitest";
import { devicePushNotification, installPushWorker, parsePushPayload } from "./push-worker";
const payload = () => parsePushPayload({ version: 1, id: "event", accountId: "owner", botId: "mico", threadId: "thread", spaceId: "space",
  title: "Private Mico", body: "Secret reply", kind: "completion", preview: true, tag: "mycellios:thread", expiresAt: Date.now() + 60_000 })!;
it("keeps device privacy, silence and pause authoritative over a preview-enabled push", () => {
  const p = payload();
  const notice = devicePushNotification(p, "https://mycellios.test/", "es", { preview: false, sound: false });
  expect(notice?.title).not.toContain("Private Mico"); expect(notice?.options.body).not.toContain("Secret reply");
  expect(notice?.options.silent).toBe(true);
  expect(devicePushNotification(p, "https://mycellios.test/", "es", { enabled: false })).toBeNull();
  expect(devicePushNotification(p, "https://mycellios.test/", "es", { mutedUntil: 2000 }, 1000)).toBeNull();
  expect(devicePushNotification(p, "https://mycellios.test/", "es", { mutedUntil: 2000 }, 2000)).not.toBeNull();
  expect(devicePushNotification(p, "https://mycellios.test/", "es", { attentionOnly: true })).toBeNull();
  expect(devicePushNotification({ ...p, kind: "help" }, "https://mycellios.test/", "es", { attentionOnly: true })).not.toBeNull();
  expect(devicePushNotification({ ...p, preview: false }, "https://mycellios.test/", "es", { preview: true })?.options.body).not.toContain("Secret reply");
});
it("hides legacy queued payloads without event-kind metadata", () => {
  const p = { ...payload(), kind: undefined };
  const notice = devicePushNotification(p, "https://mycellios.test/", "es", { preview: false });
  expect(notice?.title).not.toContain("Private Mico"); expect(notice?.options.body).not.toContain("Secret reply");
  expect(devicePushNotification(p, "https://mycellios.test/", "es", { attentionOnly: true })).toBeNull();
});
it("persists device preferences across worker restarts and clears them on sign-out", async () => {
  const caches = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: any) => void>();
  const shown = vi.fn(async () => {}), close = vi.fn();
  const scope = { registration: { scope: "https://mycellios.test/", showNotification: shown, getNotifications: async () => [{ close }] },
    navigator: { language: "en" }, location: { origin: "https://mycellios.test" },
    addEventListener: (name: string, fn: any) => listeners.set(name, fn),
    caches: { open: async (name: string) => {
      const rows = caches.get(name) ?? new Map<string, Response>(); caches.set(name, rows);
      return { match: async (key: string) => rows.get(key)?.clone(), put: async (key: string, value: Response) => { rows.set(key, value.clone()); },
        delete: async (key: string) => rows.delete(key), keys: async () => [...rows.keys()] };
    } } };
  const dispatch = async (name: string, input: object) => { let work: Promise<void> = Promise.resolve(); listeners.get(name)!({ ...input, waitUntil: (promise: Promise<void>) => { work = promise; } }); await work; };
  installPushWorker(scope as unknown as ServiceWorkerGlobalScope);
  await dispatch("message", { data: { type: "mycellios:push-binding", accountId: "owner", preferences: { preview: false, sound: false } }, source: { url: "https://mycellios.test/app" }, ports: [] });
  installPushWorker(scope as unknown as ServiceWorkerGlobalScope);
  await dispatch("push", { data: { json: payload } });
  expect(shown).toHaveBeenCalledOnce(); expect(shown.mock.calls[0]).toEqual([expect.not.stringContaining("Private Mico"), expect.objectContaining({ silent: true, body: expect.not.stringContaining("Secret reply") })]);
  await dispatch("message", { data: { type: "mycellios:push-binding", accountId: null }, source: { url: "https://mycellios.test/app" }, ports: [] });
  await dispatch("push", { data: { json: () => ({ ...payload(), id: "next" }) } });
  expect(shown).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalled();
});
