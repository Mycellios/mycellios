// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join(""), i18n: { locale: "en" } }) }));
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: () => <span/>, Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>, DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>, DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
}));
import { ScheduleEmptyState } from "./ScheduleEmptyState";
let root: Root, container: HTMLDivElement;
let reduce = false;
const create = vi.fn(), createMico = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); create.mockClear(); createMico.mockClear();
  vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); reduce = false; vi.unstubAllGlobals(); });
function render(bots = [{ id: "mico-a", name: "Ada" } as Bot]) { act(() => root.render(<ScheduleEmptyState bots={bots} anchor="2026-11-10" today="2026-11-10" onCreateRoutine={create} onCreateMico={createMico} />)); }
function button(text: string) { return [...container.querySelectorAll("button")].find(b => b.textContent?.includes(text))!; }
it("shows inert labelled examples and opens the sole Mico's draft directly", () => {
  render(); expect(container.textContent).toContain("Illustrative schedule");
  expect(container.querySelector('.rk-schedule-demo')?.getAttribute("aria-hidden")).toBe("true");
  expect(create).not.toHaveBeenCalled(); act(() => button("Create Routine").click());
  expect(create).toHaveBeenCalledExactlyOnceWith("mico-a");
});
it("waits for the user to choose a Mico when there is more than one", () => {
  render([{ id: "mico-a", name: "Ada" } as Bot, { id: "mico-b", name: "Bruno" } as Bot]);
  expect(create).not.toHaveBeenCalled(); act(() => button("Bruno").click());
  expect(create).toHaveBeenCalledExactlyOnceWith("mico-b");
});
it("provides a useful next step when no Mico exists", () => {
  render([]); act(() => button("Create a Mico").click()); expect(createMico).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled();
});
it("pauses the preview on request and when the page is hidden", () => {
  render(); const preview = container.querySelector('[data-testid="schedule-empty-state"]')!;
  expect(preview.getAttribute("data-animate")).toBe("true"); act(() => button("Pause preview").click());
  expect(preview.getAttribute("data-animate")).toBe("false"); act(() => button("Play preview").click());
  act(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(preview.getAttribute("data-animate")).toBe("false");
});
it("keeps a stable calendar under reduced motion", () => {
  reduce = true; render();
  expect(container.querySelector('[data-testid="schedule-empty-state"]')?.getAttribute("data-animate")).toBe("false");
  expect(container.querySelector('[aria-label="Pause preview"]')).toBeNull();
});
