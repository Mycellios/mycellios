import { expect, it } from "vitest";
import { desktopProjectPolicy } from "./project-preview-policy.js";
it("extends only the native first-party main document's frames, preserving script and connection policy", () => {
  const policy = "script-src 'self'; connect-src 'self'; frame-src 'self' https://trusted.test";
  const result = desktopProjectPolicy("https://www.mycellios.com/agent/app", "mainFrame", policy);
  expect(result).toContain("frame-src 'self' https://trusted.test http://127.0.0.1:* http://localhost:*");
  expect(result).toContain("script-src 'self'; connect-src 'self';");
  expect(desktopProjectPolicy("https://www.mycellios.com/dashboard", "mainFrame", policy)).toBe(policy);
  expect(desktopProjectPolicy("https://attacker.test/agent/app", "mainFrame", policy)).toBe(policy);
  expect(desktopProjectPolicy("https://www.mycellios.com/agent/app", "subFrame", policy)).toBe(policy);
});
