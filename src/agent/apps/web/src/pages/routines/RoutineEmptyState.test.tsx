// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ BotAvatar: () => <span/>, Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
import { RoutineEmptyState } from "./RoutineEmptyState";
let root: Root, container: HTMLDivElement;
let reduce = false;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); reduce = false; vi.unstubAllGlobals(); });
function render(onCreate = vi.fn()) { act(() => root.render(<RoutineEmptyState bot={{ id: "mico", name: "Mico", color: "forest" } as Bot} onCreate={onCreate} />)); return onCreate; }
it("shows a labelled example and creates only after an explicit click", () => {
  const create = render();
  expect(container.textContent).toContain("Illustrative example");
  expect(container.querySelector('.rk-routine-example')?.getAttribute("aria-hidden")).toBe("true");
  expect(create).not.toHaveBeenCalled();
  act(() => [...container.querySelectorAll("button")].find(b => b.textContent?.includes("Create Routine"))!.click());
  expect(create).toHaveBeenCalledExactlyOnceWith();
});
it("lets the user pause and resume the motion without changing the draft", () => {
  const create = render();
  const preview = container.querySelector('[data-testid="routine-empty-state"]')!;
  expect(preview.getAttribute("data-animate")).toBe("true");
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Pause preview"]')!.click());
  expect(preview.getAttribute("data-animate")).toBe("false");
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play preview"]')!.click());
  expect(preview.getAttribute("data-animate")).toBe("true");
  expect(create).not.toHaveBeenCalled();
});
it("stops on a hidden page and respects reduced motion", () => {
  render();
  act(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(container.querySelector('[data-testid="routine-empty-state"]')?.getAttribute("data-animate")).toBe("false");
  reduce = true;
  act(() => root.render(<RoutineEmptyState key="reduced" bot={{ id: "mico", name: "Mico" } as Bot} onCreate={vi.fn()} />));
  expect(container.querySelector('[aria-label="Pause preview"]')).toBeNull();
});
