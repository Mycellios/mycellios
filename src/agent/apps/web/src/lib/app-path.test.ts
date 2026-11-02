import { describe, expect, it } from "vitest";
import { appPath, appRoute } from "./app-path";

describe("deployment namespace", () => {
  it("keeps API, auth, assets and deep links within the application", () => {
    for (const path of [
      "/api/auth/get-session",
      "/rpc/models/list",
      "/assets/app.js",
      "/app/bot?m=1",
      "/sw.js",
    ])
      expect(appPath(path, "/agent/")).toBe(`/agent${path}`);
    expect(appRoute("/agent/app/bot", "/agent/")).toBe("/app/bot");
    expect(appRoute("/agent", "/agent/")).toBe("/");
    expect(appRoute("/agent-other", "/agent/")).toBe("/agent-other");
    expect(appPath("/agent/app", "/agent/")).toBe("/agent/app");
  });
  it("preserves root deployments and external destinations", () => {
    expect(appPath("/api/auth", "/")).toBe("/api/auth");
    expect(appPath("https://example.com/path", "/agent/")).toBe("https://example.com/path");
    expect(appPath("//example.com/path", "/agent/")).toBe("//example.com/path");
  });
});
