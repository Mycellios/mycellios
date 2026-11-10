// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
it("keeps keyboard focus during activity updates and removes previews when disabled", () => {
  document.body.innerHTML = '<main id="root"></main>';
  let publish: (state: any) => void = () => {};
  const select = vi.fn();
  const source = readFileSync(resolve(import.meta.dirname, "../../../desktop/src/companion.js"), "utf8");
  new Function("window", "document", source)({ companion: { onState: (fn: typeof publish) => { publish = fn; }, onHover: vi.fn(), select } }, document);
  const agent = { id: "bot-a", name: "Mico <script>bad()</script>", color: "#3f9f78", status: "Ready", working: false, unread: true, result: "Private preview" };
  const prefs = { dock: { edge: "right", results: true, autoHide: false, edgeStrip: true } };
  publish({ kind: "dock", prefs, snapshot: { theme: "light", agents: [agent] } });
  const button = document.querySelector("button")!; button.focus();
  expect(document.querySelector("script")).toBeNull(); expect(button.textContent).toContain("<script>");
  publish({ kind: "dock", prefs, snapshot: { theme: "light", agents: [{ ...agent, working: true }] } });
  expect(document.activeElement).toBe(button); expect(document.querySelector("button")).toBe(button);
  publish({ kind: "dock", prefs: { dock: { ...prefs.dock, results: false } }, snapshot: { theme: "light", agents: [agent] } });
  expect(document.body.textContent).not.toContain("Private preview");
  button.click(); expect(select).toHaveBeenCalledWith("bot-a");
  publish({ kind: "dock", prefs, snapshot: { theme: "light", agents: [] } }); expect(document.querySelector("button")).toBeNull();
});
