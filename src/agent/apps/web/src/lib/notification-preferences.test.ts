// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  notificationPreferences,
  saveNotificationPreferences,
  subscribeNotifications,
} from "./notification-preferences";

it("persists only this member's device policy and broadcasts changes locally and across windows", () => {
  localStorage.clear();
  const one = vi.fn(),
    two = vi.fn();
  const stopOne = subscribeNotifications("one", one),
    stopTwo = subscribeNotifications("two", two);
  try {
    saveNotificationPreferences("one", { enabled: false, preview: false });
    expect(notificationPreferences("one")).toEqual({ enabled: false, preview: false });
    expect(notificationPreferences("two")).toEqual({ enabled: true, preview: true });
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "mycellios:notifications:v1:two" }));
    expect(two).toHaveBeenCalledTimes(1);
  } finally {
    stopOne();
    stopTwo();
  }
});
it("treats corrupt preferences as defaults and reports failed writes", () => {
  localStorage.setItem("mycellios:notifications:v1:broken", "{");
  expect(notificationPreferences("broken").enabled).toBe(true);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    expect(() => saveNotificationPreferences("one", { enabled: false, preview: true })).toThrow(
      "quota",
    );
  } finally {
    write.mockRestore();
  }
});
