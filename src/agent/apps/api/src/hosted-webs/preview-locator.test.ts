import { describe, expect, it } from "vitest";
import { PREVIEW_LOCATOR_SCRIPT, withPreviewLocator } from "./preview-locator.js";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("withPreviewLocator", () => {
  it("adds the locator before the closing body", () => {
    const html = text(
      withPreviewLocator(new TextEncoder().encode("<html><body><p>x</p></BODY></html>")),
    );
    expect(html).toBe(`<html><body><p>x</p>${PREVIEW_LOCATOR_SCRIPT}</BODY></html>`);
  });

  it("appends it to fragments", () => {
    expect(text(withPreviewLocator(new TextEncoder().encode("<p>x</p>")))).toBe(
      `<p>x</p>${PREVIEW_LOCATOR_SCRIPT}`,
    );
  });

  it("answers only its parent and sends only a rectangle", () => {
    expect(PREVIEW_LOCATOR_SCRIPT).toContain("e.source!==parent");
    expect(PREVIEW_LOCATOR_SCRIPT).toContain('type:"mycellios.located",id:d.id,rect');
  });
});
