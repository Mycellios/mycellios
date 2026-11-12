import { describe, expect, it } from "vitest";
import { admitStaticBundle, STATIC_WEB_CSP, staticResponse } from "./bundle.js";

const file = (path: string, text = "hello") => ({
  path,
  base64: Buffer.from(text).toString("base64"),
});
describe("static website admission", () => {
  it("canonicalizes a bounded bundle without rewriting its executable source", () => {
    const html = "<!doctype html><script>document.body.textContent='works'</script>";
    const a = admitStaticBundle({ files: [file("index.html", html), file("_assets/_common.js")] });
    const b = admitStaticBundle({ files: [file("_assets/_common.js"), file("index.html", html)] });
    expect(a.digest).toBe(b.digest);
    expect(
      Buffer.from(a.bundle.files.find((f) => f.path === "index.html")!.base64, "base64").toString(),
    ).toBe(html);
  });
  it.each([
    "../index.html",
    "/index.html",
    "C:/index.html",
    "foo\\index.html",
    "%2e%2e/index.html",
    ".env",
    "_versions/index.html",
    ".git/config.js",
    "secrets/key.json",
    "server.php",
    "foo/index.html?x",
    "a//b.js",
    "a/./b.js",
    "a/../b.js",
    "x\0.js",
  ])("rejects unsafe or nonstatic path %s", (path) => {
    expect(() => admitStaticBundle({ files: [file("index.html"), file(path)] })).toThrow();
  });
  it("rejects ambiguity, malformed encodings, missing entry and size bombs", () => {
    expect(() => admitStaticBundle({ files: [file("index.html"), file("INDEX.html")] })).toThrow();
    expect(() => admitStaticBundle({ files: [{ path: "index.html", base64: "Zh==" }] })).toThrow();
    expect(() => admitStaticBundle({ files: [file("app.js")] })).toThrow();
    expect(() =>
      admitStaticBundle({ files: [file("index.html", "x".repeat(1024 * 1024 + 1))] }),
    ).toThrow();
    expect(() =>
      admitStaticBundle({
        files: [
          file("index.html"),
          ...Array.from({ length: 5 }, (_, i) => file(`${i}.js`, "x".repeat(1024 * 1024))),
        ],
      }),
    ).toThrow();
  });
  it("admits one genuine raster cover but rejects spoofed or ambiguous covers",()=>{
    const cover={path:"mycellios-cover.png",base64:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")};
    expect(admitStaticBundle({files:[file("index.html"),cover]}).bundle.files).toHaveLength(2);
    expect(()=>admitStaticBundle({files:[file("index.html"),file("mycellios-cover.png","<svg/>")]})).toThrow();
    expect(()=>admitStaticBundle({files:[file("index.html"),cover,{...cover,path:"mycellios-cover.jpg"}]})).toThrow();
  });
  it("blocks recognizable credentials, including inside source", () => {
    expect(() =>
      admitStaticBundle({ files: [file("index.html", "-----BEGIN PRIVATE KEY-----")] }),
    ).toThrow(/credentials/);
    expect(() =>
      admitStaticBundle({ files: [file("index.html", "sk-proj-" + "a".repeat(24))] }),
    ).toThrow(/credentials/);
  });
  it("enforces an opaque sandbox on direct navigation and asset/error responses", () => {
    expect(STATIC_WEB_CSP).toContain("sandbox allow-scripts;");
    expect(STATIC_WEB_CSP).not.toMatch(
      /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/,
    );
    expect(STATIC_WEB_CSP).toContain("worker-src 'none'");
    const response = staticResponse("not found", "text/plain", 404);
    expect(response.headers.get("content-security-policy")).toBe(STATIC_WEB_CSP);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
