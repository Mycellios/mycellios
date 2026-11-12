import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { createSystemNotifications, notificationDestination, notificationSettingsUrl } from "./system-notifications";

function setup() {
  const frame = { url: "https://example.test/agent/app/mico?view=settings" };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send: vi.fn() }) as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const notices: Array<EventEmitter & { close: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }> = [];
  const deps = { getTarget: () => ({ webContents: contents, url: "https://example.test/agent" }), platform: "win32", supported: () => true,
    create: vi.fn(() => { const n = Object.assign(new EventEmitter(), { close: vi.fn(), show: vi.fn() }); n.show.mockImplementation(() => n.emit("show")); notices.push(n); return n; }),
    focus: vi.fn(), openSettings: vi.fn(async () => undefined) };
  return { ...deps, frame, event, contents, notices, api: createSystemNotifications(deps) };
}
const input = { title: "Mycellios", body: "Your attention is needed", tag: "owner:thread", url: "/agent/app/mico?noticeSpace=space&task=task", silent: true };
afterEach(() => vi.useRealTimers());
it("retains native notices, replaces by tag, and routes clicks inside the app", async () => {
  const f = setup(); await f.api.show(f.event, input); await f.api.show(f.event, input);
  expect(f.notices[0]!.close).toHaveBeenCalled();
  f.notices[1]!.emit("click");
  expect(f.focus).toHaveBeenCalledWith(f.contents);
  expect(f.contents.send).toHaveBeenCalledWith("desktop.notifications.open", "https://example.test/agent/app/mico?noticeSpace=space&task=task");
});
it("rejects untrusted frames, other windows, unexpected origins and non-chat URLs", async () => {
  const f = setup();
  await expect(f.api.show({ ...f.event, senderFrame: null }, input)).rejects.toThrow();
  await expect(f.api.show({ ...f.event, sender: {} as WebContents }, input)).rejects.toThrow();
  f.frame.url = "https://evil.test/agent/app";
  await expect(f.api.show(f.event, input)).rejects.toThrow();
  f.frame.url = "https://example.test/agent/app";
  for (const url of ["https://evil.test/app/mico", "/app/mico", "/agent/webs/private", "/agent/app/mico?url=evil", "/agent/app/mico?task=x&task=y", "javascript:alert(1)"]) {
    await expect(f.api.show(f.event, { ...input, url })).rejects.toThrow();
  }
  expect(f.create).not.toHaveBeenCalled();
});
it("reports native failures and missing OS acknowledgement", async () => {
  const f = setup(); f.create.mockImplementation(() => { const n = Object.assign(new EventEmitter(), {close: vi.fn(), show: vi.fn()}); n.show.mockImplementation(() => n.emit("failed")); return n; });
  await expect(f.api.show(f.event, input)).rejects.toThrow("could not show");
  vi.useFakeTimers(); f.create.mockImplementation(() => Object.assign(new EventEmitter(), { close: vi.fn(), show: vi.fn() }));
  const result = f.api.show(f.event, input); const rejected = expect(result).rejects.toThrow("not accepted");
  await vi.advanceTimersByTimeAsync(5000); await rejected;
});
it("closes retained notices on account cleanup and bounds retained objects", async () => {
  const f = setup();
  for (let i = 0; i < 51; i++) await f.api.show(f.event, { ...input, tag: String(i) });
  expect(f.notices[0]!.close).toHaveBeenCalled(); f.api.clear(f.event);
  expect(f.notices.every(n => n.close.mock.calls.length > 0)).toBe(true);
  f.notices[50]!.emit("click");
  expect(f.contents.send).not.toHaveBeenCalled();
});
it("only opens fixed operating system settings destinations", async () => {
  const f = setup(); expect(await f.api.openSettings(f.event)).toBe(true);
  expect(f.openSettings).toHaveBeenCalledWith("ms-settings:notifications");
  expect(notificationSettingsUrl("darwin")).toContain("com.apple.Notifications");
  expect(notificationSettingsUrl("linux")).toBeNull();
  expect(notificationDestination("/agent/app/g/group?m=message", "https://example.test/agent/app/mico")).toBe("https://example.test/agent/app/g/group?m=message");
});
