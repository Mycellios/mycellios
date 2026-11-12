// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot, MicoSettingsState } from "@rakazo/contracts";
import type { RpcClient } from "../../lib/rpc";
const mocked = vi.hoisted(() => ({ client: {} as RpcClient }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => mocked.client }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((out, text, i) => out + text + (values[i] ?? ""), "") }) }));
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: () => null,
  Button: ({ children, variant: _, size: __, ...props }: Record<string, unknown> & { children: ReactNode }) => <button {...props}>{children}</button>,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Switch: ({ checked, onCheckedChange, ...props }: Record<string, unknown> & { checked: boolean; onCheckedChange: (value: boolean) => void }) => <button {...props} role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />,
  OptionSelect: ({ options, value, onValueChange, ...props }: Record<string, unknown> & { options: { value: string; label: string }[]; value: string; onValueChange: (value: string) => void }) => <select {...props} value={value} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock("../../components/SettingsRows", () => ({ SettingsGroup: ({ title, children }: { title?: ReactNode; children: ReactNode }) => <section>{title}{children}</section>, SettingsRow: ({ label, description, control }: { label: ReactNode; description: ReactNode; control: ReactNode }) => <div>{label}{description}{control}</div> }));
import { MicoBehaviorSettings } from "./MicoBehaviorSettings";
let root: Root, el: HTMLDivElement;
const bots = [{ id: "one", name: "Mico One", color: "green" }, { id: "two", name: "Mico Two", color: "purple" }] as Bot[];
const initial = (): MicoSettingsState => ({ ownerId: "owner", spaceId: "space", revision: 1, defaults: { localScripts: false, agentNewChat: false, showPlan: false, gitCoauthor: true }, bots: [{ id: "one", preferences: {} }, { id: "two", preferences: { showPlan: true } }] });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); el = document.createElement("div"); document.body.append(el); root = createRoot(el); delete window.rakazoDesktop; });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
const busy = vi.fn();
async function render() { await act(async () => root.render(<MicoBehaviorSettings bots={bots} onBusyChange={busy} />)); }
async function open(text: string) { await act(async () => [...el.querySelectorAll("button")].find(button => button.parentElement?.textContent?.includes(text) && button.textContent?.startsWith("Enabled for"))!.click()); }
it("saves defaults and inheritance with the loaded revision; bulk changes target one preference", async () => {
  let state = initial();
  const updateMicos = vi.fn(async (input) => { state = { ...state, revision: state.revision + 1, defaults: { ...state.defaults, ...input.patch } }; return state; });
  mocked.client = { preferences: { micos: vi.fn(async () => state), updateMicos } } as unknown as RpcClient;
  await render(); await open("Show a plan");
  await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Show a plan before long tasks"]')!.click());
  expect(updateMicos).toHaveBeenLastCalledWith({ kind: "defaults", revision: 1, patch: { showPlan: true } });
  const select = el.querySelector<HTMLSelectElement>('[aria-label="Show a plan before long tasks · Mico One"]')!;
  await act(async () => { select.value = "off"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(updateMicos).toHaveBeenLastCalledWith({ kind: "bot", revision: 2, botId: "one", key: "showPlan", value: false });
  const all = el.querySelector<HTMLSelectElement>('[aria-label="Apply to all"]')!;
  await act(async () => { all.value = "inherit"; all.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(updateMicos).toHaveBeenLastCalledWith({ kind: "all", revision: 3, key: "showPlan", value: null });
});
it("displays save conflicts and reloads actual values", async () => {
  const updateMicos = vi.fn().mockRejectedValue(new Error("conflict")); const micos = vi.fn(async () => initial());
  mocked.client = { preferences: { micos, updateMicos } } as unknown as RpcClient;
  await render(); await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Mention Mycellios in commits"]')!.click());
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("Could not save"); expect(micos).toHaveBeenCalledTimes(2);
  expect(el.querySelector('[aria-label="Mention Mycellios in commits"]')?.getAttribute("aria-checked")).toBe("true");
});
it("cannot show prior account/Space settings or accept late responses after a scope change", async () => {
  let resolve!: (state: MicoSettingsState) => void;
  mocked.client = { preferences: { micos: () => new Promise<MicoSettingsState>(r => { resolve = r; }) } } as unknown as RpcClient;
  await render();
  mocked.client = { preferences: { micos: async () => ({ ...initial(), bots: [] }) } } as unknown as RpcClient;
  await render(); await act(async () => resolve({ ...initial(), defaults: { ...initial().defaults, showPlan: true } }));
  expect(el.textContent).not.toContain("Default: Enabled");
});
it("web can save account policy but native computer controls remain unavailable", async () => {
  mocked.client = { preferences: { micos: async () => initial() } } as unknown as RpcClient;
  await render(); await open("Local scripts");
  expect(el.textContent).toContain("Open Mycellios Desktop");
  expect(el.querySelector<HTMLButtonElement>('[aria-label="Allow local scripts on this computer"]')!.disabled).toBe(true);
  expect(el.querySelector<HTMLSelectElement>('[aria-label="Requests per hour"]')!.disabled).toBe(true);
});
