// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFocusInput } from "./focus-input";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function setup(mobile = true) {
  vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
  document.body.innerHTML = '<label for="message">Message</label><textarea id="message"></textarea><button>Menu</button><input id="search">';
  dispose = installFocusInput();
  return { field: document.querySelector("textarea")!, menu: document.querySelector("button")!, search: document.querySelector("input")! };
}
function tap(element: Element) { element.dispatchEvent(new Event("pointerdown", { bubbles: true })); }
describe("mobile typing intent", () => {
  it("requires a field tap and hides the keyboard on other actions without losing the draft", () => {
    const { field, menu, search } = setup();
    field.value = "Unsent draft";
    field.focus(); expect(document.activeElement).not.toBe(field);
    tap(field); field.focus(); expect(document.activeElement).toBe(field);
    tap(menu); expect(document.activeElement).not.toBe(field);
    field.focus(); expect(document.activeElement).not.toBe(field);
    search.focus(); expect(document.activeElement).not.toBe(search);
    tap(search); search.focus(); expect(document.activeElement).toBe(search);
    expect(field.value).toBe("Unsent draft");
  });
  it("keeps typing open for controls beside the field", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.body.innerHTML = '<fieldset><textarea></textarea><button>Send</button></fieldset><button>Menu</button>';
    dispose = installFocusInput();
    const field = document.querySelector("textarea")!;
    const [send, menu] = document.querySelectorAll("button");
    tap(field); field.focus();
    tap(send!); expect(document.activeElement).toBe(field);
    field.blur(); field.focus(); expect(document.activeElement).toBe(field);
    tap(menu!); expect(document.activeElement).not.toBe(field);
  });
  it("supports labels and hardware keyboard navigation", () => {
    const { field, search } = setup();
    tap(document.querySelector("label")!); field.focus(); expect(document.activeElement).toBe(field);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    search.focus(); expect(document.activeElement).toBe(search);
  });
  it("preserves desktop autofocus", () => {
    const { field } = setup(false);
    field.focus(); expect(document.activeElement).toBe(field);
  });
});
