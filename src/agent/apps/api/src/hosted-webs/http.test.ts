import { Hono } from "hono";
import { cors } from "hono/cors";
import { expect, it, vi } from "vitest";
import { STATIC_WEB_CSP } from "./bundle.js";
import { hostedWebHttp } from "./http.js";
import { createWebPreview, readWebPreview } from "./preview.js";

it("retains opaque sandbox headers on a mounted handler's infrastructure failure", async () => {
  const db = { $queryRaw: () => Promise.reject(new Error("private database detail")) };
  const app = new Hono();
  app.route(
    "/",
    hostedWebHttp(db as never, "synthetic-test-secret", () => "192.0.2.1"),
  );
  app.use("*", cors({ origin: "https://trusted.example.invalid", credentials: true }));
  const response = await app.request("http://localhost/api/published-webs/synthetic-site/");
  expect(response.status).toBe(503);
  expect(response.headers.get("content-security-policy")).toBe(STATIC_WEB_CSP);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(await response.text()).not.toContain("private database detail");
});
it("expires private read capabilities without session or persistent-storage authority", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    const capability = createWebPreview(
      { userId: "synthetic", spaceId: "space" } as never,
      "site",
      1,
      { files: [{ path: "index.html", base64: "aGk=" }] },
    );
    const token = capability.path.split("/")[3]!;
    expect(readWebPreview(token)?.id).toBe("site");
    expect(readWebPreview("guessed-token")).toBeNull();
    vi.advanceTimersByTime(120_001);
    expect(readWebPreview(token)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
