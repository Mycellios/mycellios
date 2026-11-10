import { expect, it } from "vitest";
import { validDesktopIcon } from "./appearance-settings";
it("accepts bounded PNG icons and rejects paths, SVG, malformed and oversized images before native decoding", () => {
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write("IHDR", 12); png.writeUInt32BE(128, 16); png.writeUInt32BE(128, 20);
  expect(validDesktopIcon("data:image/png;base64," + png.toString("base64"))).toBe(true);
  png.writeUInt32BE(100_000, 16); expect(validDesktopIcon("data:image/png;base64," + png.toString("base64"))).toBe(false);
  for (const value of ["C:/private.png", "data:image/svg+xml,<svg/>", "data:image/png;base64,abc", "https://example.com/icon.png", {}]) expect(validDesktopIcon(value)).toBe(false);
  expect(validDesktopIcon(null)).toBe(true);
});
