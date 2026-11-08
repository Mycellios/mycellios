// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyHostedChrome } from "./hosted-chrome";

describe("hosted sign-in chrome", () => {
  beforeEach(() => localStorage.clear());

  it("uses the saved dark appearance and Hebrew direction", () => {
    localStorage.setItem("rakazo.uiAppearance", "dark");
    localStorage.setItem("rakazo.uiLocale", "he");
    expect(applyHostedChrome(document.documentElement, localStorage, true)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("follows the system appearance only when that preference is saved", () => {
    localStorage.setItem("rakazo.uiAppearance", "system");
    expect(applyHostedChrome(document.documentElement, localStorage, false)).toBe("dark");
    localStorage.setItem("rakazo.uiAppearance", "light");
    expect(applyHostedChrome(document.documentElement, localStorage, false)).toBe("light");
  });
});
