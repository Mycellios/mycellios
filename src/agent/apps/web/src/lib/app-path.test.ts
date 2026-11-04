import { describe, expect, it } from "vitest";
import { matchRoutes } from "react-router-dom";
import { appBasePath, appPath, appRoute } from "./app-path";

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


it("matches the namespace entry with or without its trailing slash and preserves deep links", () => {
  const routes = [{ path: "/", id: "home" }, { path: "/app/:botId", id: "chat" }];
  for (const pathname of ["/agent", "/agent/"]) {
    expect(matchRoutes(routes, pathname, appBasePath("/agent/"))?.at(-1)?.route.id).toBe("home");
  }
  expect(matchRoutes(routes,"/agent/app/bot",appBasePath("/agent/"))?.at(-1)?.params.botId).toBe("bot");
  expect(matchRoutes(routes,"/agent-other",appBasePath("/agent/"))).toBeNull();
  expect(matchRoutes(routes,"/",appBasePath("/"))?.at(-1)?.route.id).toBe("home");
});
