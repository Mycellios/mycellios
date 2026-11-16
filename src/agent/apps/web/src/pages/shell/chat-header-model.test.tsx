// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { Bot, Me, ModelCredential, ModelCatalogEntry } from "@rakazo/contracts";
import type { ChatModelChoice } from "@rakazo/core";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHeaderModel } from "./chat-header-model";

const fixtures = vi.hoisted(() => ({
  me: { userId: "user", spaceId: "space", defaultProvider: "opencode-go", defaultModel: "gpt-6-luna", needsModel: false },
  credentials: [{ id: "go", provider: "opencode-go", label: "OpenCode Go", modelId: "gpt-6-luna", hasKey: true }] as ModelCredential[],
  mycelliosCatalog: [] as ModelCatalogEntry[],
  catalog: [{ provider: "opencode-go", providerName: "OpenCode Go", id: "gpt-6-luna", label: "GPT-6 Luna", thinkingLevels: ["medium"] }],
  nativeModels: [] as Array<{id:string;label:string;isDefault:boolean;thinkingLevels:string[];fast:boolean}>,
  engines: [{ id: "codex", name: "Codex", available: true }, { id: "opencode", name: "OpenCode", available: true }],
}));
const connect = vi.hoisted(() => vi.fn());
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, i) => `${text}${i ? values[i - 1] : ""}${part}`, ""),
}) }));
vi.mock("../../lib/query", () => {
  const query = (key: string) => ({ queryOptions: () => ({ queryKey: [key] }), queryKey: () => [key] });
  return { writeSaved: async (_client: unknown, _key: unknown, apply: () => unknown) => apply(), useSpaceQueries: () => ({ me: query("me"), models: { credentials: query("credentials"), list: query("catalog") }, engines: { list: query("engines"), codexModels: query("nativeModels") } }) };
});
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => ({ models: { credentials: async () => fixtures.credentials, connect } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [keyof typeof fixtures | "mycellios-chat-catalog"] }) => ({ data: queryKey[0] === "mycellios-chat-catalog" ? fixtures.mycelliosCatalog : fixtures[queryKey[0]], isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./chat-model-catalog", () => ({ ChatModelCatalog: () => null }));
vi.mock("./chat-model-picker", () => ({ ChatModelPicker: ({ choices, value, onChange, initialProvider }: { choices: (ChatModelChoice & { unavailable?: boolean })[]; value: string; onChange: (key: string) => void; initialProvider?: string | null }) =>
  <div data-picker-provider={initialProvider}>{choices.map(choice => <button key={choice.key} data-choice={choice.key} data-selected={choice.key === value} disabled={choice.unavailable} onClick={() => onChange(choice.key)}>{choice.label}</button>)}</div>,
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
  connect.mockReset().mockImplementation(async (input: { credentialId: string }) => ({ ...fixtures.credentials.find(entry => entry.id === input.credentialId), ...input }));
  fixtures.nativeModels = [];
  fixtures.mycelliosCatalog = [];
  fixtures.credentials.splice(1);
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
it.each(["pi", "codex"] as const)("explores credits without saving or connecting from %s", async engine => {
  await render(engine);
  const explore = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Explore models with my credits");
  expect(explore).toBeDefined();
  await act(async () => explore!.click());
  expect(container.querySelector("[data-picker-provider]")?.getAttribute("data-picker-provider")).toBe("Mycellios");
  expect(container.textContent).not.toContain("Explore models with my credits");
  expect(save).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});
it("changes executor and saved model together when leaving a native provider", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="opencode-go::gpt-6-luna"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: "opencode-go", modelId: "gpt-6-luna", thinkingLevel: null });
});
it("selects the default model only for this Mico instead of changing the shared default", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="opencode-go::gpt-6-luna"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: "opencode-go", modelId: "gpt-6-luna", thinkingLevel: null });
});
it("shows the effective inherited model once without a separate inherit row or shared-default editor", async () => {
  await render("pi");
  expect(container.querySelector('[data-choice=""]')).toBeNull();
  expect(container.querySelectorAll('[data-choice="opencode-go::gpt-6-luna"]')).toHaveLength(1);
  expect(container.querySelector('[data-choice="opencode-go::gpt-6-luna"]')?.getAttribute("data-selected")).toBe("true");
  expect(container.textContent).not.toMatch(/Use general model|Change general model|For Micos using/);
  expect(save).not.toHaveBeenCalled();
});
it("lists every model granted by the connected provider without a catalog detour", async () => {
  fixtures.catalog.push({ provider: "opencode-go", providerName: "OpenCode Go", id: "second-model", label: "Second model", thinkingLevels: [] });
  try {
    await render("pi");
    const alternative = container.querySelector<HTMLButtonElement>('[data-choice="opencode-go::second-model"]');
    expect(alternative).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    await act(async () => alternative!.click());
    expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: "opencode-go", modelId: "second-model", thinkingLevel: null });
  } finally {
    fixtures.catalog.pop();
  }
});
it("lists the live Mycellios catalog instead of saved enabled IDs without changing a Mico on open", async () => {
  fixtures.credentials.push({ id: "myc", provider: "openai-compatible", label: "Mycellios", baseUrl: "https://www.mycellios.com/v1", modelId: "mycellios/managed/antseed/deepseek-v4-flash", enabledModelIds: ["mycellios/managed/antseed/deepseek-v4-flash"], hasKey: true } as ModelCredential);
  fixtures.mycelliosCatalog = ["deepseek-v4-flash", "another-model"].map(id => ({ provider: "openai-compatible", providerName: "Mycellios", id: `mycellios/managed/antseed/${id}`, label: id, billing: "Uses your Mycellios credits" }));
  await render("pi");
  expect(container.querySelector('[data-choice="openai-compatible::mycellios/managed/antseed/another-model"]')).not.toBeNull();
  expect(save).not.toHaveBeenCalled();
});
it.each([false, true])("keeps a readable Mycellios header before and after discovery (Mico override: %s)", async (override) => {
  const modelId = "mycellios/managed/antseed/deepseek-v4-flash";
  const previous = { ...fixtures.me };
  Object.assign(fixtures.me, { defaultProvider: "openai-compatible", defaultModel: modelId });
  fixtures.credentials.push({ id: "myc", provider: "openai-compatible", label: "Mycellios", baseUrl: "https://www.mycellios.com/v1", modelId, hasKey: true } as ModelCredential);
  try {
    act(() => root.render(<ChatHeaderModel bot={{ agentEngine: "pi", modelProvider: override ? "openai-compatible" : null, modelId: override ? modelId : null } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
    const header = () => container.querySelector<HTMLButtonElement>("[data-trigger]")!;
    expect(header().textContent).toBe("deepseek-v4-flash");
    const icon = header().querySelector("img")?.getAttribute("src");
    expect(icon).toContain("/mycellios/app-icon-v2-192.png");
    fixtures.mycelliosCatalog = [{ provider: "openai-compatible", providerName: "Mycellios", id: modelId, label: "deepseek-v4-flash", billing: "Uses your Mycellios credits" }];
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
    expect(header().textContent).toBe("deepseek-v4-flash");
    expect(header().querySelector("img")?.getAttribute("src")).toBe(icon);
    expect(save).not.toHaveBeenCalled();
  } finally { Object.assign(fixtures.me, previous); }
});
it("keeps an absent saved Mycellios model disabled instead of silently selecting a replacement", async () => {
  fixtures.credentials.push({ id: "myc", provider: "openai-compatible", label: "Mycellios", baseUrl: "https://www.mycellios.com/v1", modelId: "mycellios/managed/antseed/deepseek-v4-flash", hasKey: true } as ModelCredential);
  const me = { ...fixtures.me, defaultProvider: "openai-compatible", defaultModel: "mycellios/managed/antseed/deepseek-v4-flash" } as Me;
  act(() => root.render(<ChatHeaderModel bot={{ agentEngine: "pi", modelProvider: null, modelId: null } as Bot} me={me} onSave={save} onConnections={() => {}} />));
  // The mocked me query must use the same owner preference as this render.
  const previous = { ...fixtures.me };
  Object.assign(fixtures.me, me);
  try {
    await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
    const stale = container.querySelector<HTMLButtonElement>('[data-choice="openai-compatible::mycellios/managed/antseed/deepseek-v4-flash"]');
    expect(stale?.disabled).toBe(true);
    expect(stale?.getAttribute("data-selected")).toBe("true");
    expect(save).not.toHaveBeenCalled();
  } finally { Object.assign(fixtures.me, previous); }
});
it("enables a live Mycellios choice with its owned connection while preserving the shared default and prior models", async () => {
  const old = "mycellios/managed/antseed/deepseek-v4-flash", next = "mycellios/managed/antseed/next";
  fixtures.credentials.push({ id: "myc", provider: "openai-compatible", label: "Mycellios", baseUrl: "https://www.mycellios.com/v1", modelId: old, enabledModelIds: [old], hasKey: true } as ModelCredential);
  fixtures.mycelliosCatalog = [{ provider: "openai-compatible", providerName: "Mycellios", id: next, label: "Next", billing: "Uses your Mycellios credits" }];
  await render("pi");
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-choice="openai-compatible::${next}"]`)!.click());
  expect(connect).toHaveBeenCalledExactlyOnceWith({ provider: "openai-compatible", credentialId: "myc", baseUrl: "https://www.mycellios.com/v1", modelId: old, enabledModelIds: [old, next], makeDefault: false }, { context: { spaceId: "space" } });
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "pi", nativeConfig: null, modelProvider: "openai-compatible", modelId: next, thinkingLevel: null });
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
  expect(container.querySelector('[data-choice="native-codex::default"]')).toBeNull();
  expect(container.querySelector('[data-choice="native-codex::native-model"]')?.getAttribute("data-selected")).toBe("true");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-fast]")!.click());
  expect(save).toHaveBeenCalledWith({ agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { fastMode: true } });
});
it("does not offer a functional Fast switch for a provider that has no native priority capability", async () => {
  await render("pi");
  expect(container.querySelector("[data-fast]")).toBeNull();
});
