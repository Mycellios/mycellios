// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@rakazo/contracts";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), "") }) }));
vi.mock("./DeviceVoiceSettings", () => ({ DeviceVoiceSettings: () => null }));
vi.mock("./MobileSessions", () => ({ MobileSessions: () => null }));
vi.mock("../../components/ServerLinkCode", () => ({ ServerLinkCode: () => null }));
vi.mock("../../components/MobileInstallOffer", () => ({ MobileInstallOffer: () => null, mobileInstallUrl: () => "" }));
vi.mock("../SkillLibrarySettings", () => ({ SkillLibrarySettings: () => null }));
vi.mock("@rakazo/ui-web/components/ui/disclosure", () => ({ Disclosure: ({ summary, children }: { summary: string; children: ReactNode }) => <details><summary>{summary}</summary>{children}</details> }));
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: () => <span />,
  Input: (p: React.ComponentProps<"input">) => <input {...p} />,
  Button: ({ variant: _v, size: _s, ...p }: React.ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...p} />,
  OptionSelect: ({ value, options, onValueChange, ...p }: { value: string; options: { value: string; label: string }[]; onValueChange: (v: string) => void }) => <select {...p} value={value} onChange={e => onValueChange(e.target.value)}>{options.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select>,
}));
import { MicosSettingsPanel } from "./CompanionPanels";
const bots = Array.from({ length: 6 }, (_, i) => ({ id: `mico-${i}`, name: i ? `Mico ${i}` : "Investigación", color: "green" } as Bot));
let cleanup: () => Promise<void>;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); });
async function mount(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  cleanup = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node)); return div;
}
it("keeps individual controls collapsed and filters accented names", async () => {
  const div = await mount(<MicosSettingsPanel bots={bots} />);
  expect(div.querySelector("details")?.open).toBe(false);
  const search = div.querySelector<HTMLInputElement>('input[aria-label="Search Micos"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "investigacion");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(div.textContent).toContain("Investigación");
  expect(div.textContent).not.toContain("Mico 1");
});
it("blocks navigation during an individual save and retains inheritance after a failure", async () => {
  let reject: (error: Error) => void = () => {};
  const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const busy = vi.fn(); const div = await mount(<MicosSettingsPanel bots={bots} onModels={() => {}} onOpen={() => {}} onBusyMessageModeChange={save} onBusyChange={busy} />);
  const select = div.querySelector<HTMLSelectElement>('select[aria-label="Messages while Investigación works"]')!;
  await act(async () => { select.value = "steer"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(save).toHaveBeenCalledWith("mico-0", "steer");
  expect(busy).toHaveBeenLastCalledWith(true);
  expect([...div.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => reject(new Error("offline")));
  expect(div.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(select.value).toBe("inherit");
  expect(busy).toHaveBeenLastCalledWith(false);
});
