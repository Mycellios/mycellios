import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import {
  APP_CONTENT_SECURITY_POLICY,
  CSP_REPORTING_ENDPOINTS,
  HTML_VIEWER_PATH,
} from "@rakazo/contracts/content-security-policy";
import { describe, expect, it } from "vitest";
import {
  bundledRendererCandidates,
  bundledRendererHeaders,
  contentType,
  forwardedRendererRequestInit,
  immutableRendererAsset,
  isRendererAssetMiss,
  localRendererOverride,
} from "./renderer-assets.js";

const root = path.resolve("/tmp/rakazo-renderer");
const origin = "https://app.example.com";

describe("bundled desktop renderer", () => {
  it("rejects a redirected private asset directory", async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), "mc-ui-profile-"));
    const external = await mkdtemp(path.join(os.tmpdir(), "mc-ui-external-"));
    try {
      const directory = "local-web/" + "a".repeat(64);
      await mkdir(path.join(external,"a".repeat(64)));
      await writeFile(path.join(external,"a".repeat(64),"index.html"),'<script src="/agent/assets/app.js"></script>');
      await symlink(external,path.join(profile,"local-web"),process.platform === "win32" ? "junction" : "dir");
      await writeFile(path.join(profile,"local-renderer.json"),JSON.stringify({schema:"mycellios-local-renderer/1",directory,nativeVersion:"0.3.9"}));
      await expect(localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.9")).rejects.toThrow("Invalid local frontend directory");
    } finally { await rm(profile,{recursive:true,force:true}); await rm(external,{recursive:true,force:true}); }
  });
  it("keeps first-party identity, API and RPC requests on the network under /agent", () => {
    const own = "https://www.mycellios.com";
    for (const route of ["/agent/api/auth/get-session", "/agent/rpc/bots", "/agent/auth/v1/oauth/authorize", "/agent/%61pi/auth/get-session", "/oauth/consent", "/agentish/app"]) {
      expect(bundledRendererCandidates(root, own + route, own, true, "/agent")).toBeNull();
    }
    expect(bundledRendererCandidates(root, own + "/agent/app/bot", own, true, "/agent")).toEqual([path.join(root,"app/bot"),path.join(root,"index.html")]);
    expect(bundledRendererCandidates(root, own + "/agent/assets/index.js", own, false, "/agent")).toEqual([path.join(root,"assets/index.js")]);
    expect(bundledRendererCandidates(root, own + "/agent/%2e%2e%2fsecret.txt", own, true, "/agent")).toBeNull();
  });

  it("loads only an owner-configured, version-bound first-party UI without moving credentials", async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(),"mycellios-local-ui-"));
    const directory = "local-web/" + "a".repeat(64);
    const bundle = path.join(profile,directory);
    const preference = path.join(profile,"local-renderer.json");
    try {
      expect(await localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.9")).toBeNull();
      await mkdir(bundle,{recursive:true});
      await writeFile(path.join(bundle,"index.html"),'<script src="/agent/assets/index.js"></script>');
      await writeFile(preference,JSON.stringify({schema:"mycellios-local-renderer/1",directory,nativeVersion:"0.3.9"}));
      expect(await localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.9")).toBe(bundle);
      expect(await localRendererOverride(profile,"https://foreign.example/agent/app","0.3.9")).toBeNull();
      expect(await localRendererOverride(profile,"https://www.mycellios.com/dashboard","0.3.9")).toBeNull();
      expect(await localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.10")).toBeNull();
      await writeFile(preference,JSON.stringify({schema:"mycellios-local-renderer/1",directory:"../outside",nativeVersion:"0.3.9"}));
      await expect(localRendererOverride(profile,"https://www.mycellios.com/agent/app","0.3.9")).rejects.toThrow("Invalid local frontend preference");
    } finally {
      await rm(preference,{force:true});await rm(path.join(bundle,"index.html"),{force:true});
      await rmdir(bundle);await rmdir(path.join(profile,"local-web"));await rmdir(profile);
    }
  });
  it("serves static assets and falls back to index.html for app routes", () => {
    expect(bundledRendererCandidates(root, `${origin}/assets/app-123.js`, origin, false)).toEqual([
      path.join(root, "assets/app-123.js"),
    ]);
    expect(bundledRendererCandidates(root, `${origin}/app/bot-1`, origin, true)).toEqual([
      path.join(root, "app/bot-1"),
      path.join(root, "index.html"),
    ]);
    expect(bundledRendererCandidates(root, `${origin}/app/bot.name`, origin, true)).toEqual([
      path.join(root, "app/bot.name"),
      path.join(root, "index.html"),
    ]);
  });

  it("leaves APIs, screen proxying, and other origins on the network", () => {
    for (const pathname of ["/api/auth/session", "/rpc/bots", "/novnc/socket"]) {
      expect(bundledRendererCandidates(root, `${origin}${pathname}`, origin, false)).toBeNull();
    }
    expect(
      bundledRendererCandidates(root, "https://example.net/assets/app-123.js", origin, false),
    ).toBeNull();
  });

  it("does not resolve traversal outside the renderer root", () => {
    expect(
      bundledRendererCandidates(root, `${origin}/%2e%2e%2fsecret.txt`, origin, false),
    ).toBeNull();
    expect(bundledRendererCandidates(root, `${origin}/bad%00name.js`, origin, false)).toBeNull();
  });

  it("assigns cache and content metadata", () => {
    expect(contentType("index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("app.woff2")).toBe("font/woff2");
    expect(contentType("mico.webp")).toBe("image/webp");
    expect(bundledRendererHeaders(path.join(root, "assets/mico.webp"), `${origin}/agent/assets/mico.webp`)
      .get("content-type")).toBe("image/webp");
    expect(immutableRendererAsset(path.join(root, "assets/app-123.js"))).toBe(true);
    expect(immutableRendererAsset(path.join(root, "index.html"))).toBe(false);
  });

  it("sends the web server's CSP with bundled documents", () => {
    const index = path.join(root, "index.html");
    const app = bundledRendererHeaders(index, `${origin}/bots/1?tab=chat`);
    expect(app.get("content-security-policy")).toBe(APP_CONTENT_SECURITY_POLICY);
    expect(app.get("reporting-endpoints")).toBe(CSP_REPORTING_ENDPOINTS);
    expect(app.get("x-content-type-options")).toBe("nosniff");
    expect(app.get("cache-control")).toBe("no-cache");
    const viewer = bundledRendererHeaders(
      path.join(root, "html-viewer.html"),
      `${origin}${HTML_VIEWER_PATH}`,
    );
    expect(viewer.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(
      bundledRendererHeaders(path.join(root, "assets/app-1.js"), `${origin}/assets/app-1.js`).get(
        "cache-control",
      ),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("treats filesystem path misses as renderer fallbacks", () => {
    for (const code of ["ENOENT", "EISDIR", "ENOTDIR"]) {
      expect(isRendererAssetMiss(Object.assign(new Error(code), { code }))).toBe(true);
    }
    expect(isRendererAssetMiss(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
    expect(isRendererAssetMiss(null)).toBe(false);
  });

  it("adds project frames only for the managed local renderer", () => {
    const file = path.join(root, "index.html");
    expect(bundledRendererHeaders(file, `${origin}/app`, true).get("content-security-policy"))
      .toContain("frame-src 'self' blob: http://127.0.0.1:* http://localhost:*");
    expect(bundledRendererHeaders(file, `${origin}/app`, false).get("content-security-policy"))
      .toBe(APP_CONTENT_SECURITY_POLICY);
  });

  it("forwards cookies for both app and cross-origin requests", () => {
    const appOptions = forwardedRendererRequestInit(new Request(`${origin}/rpc/bots`), origin);
    const oauthOptions = forwardedRendererRequestInit(
      new Request("https://oauth.example.com/authorize"),
      origin,
    );

    expect(appOptions.credentials).toBe("include");
    expect(new Headers(appOptions.headers).get("origin")).toBe(origin);
    expect(oauthOptions).toMatchObject({
      bypassCustomProtocolHandlers: true,
      credentials: "include",
    });
    expect(oauthOptions.headers).toBeUndefined();
  });
  it("preserves the native relay origin boundary", () => {
    const own = "https://www.mycellios.com";
    const url = own + "/agent/api/desktop-relay/identity";
    const native = forwardedRendererRequestInit(new Request(url, {method:"POST", headers:{"x-mycellios-desktop":"1"}}),own);
    expect(new Headers(native.headers).has("origin")).toBe(false);
    const renderer = forwardedRendererRequestInit(new Request(url, {method:"POST", headers:{"x-mycellios-desktop":"1",origin:own}}),own);
    expect(new Headers(renderer.headers).get("origin")).toBe(own);
    const ordinary = forwardedRendererRequestInit(new Request(url),own);
    expect(new Headers(ordinary.headers).get("origin")).toBe(own);
  });
});
