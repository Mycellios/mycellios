// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { Bot, Me, ModelCredential, ModelCatalogEntry, NativeEngineUpdate } from "@mycellios/contracts";
import type { ChatModelChoice } from "@mycellios/core";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHeaderModel, HEADER_MODEL_REUSE_MS } from "./chat-header-model";

const fixtures = vi.hoisted(() => ({
  dataUpdatedAt: Date.now(),
  me: { userId: "user", spaceId: "space", defaultProvider: "opencode-go", defaultModel: "gpt-6-luna", needsModel: false },
  credentials: [{ id: "go", provider: "opencode-go", label: "OpenCode Go", modelId: "gpt-6-luna", hasKey: true }] as ModelCredential[],
  mycelliosCatalog: [] as ModelCatalogEntry[],
  catalog: [{ provider: "opencode-go", providerName: "OpenCode Go", id: "gpt-6-luna", label: "GPT-6 Luna", thinkingLevels: ["medium"] }],
  nativeModels: [] as Array<{id:string;label:string;isDefault:boolean;thinkingLevels:string[];fast:boolean}>,
  engines: { computer: "server", engines: ["codex", "opencode"] } as { computer: string; engines: string[]; signedOut?: string[]; account?: boolean;
    models?: Record<string, Array<{ id: string; label: string; isDefault: boolean; thinkingLevels: string[]; fast: boolean }>>;
    install?: boolean; installable?: Array<{ engine: string; version: string; source: string; package: string; bytes: number }>;
    installing?: Array<{ engine: string; state: string; receivedBytes?: number; totalBytes?: number; error?: string }>;
    updates?: NativeEngineUpdate[] },
}));
const connect = vi.hoisted(() => vi.fn());
const account = vi.hoisted(() => vi.fn());
const install = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const queryCalls = vi.hoisted(() => [] as Array<{ queryKey: string[]; staleTime?: number; refetchOnMount?: unknown; enabled?: boolean }>);
const fetching = vi.hoisted(() => ({ value: false }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, i) => `${text}${i ? values[i - 1] : ""}${part}`, ""),
}) }));
vi.mock("../../lib/query", () => {
  const query = (key: string) => ({ queryOptions: () => ({ queryKey: [key] }), queryKey: () => [key] });
  return { writeSaved: async (_client: unknown, _key: unknown, apply: () => unknown) => apply(), useSpaceQueries: () => ({ me: query("me"), models: { credentials: query("credentials"), list: query("catalog") }, engines: { forBot: query("engines"), codexModels: query("nativeModels") } }) };
});
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => ({ models: { credentials: async () => fixtures.credentials, connect }, engines: { account, install } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: [keyof typeof fixtures | "mycellios-chat-catalog"]; staleTime?: number; refetchOnMount?: unknown }) => (queryCalls.push(options), { data: options.queryKey[0] === "mycellios-chat-catalog" ? fixtures.mycelliosCatalog : fixtures[options.queryKey[0]], isPending: false, isFetching: fetching.value, refetch, dataUpdatedAt: fixtures.dataUpdatedAt }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./chat-model-catalog", () => ({ ChatModelCatalog: () => null }));
vi.mock("./chat-model-picker", () => ({ ChatModelPicker: ({ choices, value, onChange, initialProvider, onProviderChange }: { choices: (ChatModelChoice & { unavailable?: boolean; unavailableLabel?: string })[]; value: string; onChange: (key: string) => void; initialProvider?: string | null; onProviderChange?: (provider: string) => void }) =>
  <div data-picker-provider={initialProvider}>{[...new Set(choices.map(choice => choice.providerLabel))].map(name =>
    <button key={`provider-${name}`} data-provider={name} aria-label={name} onClick={() => onProviderChange?.(name!)} />)}{choices.map(choice => <button key={choice.key} data-choice={choice.key} data-selected={choice.key === value} data-unavailable={choice.unavailableLabel} disabled={choice.unavailable} onClick={() => onChange(choice.key)}>{choice.label}</button>)}</div>,
}));
vi.mock("@mycellios/ui-web", () => ({
  Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button data-open onClick={() => onOpenChange(true)}>Open</button>{children}</div>,
  PopoverTrigger: ({ children, onFocus }: { children: ReactNode; onFocus?: () => void }) => <button data-trigger onFocus={onFocus}>{children}</button>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Switch: ({ checked, onCheckedChange, "aria-label": label }: { checked: boolean; onCheckedChange: (value: boolean) => void; "aria-label": string }) =>
    <button data-fast={label === "Fast" || undefined} data-switch={label} role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>{label}</button>,
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
  fixtures.engines = { computer: "server", engines: ["codex", "opencode"] };
  fixtures.mycelliosCatalog = [];
  fetching.value = false;
  fixtures.credentials.splice(1);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(engine: Bot["agentEngine"] = "codex") {
  act(() => root.render(<ChatHeaderModel bot={{ id: "bot", agentEngine: engine, modelProvider: null, modelId: null, thinkingLevel: "medium" } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
}
it("reuses recent account reads across Micos and refreshes older connections when the picker opens", async () => {
  queryCalls.length = 0; refetch.mockClear();
  act(() => root.render(<ChatHeaderModel bot={{ id: "bot", agentEngine: "pi", modelProvider: null, modelId: null, thinkingLevel: "medium" } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  for (const key of ["me", "credentials", "catalog"]) {
    expect(queryCalls.find(call => call.queryKey[0] === key)).toMatchObject({ refetchOnMount: true, staleTime: HEADER_MODEL_REUSE_MS });
  }
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
  expect(refetch).not.toHaveBeenCalled();
  fixtures.dataUpdatedAt = Date.now() - 31_000;
  act(() => root.render(<ChatHeaderModel bot={{ id: "bot", agentEngine: "pi", modelProvider: null, modelId: null, thinkingLevel: "medium" } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
  expect(refetch).toHaveBeenCalledTimes(2);
  fixtures.dataUpdatedAt = Date.now();
});
it("asks the PC for its engines once focus or the pointer reaches the button, before the picker opens", async () => {
  queryCalls.length = 0;
  act(() => root.render(<ChatHeaderModel bot={{ id: "bot", agentEngine: "claude", modelProvider: null, modelId: null, thinkingLevel: null } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  const engines = () => queryCalls.filter(call => call.queryKey[0] === "engines").at(-1);
  expect(engines()).toMatchObject({ enabled: false, staleTime: 60_000 });
  act(() => container.querySelector<HTMLButtonElement>("[data-trigger]")!.focus());
  expect(engines()).toMatchObject({ enabled: true });
});
it("says Claude Code's models are loading only while its own list is missing", async () => {
  fixtures.engines = { computer: "desktop", engines: ["claude"] };
  fetching.value = true;
  await render("claude");
  expect(container.textContent).toContain("Loading models…");
  fixtures.engines = { computer: "desktop", engines: ["claude"], models: { claude: [{ id: "opus", label: "Opus", isDefault: true, thinkingLevels: [], fast: false }] } };
  await render("claude");
  expect(container.textContent).not.toContain("Loading models…");
});
it("shows the installed provider instead of the unrelated general model", async () => {
  await render();
  expect(container.querySelector("[data-trigger]")?.textContent).toBe("ChatGPT");
  expect(container.querySelector('[aria-label="Thinking"]')).toBeNull();
  expect(container.querySelector('[data-choice="native-opencode::default"]')).not.toBeNull();
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
it("offers only the selected Desktop's native engines, and saves the engine without moving the Mico", async () => {
  fixtures.engines = { computer: "desktop", engines: ["opencode"] };
  fixtures.nativeModels = [{ id: "server-only", label: "Server only", isDefault: true, thinkingLevels: [], fast: false }];
  await render("pi");
  expect(container.querySelector('[data-choice^="native-codex::"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="native-opencode::default"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "opencode", nativeConfig: null, modelProvider: null, modelId: null, thinkingLevel: null });
});

it("lists OpenCode's models and saves the chosen provider/model only for this Mico", async () => {
  fixtures.engines = { computer: "desktop", engines: ["opencode"], models: { opencode: [
    { id: "opencode-go/kimi", label: "Kimi · opencode-go", isDefault: true, thinkingLevels: [], fast: false },
    { id: "google/gemini-3-pro", label: "Gemini 3 Pro · google", isDefault: false, thinkingLevels: [], fast: false },
  ] } };
  await render("opencode");
  expect(container.querySelector('[data-choice="native-opencode::opencode-go/kimi"]')?.getAttribute("data-selected")).toBe("true");
  // The CLI's own model is listed, so no separate default row.
  expect(container.querySelector('[data-choice="native-opencode::default"]')).toBeNull();
  expect(container.querySelector("[data-trigger]")?.textContent).toBe("Kimi · opencode-go");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="native-opencode::google/gemini-3-pro"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "opencode", nativeConfig: { modelId: "google/gemini-3-pro" }, modelProvider: null, modelId: null, thinkingLevel: null });
});

it("keeps OpenCode's own choice available when it has no model set", async () => {
  fixtures.engines = { computer: "desktop", engines: ["opencode"], models: { opencode: [
    { id: "google/gemini-3-pro", label: "Gemini 3 Pro · google", isDefault: false, thinkingLevels: [], fast: false },
  ] } };
  await render("opencode");
  expect(container.querySelector('[data-choice="native-opencode::default"]')?.textContent).toBe("OpenCode");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="native-opencode::default"]')!.click());
  expect(save).toHaveBeenCalledExactlyOnceWith({ agentEngine: "opencode", nativeConfig: null, modelProvider: null, modelId: null, thinkingLevel: null });
});

it("disables an engine whose CLI is signed out, but keeps the Mico's current engine selectable", async () => {
  fixtures.engines = { computer: "desktop", engines: ["claude", "opencode"], signedOut: ["claude", "opencode"] };
  await render("opencode");
  expect(container.querySelector<HTMLButtonElement>('[data-choice="native-claude::default"]')?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[data-choice="native-opencode::default"]')?.disabled).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("signs the PC's Codex in with a one-time code when the person is not in Desktop", async () => {
  fixtures.engines = { computer: "desktop", engines: ["codex"], signedOut: ["codex"], account: true };
  account.mockReset().mockResolvedValue({ status: "device", userCode: "ABCD-1234", verificationUrl: "https://auth.example.test/device" });
  await render("codex");
  const signIn = [...container.querySelectorAll("button")].find(button => button.textContent === "Sign in to ChatGPT");
  await act(async () => signIn!.click());
  expect(account).toHaveBeenCalledWith(expect.objectContaining({ action: "signIn", engine: "codex", flow: "device" }));
  expect(container.querySelector("code")?.textContent).toBe("ABCD-1234");
  expect(container.querySelector<HTMLAnchorElement>('a[href="https://auth.example.test/device"]')?.rel).toBe("noopener noreferrer");
  expect(save).not.toHaveBeenCalled();
});

it("asks to open Mycellios on the PC to sign Claude Code in, and offers nothing on an older Desktop", async () => {
  fixtures.engines = { computer: "desktop", engines: ["claude"], signedOut: ["claude"], account: true };
  account.mockReset();
  await render("claude");
  expect(container.textContent).toContain("Open Mycellios on that PC to sign in to Claude Code.");
  expect([...container.querySelectorAll("button")].some(button => button.textContent?.startsWith("Sign in to"))).toBe(false);
  act(() => root.unmount());
  root = createRoot(container);
  fixtures.engines = { computer: "desktop", engines: ["codex"], signedOut: ["codex"] };
  await render("codex");
  expect(container.querySelector('[data-testid="native-engine-account"]')).toBeNull();
  expect(account).not.toHaveBeenCalled();
});

it("preserves a saved native provider when the selected Desktop is offline", async () => {
  fixtures.engines = { computer: "desktop", engines: [] };
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
it("lists Claude Code's own models on This PC and keeps the configuration switch when changing model", async () => {
  fixtures.engines = { computer: "desktop", engines: ["claude"], models: { claude: [
    { id: "default", label: "Default (recommended)", isDefault: true, thinkingLevels: ["high"], fast: false },
    { id: "opus", label: "Opus", isDefault: false, thinkingLevels: ["high"], fast: false },
  ] } };
  act(() => root.render(<ChatHeaderModel bot={{ agentEngine: "claude", modelProvider: null, modelId: null, thinkingLevel: null,
    nativeConfig: { userSettings: true } } as Bot} me={fixtures.me as Me} onSave={save} onConnections={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
  expect(container.querySelector('[data-choice="native-claude::default"]')?.getAttribute("data-selected")).toBe("true");
  expect(container.querySelector("[data-fast]")).toBeNull();
  const settings = container.querySelector<HTMLButtonElement>('[data-switch="Use my Claude Code settings"]');
  expect(settings?.getAttribute("aria-checked")).toBe("true");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-choice="native-claude::opus"]')!.click());
  expect(save).toHaveBeenLastCalledWith({ agentEngine: "claude", nativeConfig: { modelId: "opus", thinkingLevel: null, userSettings: true },
    modelProvider: null, modelId: null, thinkingLevel: null });
  await act(async () => container.querySelector<HTMLButtonElement>("[data-open]")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-switch="Use my Claude Code settings"]')!.click());
  expect(save).toHaveBeenLastCalledWith({ agentEngine: "claude", modelProvider: null, modelId: null, thinkingLevel: null, nativeConfig: { userSettings: false } });
});
it("never offers the personal configuration switch for Claude Code on a server", async () => {
  fixtures.engines = { computer: "server", engines: ["claude"] };
  await render("claude");
  expect(container.querySelector('[data-switch="Use my Claude Code settings"]')).toBeNull();
});
it("does not offer a functional Fast switch for a provider that has no native priority capability", async () => {
  await render("pi");
  expect(container.querySelector("[data-fast]")).toBeNull();
});

const claudeRelease = { engine: "claude", version: "2.1.326", source: "npm", package: "@anthropic-ai/claude-code-win32-x64", bytes: 174_663_115 };

it("asks the owner to confirm the exact update offered by their PC", async () => {
  fixtures.engines = {
    computer: "desktop",
    engines: ["claude"],
    install: true,
    updates: [{ ...claudeRelease, engine: "claude", source: "npm", current: "2.1.300" }],
  };
  install.mockReset().mockResolvedValue({ status: "installing" });
  await render("claude");
  const offer = container.querySelector('[data-testid="native-engine-update"]')!;
  expect(offer.textContent).toContain("Claude Code 2.1.326 is available. This PC runs 2.1.300.");
  await act(async () => offer.querySelector<HTMLButtonElement>("button")!.click());
  expect(offer.textContent).toContain("Update Claude Code to 2.1.326 on this PC?");
  expect(install).not.toHaveBeenCalled();
  await act(async () => [...offer.querySelectorAll("button")].find(button => button.textContent === "Update")!.click());
  expect(install).toHaveBeenCalledExactlyOnceWith({ botId: "bot", engine: "claude", version: "2.1.326" });
  expect(save).not.toHaveBeenCalled();
});

it("installs a CLI missing on the owner's PC from its provider after showing its source and size", async () => {
  fixtures.engines = { computer: "desktop", engines: ["codex"], account: true, install: true, installable: [claudeRelease] };
  install.mockReset().mockResolvedValue({ status: "installing" });
  refetch.mockClear();
  await render("pi");
  const row = container.querySelector<HTMLButtonElement>('[data-choice="native-claude::default"]');
  expect(row?.disabled).toBe(true);
  expect(row?.getAttribute("data-unavailable")).toBe("Not installed");
  expect(container.querySelector('[data-testid="native-engine-install"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-provider="Claude Code"]')!.click());
  const start = [...container.querySelectorAll("button")].find(button => button.textContent === "Install Claude Code");
  await act(async () => start!.click());
  expect(container.querySelector('[data-testid="native-engine-install"]')?.textContent).toContain(
    "Install Claude Code 2.1.326 on this PC? It downloads 175 MB from npm (@anthropic-ai/claude-code-win32-x64) and checks it before it runs.");
  expect(install).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Install")!.click());
  expect(install).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ engine: "claude" }));
  expect(refetch).toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("shows the PC's install progress or failure, and offers nothing on an older Desktop", async () => {
  fixtures.engines = { computer: "desktop", engines: [], install: true, installable: [claudeRelease],
    installing: [{ engine: "claude", state: "downloading", receivedBytes: 50_000_000, totalBytes: 174_663_115 }] };
  await render("claude");
  expect(container.querySelector('[data-testid="native-engine-install"] [role="status"]')?.textContent)
    .toBe("Downloading Claude Code: 50 MB of 175 MB");
  // The Mico's own engine stays selectable while it is missing.
  expect(container.querySelector<HTMLButtonElement>('[data-choice="native-claude::default"]')?.disabled).toBe(false);
  act(() => root.unmount());
  root = createRoot(container);
  fixtures.engines = { ...fixtures.engines, installing: [{ engine: "claude", state: "failed", error: "The Claude Code download did not match its published hash." }] };
  await render("claude");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("The Claude Code download did not match its published hash.");
  expect([...container.querySelectorAll("button")].some(button => button.textContent === "Install Claude Code")).toBe(true);
  act(() => root.unmount());
  root = createRoot(container);
  fixtures.engines = { computer: "desktop", engines: [], installable: [claudeRelease] };
  await render("pi");
  expect(container.querySelector('[data-choice="native-claude::default"]')).toBeNull();
  expect(container.querySelector('[data-testid="native-engine-install"]')).toBeNull();
});
