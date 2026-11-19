import { describe, expect, it } from "vitest";
import { imageAspectRatioOf, pngPixelSize } from "./image-generation-card.js";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("image generation card sizing", () => {
  it("reads the size from a PNG header", () => {
    expect(pngPixelSize(pngHeader(1024, 1536))).toEqual({ width: 1024, height: 1536 });
  });

  it("rejects bytes that are not a usable PNG", () => {
    expect(pngPixelSize(new Uint8Array(10))).toBeNull();
    const jpeg = pngHeader(10, 10);
    jpeg[0] = 0xff;
    expect(pngPixelSize(jpeg)).toBeNull();
    expect(pngPixelSize(pngHeader(0, 10))).toBeNull();
    expect(pngPixelSize(pngHeader(70_000, 10))).toBeNull();
  });

  it("names the shape and treats near-square pictures as square", () => {
    expect(imageAspectRatioOf({ width: 1024, height: 1536 })).toBe("portrait");
    expect(imageAspectRatioOf({ width: 1536, height: 1024 })).toBe("landscape");
    expect(imageAspectRatioOf({ width: 1024, height: 1000 })).toBe("square");
  });
});
