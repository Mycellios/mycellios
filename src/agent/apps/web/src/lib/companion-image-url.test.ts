import { describe, expect, it } from "vitest";
import { companionImageUrl } from "./companion-image-url.js";

describe("companion image deployment boundary", () => {
  it.each(["/", "/agent/", "/custom/app/"])("accepts sprites within %s", base => {
    const page = `https://app.example${base}app/bot`;
    expect(companionImageUrl(`${base}assets/mico.webp`, page, base, "https://app.example").href)
      .toBe(`https://app.example${base}assets/mico.webp`);
  });
  it("keeps development-only source images within the same app namespace", () => {
    expect(companionImageUrl("/@fs/work/core/mico.png", "http://127.0.0.1:5192/app", "/", "http://127.0.0.1:5192").pathname)
      .toBe("/@fs/work/core/mico.png");
  });
  it.each([
    "https://external.example/agent/assets/mico.png",
    "/assets/mico.png",
    "/agent-other/assets/mico.png",
    "/agent/api/account",
    "/agent/assets/../../api/account",
    "/agent/assets/%2e%2e/%2e%2e/api/account",
    "https://user:pass@app.example/agent/assets/mico.png",
    "file:///agent/assets/mico.png",
    "data:image/png;base64,AAAA",
  ])("rejects a non-static or out-of-scope source %s", source => {
    expect(() => companionImageUrl(source, "https://app.example/agent/app/bot", "/agent/", "https://app.example"))
      .toThrow("Unsupported companion image");
  });
  it("rejects a document base that changes the actual page origin", () => {
    expect(() => companionImageUrl("/agent/assets/mico.png", "https://external.example/", "/agent/", "https://app.example"))
      .toThrow("Unsupported companion image");
  });
});
