// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { applyGeneralPreferences, CHAT_COLORS, colorForeground, getGeneralPreferences, parseGeneralPreferences, setGeneralPreferences, subscribeGeneralPreferences } from "./general-preferences";
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("style"); });
it("rejects corrupt data, arbitrary CSS and unsafe fonts", () => {
  expect(parseGeneralPreferences("{").restoreLastWorkspace).toBe(true);
  expect(parseGeneralPreferences('{"chatColor":"url(evil)","interfaceFont":"bad; color:red","compactMessageActions":"no"}'))
    .toMatchObject({ chatColor: "default", interfaceFont: "Geist", compactMessageActions: true });
});
it("retains queued messages as the safe default and saves an explicit steering preference", () => {
  expect(parseGeneralPreferences('{"busyMessageMode":"invalid"}').busyMessageMode).toBe("queue");
  setGeneralPreferences({ busyMessageMode: "steer" }); expect(getGeneralPreferences().busyMessageMode).toBe("steer");
});
it("persists and applies theme-specific color choices, reset and fonts", () => {
  setGeneralPreferences({ chatColor: CHAT_COLORS[0], chatBackgroundDark: CHAT_COLORS[3], codeFont: "Consolas" });
  expect(getGeneralPreferences().chatBackgroundLight).toBe("default");
  expect(document.documentElement.style.getPropertyValue("--custom-chat-user")).toBe(CHAT_COLORS[0]);
  expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("Consolas");
  setGeneralPreferences({ chatColor: "default" });
  expect(document.documentElement.style.getPropertyValue("--custom-chat-user")).toBe("");
  expect(colorForeground("#ffffff")).toBe("#111111"); expect(colorForeground("#111111")).toBe("#ffffff");
});
it("keeps snapshots stable, notifies local and cross-tab changes", () => {
  const listener = vi.fn(); const off = subscribeGeneralPreferences(listener);
  expect(getGeneralPreferences()).toBe(getGeneralPreferences());
  setGeneralPreferences({ compactMessageActions: false, restoreLastWorkspace: false });
  expect(listener).toHaveBeenCalledOnce();
  window.dispatchEvent(new StorageEvent("storage", { key: "mycellios.general.v1" }));
  expect(listener).toHaveBeenCalledTimes(2); off();
});
it("leaves persisted choices unchanged on a storage failure", () => {
  applyGeneralPreferences(); const before = getGeneralPreferences();
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("denied"); });
  expect(() => setGeneralPreferences({ restoreLastWorkspace: false })).toThrow("denied");
  expect(getGeneralPreferences()).toBe(before); spy.mockRestore();
});
