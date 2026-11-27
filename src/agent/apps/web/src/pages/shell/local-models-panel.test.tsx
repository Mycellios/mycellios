// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalModelInfo, LocalModelsStatus } from "@mycellios/contracts";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), "") }) }));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant: _variant, size: _size, ...p }: React.ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...p} />,
  Spinner: (p: { "aria-label"?: string }) => <span role="progressbar" aria-label={p["aria-label"]} />,
}));
const nativeMock = vi.hoisted(() => ({ bridge: undefined as unknown }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => nativeMock.bridge }));
import { LocalModelsPanel } from "./local-models-panel";

const model = (id: string, name: string, bytes: number, fit: LocalModelInfo["fit"], generation: number, installed = false): LocalModelInfo => ({
  id, name, publisher: "Qwen", license: "apache-2.0", source: "https://huggingface.co/x", bytes, contextWindow: 16384,
  installed, fit, speed: { prefill: generation * 15, generation, measured: false },
});
const base = (): LocalModelsStatus => ({
  supported: true, inspected: true,
  hardware: { gpu: { name: "AMD Radeon(TM) 890M Graphics", memoryMiB: 16444, kind: "integrated" }, memoryMiB: 31866, tier: "integrated" },
  recommended: "qwen3.5-2b", smarter: "gpt-oss-20b",
  models: [model("qwen3.5-0.8b", "Qwen3.5 0.8B", 532517120, "fast", 60), model("qwen3.5-2b", "Qwen3.5 2B", 1280835840, "fast", 26),
    model("gpt-oss-20b", "gpt-oss 20B", 12109566624, "slower", 15)],
});

let cleanup: () => Promise<void> = async () => {};
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await cleanup(); vi.unstubAllGlobals(); nativeMock.bridge = undefined; });
async function mount(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  cleanup = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node));
  return div;
}
const button = (div: HTMLElement, text: string) => [...div.querySelectorAll("button")].find((b) => b.textContent === text);

it("offers the fastest model with one button, installs it and assigns it to the Mico", async () => {
  let status = base();
  const bridge = {
    status: vi.fn(async () => status), inspect: vi.fn(), cancel: vi.fn(), remove: vi.fn(), unload: vi.fn(),
    install: vi.fn(async (id: string) => { status = { ...status, models: status.models.map((m) => m.id === id ? { ...m, installed: true } : m) }; }),
  };
  nativeMock.bridge = { localModels: bridge };
  const onUse = vi.fn();
  const div = await mount(<LocalModelsPanel onUse={onUse} />);
  expect(div.textContent).toContain("Qwen3.5 2B");
  expect(div.textContent).toContain("1.3 GB");
  expect(div.textContent).toContain("about 20 words per second");
  expect(div.textContent).not.toContain("gpt-oss 20B");
  await act(async () => button(div, "Install and use")!.click());
  expect(bridge.install).toHaveBeenCalledWith("qwen3.5-2b");
  expect(onUse).toHaveBeenCalledWith("qwen3.5-2b");
  expect(bridge.inspect).not.toHaveBeenCalled();
});

it("shows the smarter, slower model only on request", async () => {
  nativeMock.bridge = { localModels: { status: vi.fn(async () => base()), inspect: vi.fn(), install: vi.fn(), cancel: vi.fn(), remove: vi.fn(), unload: vi.fn() } };
  const div = await mount(<LocalModelsPanel onUse={vi.fn()} />);
  await act(async () => button(div, "Smarter, slower")!.click());
  expect(div.textContent).toContain("gpt-oss 20B");
  expect(div.textContent).toContain("Smarter but slower");
});

it("says the PC is too slow instead of offering a slow default", async () => {
  const status = { ...base(), recommended: undefined, smarter: undefined };
  nativeMock.bridge = { localModels: { status: vi.fn(async () => status), inspect: vi.fn(), install: vi.fn(), cancel: vi.fn(), remove: vi.fn(), unload: vi.fn() } };
  const div = await mount(<LocalModelsPanel onUse={vi.fn()} />);
  expect(div.textContent).toContain("This PC is too slow");
  expect(button(div, "Install and use")).toBeUndefined();
});

it("checks the PC's devices before recommending", async () => {
  let status = { ...base(), inspected: false };
  const inspect = vi.fn(async () => { status = base(); });
  nativeMock.bridge = { localModels: { status: vi.fn(async () => status), inspect, install: vi.fn(), cancel: vi.fn(), remove: vi.fn(), unload: vi.fn() } };
  await mount(<LocalModelsPanel onUse={vi.fn()} />);
  expect(inspect).toHaveBeenCalledOnce();
});

it("lists installed models and switches between them", async () => {
  const status = { ...base(), models: base().models.map((m) => ({ ...m, installed: m.id !== "gpt-oss-20b" })) };
  nativeMock.bridge = { localModels: { status: vi.fn(async () => status), inspect: vi.fn(), install: vi.fn(), cancel: vi.fn(), remove: vi.fn(), unload: vi.fn() } };
  const onUse = vi.fn();
  const div = await mount(<LocalModelsPanel value="qwen3.5-2b" onUse={onUse} />);
  const current = [...div.querySelectorAll("button[aria-pressed]")];
  expect(current.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["Qwen3.5 0.8BFast", "false"], ["Qwen3.5 2BFast", "true"]]);
  await act(async () => (current[0] as HTMLButtonElement).click());
  expect(onUse).toHaveBeenCalledWith("qwen3.5-0.8b");
  expect(button(div, "Add another model")).toBeDefined();
});
