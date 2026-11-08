import { describe, expect, it, vi } from "vitest";
import { installWindowChrome } from "./window-chrome.js";

describe("native window frame", () => {
  it("does not cover the page with a caption strip on any platform", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const win = {
        setContentView: vi.fn(),
        setTitleBarOverlay: vi.fn(),
        on: vi.fn(),
        webContents: { on: vi.fn(), once: vi.fn() },
      };
      installWindowChrome(win as never, platform);
      expect(win.setContentView).not.toHaveBeenCalled();
      expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
      expect(win.on).not.toHaveBeenCalled();
      expect(win.webContents.on).not.toHaveBeenCalled();
    }
  });
});
