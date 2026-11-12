// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopBehaviorSettings } from "@rakazo/contracts";
vi.mock("../../lib/query",()=>({useQueryUserId:()=>"user-1"}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({
  Label: (p: React.ComponentProps<"label">) => <label {...p} />,
  Button: (p: React.ComponentProps<"button">) => <button {...p} />,
  Switch: ({ checked, onCheckedChange, ...p }: React.ComponentProps<"button"> & { checked: boolean; onCheckedChange: (v: boolean) => void }) => <button {...p} type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />,
  OptionSelect: ({ value, options, onValueChange, ...p }: { value: string; options: { value: string; label: string }[]; onValueChange: (v: string) => void }) => <select {...p} value={value} onChange={e => onValueChange(e.target.value)}>{options.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select>,
}));
import { AppBehaviorPanel, ConversationExtras, ExternalLinksPreference, DevicePrivacySettings } from "./GeneralPreferences";
import {setGeneralPreferences} from "../../lib/general-preferences";
let unmount: () => Promise<void>;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await unmount?.(); delete window.rakazoDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  unmount = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node)); return div;
}
const initial: DesktopBehaviorSettings = { launchAtLogin: null, keepRunningInBackground: false, keepRemoteSessions:false,keepAwake: false, keepAwakeOnBattery: false, externalLinkTarget: "system" };
function toggle(div: HTMLElement, text: string) {
  const label = [...div.querySelectorAll("label")].find(label => label.textContent === text)!;
  return div.querySelector<HTMLButtonElement>(`[id="${label.htmlFor}"]`)!;
}
it("links optional analytics only to the selected account after measurement consent",async()=>{
  const div=await render(<DevicePrivacySettings />);
  const linked=div.querySelector<HTMLButtonElement>('[data-testid="analytics-account-toggle"]')!;
  expect(linked.disabled).toBe(true);expect(linked.getAttribute("aria-checked")).toBe("false");
  await act(async()=>setGeneralPreferences({productAnalytics:true}));
  expect(linked.disabled).toBe(false);await act(async()=>linked.click());
  expect(JSON.parse(localStorage.getItem("mycellios.general.v1")!).analyticsAccountId).toBe("user-1");
  await act(async()=>setGeneralPreferences({productAnalytics:false}));
  expect(linked.disabled).toBe(true);expect(linked.getAttribute("aria-checked")).toBe("false");
});
it("shows native capabilities on web as unavailable while keeping session restoration usable",async()=>{
  const div=await render(<AppBehaviorPanel />);
  expect(toggle(div,"Quick server reconnection").disabled).toBe(true);
  expect(toggle(div,"Open Mycellios at login").disabled).toBe(true);
  expect(toggle(div,"Keep the computer awake").disabled).toBe(true);
  const restore=toggle(div,"Restore the last workspace on startup");
  expect(restore.disabled).toBe(false);await act(async()=>restore.click());
  expect(JSON.parse(localStorage.getItem("mycellios.general.v1")!).restoreLastWorkspace).toBe(false);
});
it("saves quick reconnection through the native bridge",async()=>{
  const update=vi.fn(async patch=>({...initial,...patch}));
  Object.defineProperty(window,"rakazoDesktop",{configurable:true,value:{settings:{state:async()=>initial,update}}});
  const div=await render(<AppBehaviorPanel />);await act(async()=>toggle(div,"Quick server reconnection").click());
  expect(update).toHaveBeenCalledWith({keepRemoteSessions:true});
  expect(toggle(div,"Quick server reconnection").getAttribute("aria-checked")).toBe("true");
});
it("shows the external link destination on web without offering unavailable native behavior",async()=>{
  const div=await render(<ExternalLinksPreference />);
  const select=div.querySelector<HTMLSelectElement>('[data-testid="external-link-target"]')!;
  expect(select.value).toBe("system");expect(select.disabled).toBe(true);
  expect([...select.options].map(option=>option.value)).toEqual(["system"]);
  expect(div.textContent).toContain("Mycellios Desktop");
});

it("saves the native browser destination and restores the previously saved choice",async()=>{
  let saved={...initial,externalLinkTarget:"app" as const};
  const update=vi.fn(async patch=>{saved={...saved,...patch};return saved;});
  Object.defineProperty(window,"rakazoDesktop",{configurable:true,value:{settings:{state:async()=>saved,update}}});
  const div=await render(<ExternalLinksPreference />);
  const select=div.querySelector<HTMLSelectElement>('[data-testid="external-link-target"]')!;
  expect(select.value).toBe("app");expect(select.disabled).toBe(false);
  await act(async()=>{select.value="system";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(update).toHaveBeenCalledWith({externalLinkTarget:"system"});
  expect(select.value).toBe("system");
});

it("does not display a changed native destination when saving fails",async()=>{
  Object.defineProperty(window,"rakazoDesktop",{configurable:true,value:{settings:{state:async()=>initial,update:async()=>{throw Error("disk");}}}});
  const div=await render(<ExternalLinksPreference />);
  const select=div.querySelector<HTMLSelectElement>('[data-testid="external-link-target"]')!;
  await act(async()=>{select.value="app";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(select.value).toBe("system");expect(div.querySelector('[role="alert"]')).not.toBeNull();
});
it("hides unavailable startup controls and enables the battery choice only after a confirmed native save", async () => {
  const update = vi.fn(async patch => ({ ...initial, ...patch }));
  Object.defineProperty(window, "rakazoDesktop", { configurable: true, value: { settings: { state: async () => initial, update } } });
  const div = await render(<AppBehaviorPanel />);
  expect(div.textContent).not.toContain("Open Mycellios at login");
  expect(toggle(div, "Also on battery").disabled).toBe(true);
  await act(async () => toggle(div, "Keep the computer awake").click());
  expect(update).toHaveBeenCalledWith({ keepAwake: true });
  expect(toggle(div, "Also on battery").disabled).toBe(false);
});
it("blocks navigation while pending and preserves the old native state on failure", async () => {
  let fail: (error: Error) => void = () => {};
  const update = vi.fn(() => new Promise<DesktopBehaviorSettings>((_resolve, reject) => { fail = reject; }));
  Object.defineProperty(window, "rakazoDesktop", { configurable: true, value: { settings: { state: async () => initial, update } } });
  const busy = vi.fn(); const div = await render(<AppBehaviorPanel onBusyChange={busy} />);
  await act(async () => toggle(div, "Keep the computer awake").click());
  expect(busy).toHaveBeenLastCalledWith(true); expect(toggle(div, "Keep the computer awake").disabled).toBe(true);
  await act(async () => fail(new Error("disk")));
  expect(div.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(toggle(div, "Keep the computer awake").getAttribute("aria-checked")).toBe("false"); expect(busy).toHaveBeenLastCalledWith(false);
});
it("does not pretend a conversation preference was saved when local storage is full", async () => {
  const div = await render(<ConversationExtras />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
  await act(async () => div.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(div.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(div.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
});

it("lets the user change chat ordering without changing other preferences", async () => {
  const div = await render(<ConversationExtras />);
  const select = div.querySelector<HTMLSelectElement>('select[aria-label="Chat order"]')!;
  expect(select.value).toBe("manual");
  await act(async () => { select.value = "unread-group"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(select.value).toBe("unread-group");
  expect(JSON.parse(localStorage.getItem("mycellios.general.v1")!).sidebarChatOrder).toBe("unread-group");
});
