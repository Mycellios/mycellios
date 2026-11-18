import { describe, expect, it } from "vitest";
import { admitStaticBundle, bundleCapabilities, STATIC_WEB_CSP, staticResponse } from "./bundle.js";
import { hostedWebHttp } from "./http.js";
import { createWebPreview } from "./preview.js";

const html = { path: "index.html", base64: Buffer.from("<!doctype html>").toString("base64") };
const REVISION = "00000000-0000-4000-8000-000000000001";
const versioned = `http://localhost/api/published-webs/synthetic-site/_versions/${REVISION}/index.html`;
const BASE_PERMISSIONS = staticResponse(null, "text/plain").headers.get("permissions-policy");
const site = (bundle: unknown) =>
  hostedWebHttp(
    { $queryRaw: async () => [{ siteId: "site", id: REVISION, bundle }] } as never,
    "synthetic-test-secret",
    () => undefined,
  );

describe("hosted web capabilities", () => {
  it("keeps bundles without grants unchanged so existing digests stay stable", () => {
    const plain = admitStaticBundle({ files: [html] });
    expect(plain.bundle).toEqual({ files: [html] });
    expect(admitStaticBundle({ capabilities: [], files: [html] }).digest).toBe(plain.digest);
  });
  it("freezes grants into the digest and rejects unknown or repeated names", () => {
    const granted = admitStaticBundle({ capabilities: ["downloads"], files: [html] });
    expect(granted.bundle.capabilities).toEqual(["downloads"]);
    expect(granted.digest).not.toBe(admitStaticBundle({ files: [html] }).digest);
    for (const capabilities of [
      ["screen-capture"],
      ["allow-same-origin"],
      ["downloads", "downloads"],
    ])
      expect(() => admitStaticBundle({ capabilities, files: [html] })).toThrow();
    expect(bundleCapabilities({ capabilities: ["downloads", "allow-same-origin"] })).toEqual([
      "downloads",
    ]);
    expect(bundleCapabilities({ capabilities: "downloads" })).toEqual([]);
  });
  it("adds only allow-downloads and keeps every other boundary", () => {
    expect(staticResponse(null, "text/html").headers.get("content-security-policy")).toBe(
      STATIC_WEB_CSP,
    );
    const response = staticResponse(null, "text/html", 200, ["downloads"]);
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts allow-downloads;");
    expect(csp.replace(" allow-downloads", "")).toBe(STATIC_WEB_CSP);
    expect(csp).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
    expect(response.headers.get("permissions-policy")).toBe(BASE_PERMISSIONS);
  });
  it("serves each frozen revision with its own grant, never through the stable redirect", async () => {
    const granted = await site({ capabilities: ["downloads"], files: [html] }).request(versioned);
    expect(granted.status).toBe(200);
    expect(granted.headers.get("content-security-policy")).toContain("allow-downloads");
    const stable = await site({ capabilities: ["downloads"], files: [html] }).request(
      "http://localhost/api/published-webs/synthetic-site/",
    );
    expect(stable.status).toBe(302);
    expect(stable.headers.get("content-security-policy")).toBe(STATIC_WEB_CSP);
    const plain = await site({ files: [html] }).request(versioned);
    expect(plain.headers.get("content-security-policy")).toBe(STATIC_WEB_CSP);
  });
  it("previews a draft with its pending grant", async () => {
    const preview = createWebPreview(
      { userId: "synthetic", spaceId: "space" } as never,
      "site",
      1,
      { capabilities: ["downloads"], files: [html] },
    );
    const db = {
      spaceMember: { findUnique: async () => ({}) },
      hostedWeb: { findFirst: async () => ({ id: "site" }) },
    };
    const response = await hostedWebHttp(db as never, "s", () => undefined).request(
      `http://localhost${preview.path}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("allow-downloads");
  });
});
