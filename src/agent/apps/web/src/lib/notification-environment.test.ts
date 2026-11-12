import { expect, it } from "vitest";
import { notificationEnvironment } from "./notification-environment";
const browser = { userAgent: "", platform: "Linux", maxTouchPoints: 0, secure: true, installed: false, push: true, androidHost: false, nativeDesktop: false };
it("requires installation on iPhone and desktop-identifying iPad", () => {
  expect(notificationEnvironment({ ...browser, userAgent: "iPhone" })).toBe("ios-install");
  expect(notificationEnvironment({ ...browser, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios-install");
  expect(notificationEnvironment({ ...browser, userAgent: "iPhone", installed: true })).toBe("push");
});
it("distinguishes native hosts, insecure servers and browser fallbacks", () => {
  expect(notificationEnvironment({ ...browser, nativeDesktop: true })).toBe("desktop");
  expect(notificationEnvironment({ ...browser, androidHost: true })).toBe("android-host");
  expect(notificationEnvironment({ ...browser, secure: false })).toBe("insecure");
  expect(notificationEnvironment({ ...browser, push: false })).toBe("foreground");
});
