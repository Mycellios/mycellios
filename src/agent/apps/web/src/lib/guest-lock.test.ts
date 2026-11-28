// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGuestLock } from "./guest-lock";
import { onGuestAccountPrompt } from "./guest-mode";

let uninstall: () => void, stopPrompts: () => void;
const prompts = vi.fn();
const handlers = { locked: vi.fn(), allowed: vi.fn(), nested: vi.fn(), link: vi.fn(), shortcut: vi.fn(), outside: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <div data-guest-shell>
      <button id="locked" aria-label="Settings">Settings</button>
      <button id="allowed" data-guest-allowed>Send</button>
      <div data-guest-allowed><button id="nested" data-guest-locked aria-label="Actions">…</button></div>
      <div class="rk-chat-markdown"><a id="link" href="#answer">source</a><p id="text">reply</p></div>
      <textarea id="composer" data-guest-allowed></textarea>
    </div>
    <button id="outside">Dialog action</button>`;
  // The lock is installed before the shell, so it runs ahead of the shell's own handlers.
  uninstall = installGuestLock(window);
  stopPrompts = onGuestAccountPrompt(prompts);
  for (const [id, handler] of Object.entries(handlers)) document.getElementById(id)?.addEventListener("click", handler);
  window.addEventListener("keydown", handlers.shortcut);
});
afterEach(() => { uninstall(); stopPrompts(); window.removeEventListener("keydown", handlers.shortcut); document.body.innerHTML = ""; });

const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (id: string, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  document.getElementById(id)!.dispatchEvent(event);
  return event;
};

describe("guest lock", () => {
  it("locks every control by default and offers an account instead", () => {
    click("locked");
    expect(handlers.locked).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledWith("Settings");
    click("nested");
    expect(handlers.nested).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(2);
  });

  it("keeps the allowed controls, links in replies and anything outside the shell working", () => {
    click("allowed"); click("link"); click("outside");
    expect(handlers.allowed).toHaveBeenCalledOnce();
    expect(handlers.link).toHaveBeenCalledOnce();
    expect(handlers.outside).toHaveBeenCalledOnce();
    expect(prompts).not.toHaveBeenCalled();
  });

  it("withholds the shell's keyboard shortcuts but keeps typing and editing in the composer", () => {
    key("composer", { key: "a" });
    key("composer", { key: "c", ctrlKey: true });
    expect(handlers.shortcut).toHaveBeenCalledTimes(2);
    key("composer", { key: "k", ctrlKey: true });
    key("composer", { key: ",", metaKey: true });
    expect(handlers.shortcut).toHaveBeenCalledTimes(2);
    expect(key("locked", { key: "Enter" }).defaultPrevented).toBe(true);
    expect(prompts).toHaveBeenCalledWith("Settings");
  });

  it("blocks custom context menus except on reply text and the composer", () => {
    const menu = (id: string) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(menu("locked")).toBe(true);
    expect(menu("text")).toBe(false);
    expect(menu("composer")).toBe(false);
  });
});
