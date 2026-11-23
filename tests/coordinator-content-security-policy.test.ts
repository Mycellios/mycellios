import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentSecurityPolicyHeader,
  contentSecurityPolicy,
  inlineScriptHashes,
} from "../src/coordinator/content-security-policy.js";

const sha = (body: string): string =>
  `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

const directories: string[] = [];
function assetRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mycellios-csp-"));
  directories.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("coordinator content security policy", () => {
  it("hashes only executable inline scripts", () => {
    const bootstrap = "\n  (() => { document.body.dataset.ready = '1'; })();\n";
    const html = `<html><head>
      <script id="seo-structured-data" type="application/ld+json">{"@type":"Thing"}</script>
      <script type="module" src="/assets/index.js"></script>
    </head><body><script id="bootstrap">${bootstrap}</script>
      <script type="module">import "/a.js";</script></body></html>`;
    expect(inlineScriptHashes(html)).toEqual([sha(bootstrap), sha('import "/a.js";')]);
  });

  it("refuses injected and third-party scripts while keeping the base directives", () => {
    const policy = contentSecurityPolicy(["'sha256-abc'"]);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'sha256-abc'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toMatch(/script-src[^;]*https?:/);
  });

  it("allows the inline scripts of every served page and refreshes after a release", () => {
    const first = "window.first = 1;";
    const nested = "window.nested = 1;";
    const root = assetRoot({
      "index.html": `<script>${first}</script>`,
      "account/index.html": `<script>${nested}</script>`,
    });
    let now = 1_000_000;
    const header = new ContentSecurityPolicyHeader(() => now);
    expect(header.header()).not.toContain("sha256-");
    header.addRoot(root);
    expect(header.header()).toContain(sha(first));
    expect(header.header()).toContain(sha(nested));

    const next = "window.next = 1;";
    writeFileSync(join(root, "index.html"), `<script>${next}</script>`);
    utimesSync(join(root, "index.html"), new Date(), new Date(Date.now() + 60_000));
    expect(header.header()).toContain(sha(first)); // cached until the recheck interval
    now += 30_000;
    expect(header.header()).toContain(sha(next));
    expect(header.header()).not.toContain(sha(first));
  });

  it("serves the policy from the coordinator for the landing and the mobile worker", async () => {
    const { createCoordinator } = await import("../src/coordinator/server.js");
    const bootstrap = "window.loaderReady = true;";
    const landing = assetRoot({ "index.html": `<!doctype html><div id="root"></div><script>${bootstrap}</script>` });
    const mobile = assetRoot({ "index.html": "<!doctype html><script type=\"module\" src=\"/main.js\"></script>" });
    const runtime = await createCoordinator({
      host: "127.0.0.1",
      port: 0,
      databasePath: ":memory:",
      requestTimeoutMs: 1_000,
      landingAssetsPath: landing,
      mobileAssetsPath: mobile,
    }, { logger: false });
    try {
      const page = await runtime.app.inject({ method: "GET", url: "/" });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-security-policy"]).toContain(sha(bootstrap));
      const api = await runtime.app.inject({ method: "GET", url: "/health" });
      expect(api.headers["content-security-policy"]).toContain("script-src 'self'");
      const missing = await runtime.app.inject({ method: "GET", url: "/esto-no-existe", headers: { accept: "text/html" } });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers["content-type"]).toContain("text/html");
      expect(missing.headers["content-security-policy"]).toContain("script-src 'self'");
      const missingApi = await runtime.app.inject({ method: "GET", url: "/v1/missing", headers: { accept: "text/html" } });
      expect(missingApi.json()).toMatchObject({ statusCode: 404 });
    } finally {
      await runtime.app.close();
    }
  });
});
