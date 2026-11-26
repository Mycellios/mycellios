// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error The extension is plain JavaScript without declarations.
import { snapshotPage } from "../../../apps/browser-extension/page-agent.js";

describe("the extension's page snapshot", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 10, height: 10 } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("lists elements with refs, hides secret and payment values and marks nothing in the page", () => {
    document.title = "Checkout";
    document.body.innerHTML = `
      <a href="/cart">Cart</a>
      <label for="q">Search</label><input id="q" value="laptop">
      <input type="password" name="pw" value="hunter2">
      <input name="card" autocomplete="cc-number" value="4111111111111111">
      <input type="hidden" name="csrf" value="token">
      <button>Pay</button>`;
    const page = snapshotPage(48_000) as { title: string; text: string; truncated: boolean };
    expect(page.title).toBe("Checkout");
    expect(page.text).toContain('- link "Cart" [e1]');
    expect(page.text).toContain('- textbox "Search" [e2] value="laptop"');
    expect(page.text).toContain("value=(hidden)");
    expect(page.text).not.toContain("hunter2");
    expect(page.text).not.toContain("4111111111111111");
    expect(page.text).not.toContain("token");
    expect(page.text).toContain('- button "Pay"');
    expect(document.body.innerHTML).not.toContain("e1");
  });

  it("cuts a long page and says so", () => {
    document.body.innerHTML = `<button>${"x".repeat(100)}</button>`;
    const page = snapshotPage(60) as { text: string; truncated: boolean };
    expect(page.text.length).toBe(60);
    expect(page.truncated).toBe(true);
  });
});
