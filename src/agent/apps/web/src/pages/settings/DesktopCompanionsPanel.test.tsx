// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_DESKTOP_COMPANIONS } from "@rakazo/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ bridge: undefined as any, save: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => mock.bridge }));
vi.mock("@lingui/react/macro", () => ({ Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), "") }) }));
import { DesktopCompanionsPanel } from "./DesktopCompanionsPanel";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); mock.bridge = undefined;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.save.mockImplementation(async value => value);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<DesktopCompanionsPanel kind="island" bots={[]} accountId="owner" spaces={[{ id: "current", name: "Work" }]} />)); }
function native() { mock.bridge = { companions: { state: async () => structuredClone(DEFAULT_DESKTOP_COMPANIONS), displays: async () => [], save: mock.save } }; }
async function slide(value: string) {
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Width"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, value);
    slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
}
it("offers a clearly marked browser preview with no native writes", async () => {
  await render(); expect(host.textContent).toContain("Interactive preview");
  await slide("125"); expect(host.textContent).toContain("125%"); expect(mock.save).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".island-preview-pill")).toHaveLength(2);
});
it("saves dimensions on release and preserves the previous value after a disk failure", async () => {
  native(); await render(); mock.save.mockRejectedValueOnce(Error("disk"));
  await slide("125"); expect(mock.save).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Width"]')?.value).toBe("100");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
});
it("keeps current spaces selected when changing the policy for future spaces", async () => {
  native(); await render(); const label = [...host.querySelectorAll("label")].find(e => e.textContent === "Show spaces added later")!;
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="${label.htmlFor}"]`)!.click());
  expect(mock.save).toHaveBeenLastCalledWith(expect.objectContaining({ island: expect.objectContaining({ futureScopes: false, scopes: { '["owner","current"]': true } }) }));
});

it("offers a dock preview and commits size with keyboard release", async () => {
  await act(async () => root.render(<DesktopCompanionsPanel kind="dock" bots={[]} />));
  expect(host.textContent).toContain("Changes here are not saved");
  const shown = [...host.querySelectorAll("label")].find(e => e.textContent === "Show the Mico dock")!;
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="${shown.htmlFor}"]`)!.click());
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Dock size"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "135"); slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => slider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })));
  expect(host.textContent).toContain("135%"); expect(mock.save).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLElement>(".mico-dock-preview-body")?.style.scale).toBe("1.35");
});
