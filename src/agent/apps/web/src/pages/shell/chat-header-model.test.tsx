// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { Bot, Me } from "@rakazo/contracts";
import type { ChatModelChoice } from "@rakazo/core";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHeaderModel } from "./chat-header-model";

const fixtures = vi.hoisted(() => ({
  me: { userId: "user", spaceId: "space", defaultProvider: "opencode-go", defaultModel: "gpt-6-luna", needsModel: false },
  credentials: [{ id: "go", provider: "opencode-go", label: "OpenCode Go", modelId: "gpt-6-luna", hasKey: true }],
  catalog: [{ provider: "opencode-go", providerName: "OpenCode Go", id: "gpt-6-luna", label: "GPT-6 Luna", thinkingLevels: ["medium"] }],
  nativeModels: [] as Array<{id:string;label:string;isDefault:boolean;thinkingLevels:string[];fast:boolean}>,
  engines: [{ id: "codex", name: "Codex", available: true }, { id: "opencode", name: "OpenCode", available: true }],
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, i) => `${text}${i ? values[i - 1] : ""}${part}`, ""),
}) }));
vi.mock("../../lib/query", () => {
  const query = (key: string) => ({ queryOptions: () => ({ queryKey: [key] }), queryKey: () => [key] });
  return { useSpaceQueries: () => ({ me: query("me"), models: { credentials: query("credentials"), list: query("catalog") }, engines: { list: query("engines"), codexModels: query("nativeModels") } }) };
});
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [keyof typeof fixtures] }) => ({ data: fixtures[queryKey[0]], isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./chat-model-catalog", () => ({ ChatModelCatalog: () => null }));
vi.mock("./chat-model-picker", () => ({ ChatModelPicker: ({ choices, onChange }: { choices: ChatModelChoice[]; onChange: (key: string) => void }) =>
  <div>{choices.map(choice => <button key={choice.key} data-choice={choice.key} onClick={() => onChange(choice.key)}>{choice.label}</button>)}</div>,
}));
vi.mock("@rakazo/ui-web", () => ({
  Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button data-open onClick={() => onOpenChange(true)}>Open</button>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <button data-trigger>{children}</button>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => <button data-fast role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>Fast</button>,
  OptionSelect: () => <select aria-label="Thinking" />,
  Spinner: () => null,
}));
let root: Root;
let container: HTMLDivElement;
const save = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  i18n.load("en", {}); i18n.activate("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockClear();
  fixtures.nativeModels = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(engine: Bot["agentEngine"] = "codex") {
  act(() => root.render(<ChatHeaderModel bot={{ agentEngine: engine, modelProvider: null, modelId: null, thinkingLevel: "medium" } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
}
it("shows the installed provider instead of the unrelated general model", async () => {
  await render();
  expect(container.querySelector("[data-trigger]")?.textContent).toBe("ChatGPT");
  expect(container.querySelector('[aria-label="Thinking"]')).toBeNull();
  expect(container.querySelector('[data-choice="native-opencode::default"]')).toBeNull();
});
it("changes executor and saved model together when leaving a native provider", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="opencode-go::gpt-6-luna"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: "opencode-go", modelId: "gpt-6-luna", thinkingLevel: null });
});
it("uses the general saved connection when clearing a native selection", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice=""]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: null, modelId: null, thinkingLevel: null });
});
it("selects the installed account provider in the same menu", async () => {
  await render("pi");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="native-codex::default"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "codex", nativeConfig: { modelId: null, fastMode: false, thinkingLevel: null }, modelProvider: null, modelId: null, thinkingLevel: null });
});
it("preserves a legacy native provider as a visible recoverable selection", async () => {
  await render("opencode");
  expect(container.querySelector("[data-trigger]")?.textContent).toBe("OpenCode");
  expect(container.querySelector('[data-choice="native-opencode::default"]')).not.toBeNull();
});

it("saves Fast as native execution configuration, without changing reasoning effort", async () => {
  fixtures.nativeModels = [{ id: "native-model", label: "Native model", isDefault: true, thinkingLevels: ["medium"], fast: true }];
  await render("codex");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-fast]")!.click());
  expect(save).toHaveBeenCalledWith({ agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { fastMode: true } });
});
it("does not offer a functional Fast switch for a provider that has no native priority capability", async () => {
  await render("pi");
  expect(container.querySelector("[data-fast]")).toBeNull();
});
