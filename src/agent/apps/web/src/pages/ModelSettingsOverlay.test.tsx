// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import type * as UiWeb from "@rakazo/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type UiWebModule = typeof UiWeb;
vi.mock("../lib/auth-capabilities", () => ({
  fetchAuthCapabilities: vi.fn(async () => ({ mycelliosAccount: false })),
}));

/** Provider rows end with their "Connect" action; models show their name alone. */
const optionName = (entry: Element) => entry.textContent?.replace(/Connect$/, "");
const models = vi.hoisted(() => ({
  list: vi.fn(),
  role: vi.fn(),
  forRole: vi.fn(),
  setRole: vi.fn(),
  credentials: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  rename: vi.fn(),
  setDefault: vi.fn(),
  probeOpenAiCompatible: vi.fn(),
  beginOAuth: vi.fn(),
  cancelOAuth: vi.fn(),
  completeOAuth: vi.fn(),
  finishOAuth: vi.fn(),
  submitOAuthCode: vi.fn(),
}));
const engines = vi.hoisted(() => ({ list: vi.fn(async () => [{ id: "pi", name: "Pi", available: true }]),
  registry: vi.fn(async () => [{ id: "opencode", name: "OpenCode", version: "1.0.0" }]) }));

vi.mock("../lib/rpc", () => {
  const rpc = {
    models,
    engines,
    bots: { list: vi.fn(async () => []), update: vi.fn() },
    me: vi.fn(),
  };
  return {
    selectedSpaceId: () => "space-1",
    rpc,
    rpcForSpace: () => rpc,
    createSpaceRpc: () => rpc,
  };
});
vi.mock("../lib/localized-provider-hint", () => ({
  localizedProviderHint: () => "API key",
  providerRowHint: () => null,
  providerDisplayName: (_id: string, name: string) => name,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce(
      (text, part, index) => `${text}${index > 0 ? String(values[index - 1]) : ""}${part}`,
      "",
    );
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children?: ReactNode }) => children,
    Plural: ({ one, other, value }: { one: string; other: string; value: number }) =>
      value === 1 ? one : other,
  };
});
vi.mock("@rakazo/ui-web", async (importOriginal) => {
  const actual = await importOriginal<UiWebModule>();
  const { Disclosure } = actual;
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ...actual,
    AlertDialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogContent: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    Button: ({
      children,
      onClick,
      disabled,
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
      <button type="button" disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    // Dialogs render inline, and only while open.
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogDescription: ({ children }: { children?: ReactNode }) => (
      <p data-testid="model-description">{children}</p>
    ),
    DialogHeader: Pass,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    ModelThinkingOptions: (props: {
      children?: ReactNode;
      advancedLabel: string;
      maxTokens?: string;
      maxTokensLabel?: string;
      maxTokensPlaceholder?: string;
      onMaxTokensChange?: (value: string) => void;
    }) =>
      props.onMaxTokensChange ? (
        <Disclosure summary={props.advancedLabel}>
          <input
            aria-label={props.maxTokensLabel}
            value={props.maxTokens ?? ""}
            placeholder={props.maxTokensPlaceholder}
            onChange={(event) => props.onMaxTokensChange?.(event.target.value)}
          />
          {props.children}
        </Disclosure>
      ) : null,
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  };
});

import { rpc } from "../lib/rpc";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";

const STORED_PLACEHOLDER = "Paste a replacement key";
const deepseekEntry = {
  provider: "deepseek",
  providerName: "DeepSeek",
  id: "deepseek-chat",
  label: "DeepSeek Chat",
  billing: "API key",
  auth: "api-key" as const,
  authHint: "API key",
};
const openrouterEntry = {
  provider: "openrouter",
  providerName: "OpenRouter",
  id: "fixture/router-model",
  label: "Router model",
  billing: "API key",
  auth: "api-key" as const,
  authHint: "API key",
};
const compatibleEntry = {
  provider: "openai-compatible",
  providerName: "OpenAI-compatible",
  id: "custom",
  label: "Custom model",
  billing: "Your server",
  auth: "api-key" as const,
  authHint: "Custom server",
  placeholder: true,
};
const deepseekCredential = {
  id: "cred-deepseek",
  provider: "deepseek",
  label: "DeepSeek",
  hasKey: true,
  isDefault: true,
  modelId: "deepseek-chat",
};

function account(provider: string, modelId: string) {
  return {
    userId: "user-1",
    email: "ada@example.test",
    name: "Ada",
    spaceId: "space-1",
    isDeploymentOwner: false,
    needsModel: false,
    defaultProvider: provider,
    defaultModel: modelId,
    hostCredentialProvider: null,
    hostCredentialSource: null,
    computerHost: null,
    canChooseHostComputer: false,
    sandboxProvider: "docker",
    avatarStyle: "organic" as const,
    billingEnabled: false,
    ticketBoardEnabled: false,
    phoneCallsEnabled: false,
  };
}

function buttons(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll("button")].filter((entry) =>
    entry.textContent?.includes(text),
  );
  if (found.length === 0) throw new Error(`Missing button: ${text}`);
  return found;
}

function keyField(container: HTMLElement) {
  const input = container.querySelector("#model-api-key");
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing API key field");
  return input;
}

function compatibleKeyField(container: HTMLElement) {
  const input = [...container.querySelectorAll("input")].find(
    (entry) => entry.getAttribute("aria-label") === "API key",
  );
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing compatible API key field");
  return input;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("Missing element");
  await act(async () => element.click());
  await act(async () => {
    await Promise.resolve();
  });
}

function section(role: "main" | "approval") {
  const found = document.querySelector(`[data-testid="model-role-${role}"]`);
  if (!found) throw new Error(`Missing ${role} model list`);
  return found;
}

/** Visible names of the open picker's options. */
function pickerOptions() {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(optionName);
}

async function openPicker(label: string, role: "main" | "approval" = "main") {
  await click(section(role).querySelector(`button[aria-label="${label}"]`));
}

async function choose(option: string) {
  await click(
    [...document.querySelectorAll('[role="option"]')].find((entry) => optionName(entry) === option),
  );
}

/** Picks a model or a not-connected provider from one of the list's pickers. */
async function pick(label: string, option: string, role: "main" | "approval" = "main") {
  await openPicker(label, role);
  await choose(option);
}

/** Opens the connection dialog for the main model's first row through its options menu. */
async function manage() {
  await click(
    section("main").querySelector(
      '[data-testid="model-role-row-1"] button[aria-label$=" options"]',
    ),
  );
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
      entry.textContent?.startsWith("Manage "),
    ),
  );
}

function titles(container: HTMLElement) {
  return [...container.querySelectorAll('[data-testid="model-connection-title"]')].map(
    (entry) => entry.textContent,
  );
}

function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderSettings(
  embedded = true,
  queryClient = testQueryClient(),
  scope: "account" | "space" = "account",
  providersOnly = false,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ModelSettingsOverlay embedded={embedded} providersOnly={providersOnly} scope={scope} onClose={() => undefined} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  i18n.loadAndActivate({ locale: "en", messages: {} });
  vi.mocked(rpc.me).mockResolvedValue(account("deepseek", "deepseek-chat"));
  models.list.mockResolvedValue([deepseekEntry]);
  models.probeOpenAiCompatible.mockReset().mockResolvedValue({ models: [] });
  models.credentials.mockResolvedValue([]);
  models.connect.mockResolvedValue({});
  models.disconnect.mockResolvedValue(undefined);
  models.forRole.mockImplementation(() => models.list());
  models.setRole.mockImplementation(
    async ({ role: _role, expectedUserId: _user, ...patch }: Record<string, unknown>) => ({
      primary: null,
      backups: [],
      ...patch,
    }),
  );
  // The main role's first slot is the space default once its provider is connected.
  models.role.mockImplementation(async ({ role }: { role: string }) => {
    if (role !== "main") return { primary: null, backups: [] };
    const [me, credentials] = await Promise.all([rpc.me(), models.credentials()]);
    const connected =
      !me.needsModel &&
      (credentials as { provider: string }[]).some(
        (entry) => entry.provider === me.defaultProvider,
      );
    return {
      primary: connected ? { provider: me.defaultProvider, modelId: me.defaultModel } : null,
      backups: [],
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("reopens on cached models without a spinner and refreshes them behind it", async () => {
  models.credentials.mockResolvedValue([deepseekCredential]);
  const queryClient = testQueryClient();
  const first = await renderSettings(true, queryClient);
  expect(first.container.querySelector('[data-testid="model-role-row-1"]')).not.toBeNull();
  await first.unmount();

  const hold = new Promise<never>(() => undefined);
  models.list.mockReturnValue(hold);
  models.role.mockReturnValue(hold);
  models.forRole.mockReturnValue(hold);
  const listCalls = models.list.mock.calls.length;
  const roleCalls = models.role.mock.calls.length;
  const view = await renderSettings(true, queryClient);
  try {
    expect(view.container.querySelector('[aria-label="Loading model catalog…"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="model-role-row-1"]')).not.toBeNull();
    expect(models.list.mock.calls.length).toBeGreaterThan(listCalls);
    expect(models.role.mock.calls.length).toBeGreaterThan(roleCalls);
  } finally {
    await view.unmount();
  }
});

it("shows a stored BYOK key when provider settings reopen", async () => {
  models.credentials.mockResolvedValue([deepseekCredential]);

  const view = await renderSettings();
  try {
    expect(view.container.querySelector("#model-api-key")).toBeNull();
    await manage();
    expect(titles(view.container)).toEqual(["DeepSeek"]);
    const input = keyField(view.container);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe(STORED_PLACEHOLDER);
    expect(input.type).toBe("password");
    expect(view.container.textContent).not.toContain("sk-");
    expect(buttons(view.container, "Replace API key")[0]?.disabled).toBe(true);

    await typeInto(input, "sk-replacement-key");
    expect(keyField(view.container).value).toBe("sk-replacement-key");

    await typeInto(keyField(view.container), "");
    expect(keyField(view.container).value).toBe("");
    expect(keyField(view.container).placeholder).toBe(STORED_PLACEHOLDER);

    await typeInto(keyField(view.container), "sk-replacement-key");
    await click(buttons(view.container, "Replace API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "deepseek", apiKey: "sk-replacement-key" }),
    );
    // A saved connection closes its dialog; reopening shows the stored key again.
    expect(view.container.querySelector("#model-api-key")).toBeNull();
    await manage();
    expect(keyField(view.container).value).toBe("");
    expect(keyField(view.container).placeholder).toBe(STORED_PLACEHOLDER);

    models.credentials.mockResolvedValue([]);
    await click(buttons(view.container, "Disconnect")[0]);
    const confirm = buttons(view.container, "Disconnect");
    await click(confirm[confirm.length - 1]);
    expect(models.disconnect).toHaveBeenCalledWith({
      provider: "deepseek",
      credentialId: "cred-deepseek",
    });
    expect(view.container.querySelector("#model-api-key")).toBeNull();

    await pick("Change Main model", "DeepSeek");
    expect(titles(view.container)).toEqual(["Connect DeepSeek"]);
    expect(keyField(view.container).value).toBe("");
    expect(keyField(view.container).placeholder).toBe("sk-…");
  } finally {
    await view.unmount();
  }
});

it("saves an edited output limit without sending a half-typed replacement key", async () => {
  models.credentials.mockResolvedValue([deepseekCredential]);

  const view = await renderSettings();
  try {
    await manage();
    const limit = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Maximum output tokens"]',
    );
    if (!limit) throw new Error("Missing output limit field");
    await typeInto(limit, "4096");
    await typeInto(keyField(view.container), "sk-ab");
    await click(buttons(view.container, "Save").find((entry) => entry.textContent === "Save"));
    expect(models.connect).toHaveBeenCalledTimes(1);
    const input = models.connect.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({ provider: "deepseek", maxTokens: 4096 });
    expect(input).not.toHaveProperty("apiKey");
    // A limits-only save keeps the dialog and the half-typed key.
    expect(keyField(view.container).value).toBe("sk-ab");
  } finally {
    await view.unmount();
  }
});

it("leaves the key field empty until a key is saved", async () => {
  const view = await renderSettings();
  try {
    await pick("Change Main model", "DeepSeek");
    const input = keyField(view.container);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("sk-…");
    expect(view.container.textContent).not.toContain(STORED_PLACEHOLDER);
  } finally {
    await view.unmount();
  }
});

it("labels the empty main slot by what runs there", async () => {
  vi.mocked(rpc.me).mockResolvedValue({
    ...account("deepseek", "deepseek-chat"),
    needsModel: true,
  });
  const view = await renderSettings();
  try {
    expect(section("main").querySelector('[data-testid="model-role-default"]')?.textContent).toBe(
      "Choose a model",
    );
    expect(view.container.querySelector('[data-testid="model-role-approval"]')).toBeNull();
  } finally {
    await view.unmount();
  }

  vi.mocked(rpc.me).mockResolvedValue(account("deepseek", "deepseek-chat"));
  models.credentials.mockResolvedValue([deepseekCredential]);
  const connected = await renderSettings();
  try {
    expect(section("main").querySelector('[data-testid="model-role-default"]')).toBeNull();
    expect(
      section("main").querySelector('[data-testid="model-role-row-1"]')?.textContent,
    ).toContain("DeepSeek Chat");
  } finally {
    await connected.unmount();
  }
});

it("connects a provider from Add fallback without replacing the main model, then picks its model", async () => {
  models.list.mockResolvedValue([deepseekEntry, openrouterEntry]);
  models.credentials.mockResolvedValue([deepseekCredential]);
  const view = await renderSettings();
  try {
    await openPicker("Add fallback");
    expect(pickerOptions()).toContain("OpenRouter");
    await choose("OpenRouter");
    expect(titles(view.container)).toEqual(["Connect OpenRouter"]);
    await typeInto(keyField(view.container), "sk-fixture-router");
    models.credentials.mockResolvedValue([
      deepseekCredential,
      {
        id: "cred-openrouter",
        provider: "openrouter",
        label: "OpenRouter",
        hasKey: true,
        isDefault: false,
        modelId: openrouterEntry.id,
      },
    ]);
    await click(buttons(view.container, "Connect API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        apiKey: "sk-fixture-router",
        modelId: openrouterEntry.id,
        makeDefault: false,
      }),
    );
    // The key belongs to the provider; its models are then chosen in the reopened picker.
    expect(titles(view.container)).toEqual([]);
    expect(models.setRole).not.toHaveBeenCalled();
    expect(pickerOptions()).toEqual([openrouterEntry.label]);
    await choose(openrouterEntry.label);
    expect(models.setRole).toHaveBeenCalledTimes(1);
    expect(models.setRole).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "main",
        primary: { provider: "deepseek", modelId: "deepseek-chat" },
        backups: [
          { provider: "openrouter", modelId: openrouterEntry.id, credentialId: "cred-openrouter" },
        ],
      }),
      expect.anything(),
    );
  } finally {
    await view.unmount();
  }
});

it("connects a provider from the empty main slot without choosing its model", async () => {
  vi.mocked(rpc.me).mockResolvedValue({
    ...account("deepseek", "deepseek-chat"),
    needsModel: true,
  });
  const view = await renderSettings();
  try {
    await pick("Change Main model", "DeepSeek");
    expect(titles(view.container)).toEqual(["Connect DeepSeek"]);
    await typeInto(keyField(view.container), "sk-fixture-deepseek");
    const loads = models.role.mock.calls.length;
    await click(buttons(view.container, "Connect API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        apiKey: "sk-fixture-deepseek",
        makeDefault: false,
        scope: "account",
      }),
    );
    // Connecting only reloads and reopens the picker; choosing a model remains explicit.
    expect(models.setRole).not.toHaveBeenCalled();
    expect(models.role.mock.calls.length).toBeGreaterThan(loads);
    expect(titles(view.container)).toEqual([]);
  } finally {
    await view.unmount();
  }
});

it("shows a compact account default above the providers without changing it on load", async () => {
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    expect(view.container.querySelector('[data-testid="model-providers"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="default-provider"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="model-role-main"]')).toBeNull();
    expect(models.role).toHaveBeenCalledWith(
      expect.objectContaining({ role: "main", scope: "account" }), expect.anything(),
    );
    expect(models.setRole).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("DeepSeek");
    expect(view.container.textContent).not.toContain("Pi");
    expect(engines.registry).not.toHaveBeenCalled();
    const registryForm = view.container.querySelector('[data-testid="provider-discovery"] form')!;
    await act(async () => {
      registryForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(registryForm.parentElement?.textContent).toContain("1.0.0"));
    expect(engines.registry).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("keeps installed CLI selection out of the account API-provider settings", async () => {
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    expect(view.container.querySelector('[data-testid="opencode-provider"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="opencode-provider-detail"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="default-provider"]')).not.toBeNull();
    expect(view.container.textContent).toContain("DeepSeek");
    expect(models.setRole).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("keeps a Space role unchanged when connecting a provider", async () => {
  vi.mocked(rpc.me).mockResolvedValue({
    ...account("deepseek", "deepseek-chat"),
    needsModel: true,
  });
  const view = await renderSettings(true, testQueryClient(), "space");
  try {
    expect(view.container.querySelector('[data-testid="model-role-main"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="model-role-approval"]')).toBeNull();
    expect(models.role).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: "approval" }),
      expect.anything(),
    );
    // Connections are the account's, so a Space does not list or add them.
    expect(view.container.querySelector('[data-testid="model-providers"]')).toBeNull();
    expect(models.role).toHaveBeenCalledWith(
      expect.objectContaining({ role: "main", scope: "space" }),
      expect.anything(),
    );
    await pick("Change Main model", "DeepSeek");
    await typeInto(keyField(view.container), "sk-fixture-deepseek");
    await click(buttons(view.container, "Connect API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "deepseek", makeDefault: false, scope: "space" }),
    );
  } finally {
    await view.unmount();
  }
});

it("shows Cloudflare account and gateway fields for a new and a saved connection", async () => {
  const entry = {
    provider: "cloudflare-ai-gateway",
    providerName: "Cloudflare AI Gateway",
    id: "workers-ai/@cf/meta/llama-3.1-8b-instruct",
    label: "Llama",
    billing: "API key",
    auth: "api-key" as const,
    authHint: "API key",
  };
  vi.mocked(rpc.me).mockResolvedValue(account(entry.provider, entry.id));
  models.list.mockResolvedValue([entry]);
  models.credentials.mockResolvedValue([]);

  const fresh = await renderSettings();
  try {
    await pick("Change Main model", "Cloudflare AI Gateway");
    const accountId = fresh.container.querySelector("#cloudflare-account-id");
    const gatewayId = fresh.container.querySelector("#cloudflare-gateway-id");
    expect(accountId).toBeInstanceOf(HTMLInputElement);
    expect(gatewayId).toBeInstanceOf(HTMLInputElement);
    expect((accountId as HTMLInputElement).value).toBe("");
    expect((gatewayId as HTMLInputElement).value).toBe("");
    expect(fresh.container.textContent).toContain("Account ID");
    expect(fresh.container.textContent).toContain("Gateway ID");
  } finally {
    await fresh.unmount();
  }

  models.credentials.mockResolvedValue([
    {
      id: "cred-cf",
      provider: entry.provider,
      label: "Cloudflare AI Gateway",
      hasKey: true,
      isDefault: true,
      accountId: "acct1234",
      gatewayId: "gateway-1",
      modelId: entry.id,
    },
  ]);
  const saved = await renderSettings();
  try {
    await manage();
    expect(
      (saved.container.querySelector("#cloudflare-account-id") as HTMLInputElement).value,
    ).toBe("acct1234");
    expect(
      (saved.container.querySelector("#cloudflare-gateway-id") as HTMLInputElement).value,
    ).toBe("gateway-1");
  } finally {
    await saved.unmount();
  }
});

it("shows a stored OpenAI-compatible key and stays empty when none is saved", async () => {
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "deepseek-chat"));
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([
    {
      id: "cred-compatible",
      provider: "openai-compatible",
      label: "DeepSeek",
      hasKey: true,
      isDefault: true,
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
    },
  ]);

  const stored = await renderSettings();
  try {
    await manage();
    const input = compatibleKeyField(stored.container);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe(STORED_PLACEHOLDER);
  } finally {
    await stored.unmount();
  }

  models.credentials.mockResolvedValue([
    {
      id: "cred-compatible",
      provider: "openai-compatible",
      label: "Local",
      hasKey: false,
      isDefault: true,
      baseUrl: "http://127.0.0.1:8000/v1",
      modelId: "local-model",
    },
  ]);
  const empty = await renderSettings();
  try {
    await manage();
    const input = compatibleKeyField(empty.container);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Optional");
  } finally {
    await empty.unmount();
  }
});

const compatibleCredential = {
  id: "cred-compatible",
  provider: "openai-compatible",
  label: "Local",
  hasKey: false,
  isDefault: true,
  baseUrl: "http://127.0.0.1:8000/v1",
  modelId: "model-a",
  enabledModelIds: ["model-a"],
};

it("uses automatic output by default and can clear a saved compatible ceiling without replacing its key", async () => {
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([{ ...compatibleCredential, hasKey: true }]);
  const automatic = await renderSettings();
  try {
    await manage();
    const field = automatic.container.querySelector<HTMLInputElement>('input[aria-label="Maximum output tokens"]');
    expect(field?.value).toBe("");
    expect(field?.placeholder).toBe("Automatic");
  } finally { await automatic.unmount(); }

  models.credentials.mockResolvedValue([{ ...compatibleCredential, hasKey: true, maxTokens: 4096 }]);
  const saved = await renderSettings();
  try {
    await manage();
    const field = saved.container.querySelector<HTMLInputElement>('input[aria-label="Maximum output tokens"]');
    if (!field) throw new Error("Missing output limit field");
    expect(field.value).toBe("4096");
    await typeInto(field, "");
    await click(buttons(saved.container, "Save").find((entry) => entry.textContent === "Save"));
    expect(models.connect).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-compatible", credentialId: "cred-compatible", modelId: "model-a", maxTokens: null,
    }));
    const input = models.connect.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(input.apiKey).toBeUndefined();
  } finally { await saved.unmount(); }
});

it("keeps Mycellios selected while opening an independent AntSeed connection", async () => {
  const native = {
    ...compatibleCredential, id: "native", label: "Mycellios", hasKey: true,
    baseUrl: "https://www.mycellios.com/v1", modelId: "mycellios-model",
  };
  const gateway = { ...compatibleEntry, provider: "antseed", providerName: "AntSeed" };
  models.list.mockResolvedValue([compatibleEntry, gateway]);
  models.credentials.mockResolvedValue([native]);
  vi.mocked(rpc.me).mockResolvedValue(account(native.provider, native.modelId));
  const view = await renderSettings();
  try {
    await pick("Add fallback", "AntSeed");
    expect(compatibleKeyField(view.container).required).toBe(true);
    expect(compatibleKeyField(view.container).type).toBe("password");
    expect(section("main").querySelector('[data-testid="model-role-row-1"]')?.textContent)
      .toContain(native.modelId);
    expect(models.connect).not.toHaveBeenCalled();
    expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("opens the built-in AntSeed detail, lists its gateway models, and preserves the account default", async () => {
  const gateway = { ...compatibleEntry, provider: "antseed", providerName: "AntSeed" };
  const credential = {
    ...compatibleCredential,
    id: "antseed-connection",
    provider: "antseed",
    label: "AntSeed",
    baseUrl: "https://antseed.example.test/v1",
    modelId: "saved-antseed-model",
    enabledModelIds: ["saved-antseed-model"],
    hasKey: true,
  };
  models.list.mockResolvedValue([deepseekEntry, gateway]);
  models.credentials.mockResolvedValue([deepseekCredential, credential]);
  models.probeOpenAiCompatible.mockResolvedValue({ models: ["saved-antseed-model", "another-antseed-model"] });
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    const row = view.container.querySelector('[data-testid="antseed-provider"]')!;
    expect(row.textContent).toContain("Connected");
    await click(row.querySelector("button"));
    const detail = view.container.querySelector('[data-testid="antseed-provider-detail"]') as HTMLElement;
    expect(detail.textContent).toContain("antseed.example.test");
    await click(buttons(detail, "Manage connection")[0]);
    await vi.waitFor(() => expect(detail.textContent).toContain("another-antseed-model"));
    expect(models.probeOpenAiCompatible).toHaveBeenCalledWith(expect.objectContaining({
      provider: "antseed", credentialId: credential.id,
    }));
    expect(models.connect).not.toHaveBeenCalled();
    expect(models.setRole).not.toHaveBeenCalled();
    const modelRow = [...detail.querySelectorAll("label")].find((label) => label.textContent === "another-antseed-model");
    await click(modelRow?.querySelector('[role="checkbox"]'));
    await click(buttons(detail, "Save")[0]);
    expect(models.connect).toHaveBeenCalledWith(expect.objectContaining({
      provider: "antseed", credentialId: credential.id, enabledModelIds: ["another-antseed-model"], makeDefault: false,
    }));
    expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("discovers AntSeed models with a key before choosing a model in the development preview", async () => {
  const gateway = { ...compatibleEntry, provider: "antseed", providerName: "AntSeed" };
  models.list.mockResolvedValue([compatibleEntry, gateway]);
  models.credentials.mockResolvedValue([compatibleCredential]);
  let finish!: (result: { models: string[] }) => void;
  models.probeOpenAiCompatible.mockImplementation((input) => input.provider === "antseed"
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ models: [] }));
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  const view = await renderSettings();
  try {
    await pick("Add fallback", "AntSeed");
    expect(view.container.textContent).not.toContain("Find models");
    expect(models.probeOpenAiCompatible.mock.calls.filter(([input]) => input.provider === "antseed")).toHaveLength(0);
    expect(view.container.querySelector('[role="combobox"][aria-label="Model"]')).toBeNull();
    await typeInto(compatibleKeyField(view.container), "unfinished-key");
    await typeInto(compatibleKeyField(view.container), "test-only-antseed-key");

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(models.probeOpenAiCompatible.mock.calls.filter(([input]) => input.provider === "antseed")).toHaveLength(1);
    expect(models.probeOpenAiCompatible).toHaveBeenCalledWith(expect.objectContaining({
      provider: "antseed",
      baseUrl: "https://www.mycellios.com/agent/gateway/v1",
      apiKey: "test-only-antseed-key",
    }));

    expect(view.container.textContent).toContain("Checking connection…");
    await act(async () => finish({ models: ["antseed-chat-model"] }));
    expect(view.container.textContent).not.toContain("antseed-chat-model");
    expect(buttons(view.container, "Save")[0]!.disabled).toBe(false);
    expect(view.container.querySelector('[role="combobox"][aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(models.probeOpenAiCompatible.mock.calls.filter(([input]) => input.provider === "antseed")).toHaveLength(1);
    expect(models.connect).not.toHaveBeenCalled();
    expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("recovers an automatic AntSeed catalog timeout without editing or saving the key again", async () => {
  models.list.mockResolvedValue([compatibleEntry, { ...compatibleEntry, provider: "antseed", providerName: "AntSeed" }]);
  models.credentials.mockResolvedValue([compatibleCredential]);
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  let attempts = 0;
  models.probeOpenAiCompatible.mockImplementation(async input => {
    if (input.provider !== "antseed") return { models: [] };
    if (attempts++ === 0) throw new Error("Model server probe timed out.");
    return { models: ["recovered-model"] };
  });
  const view = await renderSettings();
  try {
    await pick("Add fallback", "AntSeed");
    await typeInto(compatibleKeyField(view.container), "fixture-antseed-key");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(models.probeOpenAiCompatible.mock.calls.filter(([input]) => input.provider === "antseed")).toHaveLength(2);
    expect(buttons(view.container, "Save")[0]!.disabled).toBe(false);
    expect(view.container.textContent).not.toContain("timed out");
    expect(models.connect).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("discards an old AntSeed catalog when the key changes during automatic discovery", async () => {
  models.list.mockResolvedValue([compatibleEntry, { ...compatibleEntry, provider: "antseed", providerName: "AntSeed" }]);
  models.credentials.mockResolvedValue([compatibleCredential]);
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  const pending: Array<(result: { models: string[] }) => void> = [];
  models.probeOpenAiCompatible.mockImplementation(input => input.provider === "antseed"
    ? new Promise(resolve => pending.push(resolve)) : Promise.resolve({ models: [] }));
  const view = await renderSettings();
  try {
    await pick("Add fallback", "AntSeed");
    await typeInto(compatibleKeyField(view.container), "first-fixture-key");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    await typeInto(compatibleKeyField(view.container), "second-fixture-key");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]!({ models: ["current-model"] }));
    await act(async () => pending[0]!({ models: ["obsolete-model"] }));
    expect(buttons(view.container, "Save")[0]!.disabled).toBe(false);
    expect(view.container.textContent).not.toContain("obsolete-model");
    expect(models.connect).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("shows the endpoint field before advanced settings when it is missing", async () => {
  const view = await renderCompatible({ ...compatibleCredential, baseUrl: "" });
  try {
    const field = view.container.querySelector('input[aria-label="OpenAI-compatible server URL"]');
    expect(field).not.toBeNull();
    expect(field?.closest('[data-closed]')).toBeNull();
    expect(view.container.querySelectorAll('#model-base-url')).toHaveLength(1);
    expect(models.connect).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

/** Renders a saved compatible connection as the main model and opens its dialog. */
async function renderCompatible(credential: object = compatibleCredential) {
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([credential]);
  const view = await renderSettings();
  await manage();
  return view;
}

async function renderCompatibleWithProbe(probed: string[]) {
  models.probeOpenAiCompatible.mockResolvedValue({ models: probed });
  const view = await renderCompatible();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
  return view;
}

it("shows a saved key without recovering it and preserves it when saving", async () => {
  const view = await renderCompatible({ ...compatibleCredential, hasKey: true });
  try {
    expect(view.container.textContent).toContain("API key saved");
    expect(compatibleKeyField(view.container).value).toBe("");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(models.probeOpenAiCompatible).not.toHaveBeenCalled();
    await click(buttons(view.container, "Save").find((entry) => entry.textContent === "Save"));
    const saved = models.connect.mock.calls.at(-1)?.[0];
    expect(saved).toMatchObject({ credentialId: compatibleCredential.id, makeDefault: false });
    expect(saved.apiKey).toBeUndefined();
    expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("does not reject a provider connection when its bootstrap model leaves the catalog", async () => {
  const view = await renderCompatibleWithProbe(["new-model"]);
  try {
    expect(models.probeOpenAiCompatible).toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("not in the list");
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    await click(buttons(view.container, "Save").find((entry) => entry.textContent === "Save"));
    expect(models.connect).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "model-a", makeDefault: false,
    }));
    expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it("offers a saved compatible model in the main picker and uses it", async () => {
  vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "model-a"));
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([
    { ...compatibleCredential, enabledModelIds: ["model-a", "model-b"] },
  ]);
  const view = await renderSettings();
  try {
    await openPicker("Change model-a");
    expect(pickerOptions()).toEqual(expect.arrayContaining(["model-a", "model-b"]));
    await choose("model-b");
    expect(models.setRole).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "main",
        primary: {
          provider: "openai-compatible",
          modelId: "model-b",
          credentialId: "cred-compatible",
        },
        backups: [],
      }),
      expect.anything(),
    );
  } finally {
    await view.unmount();
  }
});

it("lists not-connected providers by name alone", async () => {
  models.list.mockResolvedValue([deepseekEntry, compatibleEntry]);
  const view = await renderSettings();
  try {
    await openPicker("Change Main model");
    expect(pickerOptions()).toEqual(["DeepSeek", "OpenAI-compatible", "Ollama Cloud"]);
    expect(document.querySelectorAll("[cmdk-group-heading]")).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});

function baseUrlField(container: HTMLElement) {
  const input = container.querySelector("#model-base-url");
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing server URL field");
  return input;
}

it("probes with the editing credential id without sending saved header values", async () => {
  const view = await renderCompatibleWithProbe(["model-a"]);
  try {
    expect(models.probeOpenAiCompatible).toHaveBeenCalledWith({
      baseUrl: compatibleCredential.baseUrl,
      apiKey: undefined,
      headers: undefined,
      credentialId: compatibleCredential.id,
    });
  } finally {
    await view.unmount();
  }
});

it("shows saved header names only, preserves untouched headers and explicitly clears removed headers", async () => {
  const view = await renderCompatible({ ...compatibleCredential, headerNames: ["x-session"] });
  try {
    const name = view.container.querySelector(
      'input[aria-label="Header name"]',
    ) as HTMLInputElement;
    const value = view.container.querySelector(
      'input[aria-label="Header value"]',
    ) as HTMLInputElement;
    expect(name.value).toBe("x-session");
    expect(value.type).toBe("password");
    expect(value.placeholder).toBe("••••••••");
    expect(value.value).toBe("");
    await click(buttons(view.container, "Save")[0]);
    expect(models.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ headers: undefined }),
    );
    await manage();
    await click(view.container.querySelector('button[aria-label="Remove header"]'));
    await click(buttons(view.container, "Save")[0]);
    expect(models.connect).toHaveBeenLastCalledWith(expect.objectContaining({ headers: {} }));
  } finally {
    await view.unmount();
  }
});

it.each([" http://127.0.0.1:8000/v1 ", "http://127.0.0.1:8000/v1/", "http://127.0.0.1:8000"])(
  "preserves saved header rows at the equivalent endpoint %s",
  async (endpoint) => {
    const view = await renderCompatible({
      ...compatibleCredential,
      headerNames: ["x-session", "x-route"],
    });
    try {
      await typeInto(baseUrlField(view.container), endpoint);
      const names = view.container.querySelectorAll<HTMLInputElement>(
        'input[aria-label="Header name"]',
      );
      const values = view.container.querySelectorAll<HTMLInputElement>(
        'input[aria-label="Header value"]',
      );
      expect([...names].map((input) => input.value)).toEqual(["x-session", "x-route"]);
      expect([...values].map((input) => input.placeholder)).toEqual(["••••••••", "••••••••"]);
      expect([...values].map((input) => input.value)).toEqual(["", ""]);
      await typeInto(values[0]!, "fake-session-secret");
      // Editing one saved header must retain the other row and require its value too.
      expect(buttons(view.container, "Save")[0]?.disabled).toBe(true);
      await typeInto(values[1]!, "fake-routing-secret");
      await click(buttons(view.container, "Save")[0]);
      expect(models.connect).toHaveBeenLastCalledWith(
        expect.objectContaining({
          headers: { "x-session": "fake-session-secret", "x-route": "fake-routing-secret" },
        }),
      );
    } finally {
      await view.unmount();
    }
  },
);

it("does not inherit saved header rows or placeholders at another origin", async () => {
  const view = await renderCompatible({ ...compatibleCredential, headerNames: ["x-session"] });
  try {
    await typeInto(baseUrlField(view.container), "http://other.test/v1");
    expect(view.container.querySelector('input[aria-label="Header name"]')).toBeNull();
    await click(buttons(view.container, "Add header")[0]);
    await typeInto(
      view.container.querySelector<HTMLInputElement>('input[aria-label="Header name"]')!,
      "x-session",
    );
    const value = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Header value"]',
    )!;
    expect(value.placeholder).toBe("");
  } finally {
    await view.unmount();
  }
});

it("disables Save for invalid custom header names", async () => {
  const view = await renderCompatibleWithProbe(["model-a"]);
  try {
    await click(buttons(view.container, "Add header")[0]);
    const name = view.container.querySelector(
      'input[aria-label="Header name"]',
    ) as HTMLInputElement;
    const value = view.container.querySelector(
      'input[aria-label="Header value"]',
    ) as HTMLInputElement;
    await typeInto(name, "Authorization");
    await typeInto(value, "long-session-secret");
    expect(buttons(view.container, "Save")[0]?.disabled).toBe(true);
    await typeInto(name, "bad name");
    expect(buttons(view.container, "Save")[0]?.disabled).toBe(true);
  } finally {
    await view.unmount();
  }
});

it("opens the Ollama preset with a required key and saves a compatible connection", async () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([]);
  models.probeOpenAiCompatible.mockResolvedValue({ models: ["fixture-model"] });
  const view = await renderSettings(false);
  try {
    await pick("Change Main model", "Ollama Cloud");
    expect(titles(view.container)).toContain("Connect Ollama Cloud");
    expect(baseUrlField(view.container).value).toBe("https://ollama.com/v1");
    expect(
      [...view.container.querySelectorAll("button")].filter(
        (row) => row.textContent === "Setup help",
      ),
    ).toHaveLength(0);
    expect(
      [...view.container.querySelectorAll("button")].filter((row) => row.textContent === "API key"),
    ).toHaveLength(0);
    const key = view.container.querySelector(
      'input[placeholder="Ollama API key"]',
    ) as HTMLInputElement;
    expect(key.required).toBe(true);
    await typeInto(key, "fake-fixture-key");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(models.probeOpenAiCompatible).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://ollama.com/v1", apiKey: "fake-fixture-key" }),
    );
    await click(buttons(view.container, "Save")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-compatible",
        baseUrl: "https://ollama.com/v1",
        apiKey: "fake-fixture-key",
        modelId: "fixture-model",
        makeDefault: false,
      }),
    );
  } finally {
    await view.unmount();
  }
});

it("offers a saved Ollama connection's models without the Ollama preset", async () => {
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([
    {
      id: "fixture",
      label: "OpenAI-compatible",
      provider: "openai-compatible",
      modelId: "fixture-model",
      baseUrl: "https://ollama.com/",
      hasKey: true,
    },
  ]);
  const view = await renderSettings(false);
  try {
    await openPicker("Change Main model");
    expect(pickerOptions()).toEqual(["fixture-model"]);
  } finally {
    await view.unmount();
  }
});

it("keeps the Ollama preset to connect beside a saved local connection", async () => {
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([
    {
      id: "fixture",
      label: "OpenAI-compatible",
      provider: "openai-compatible",
      modelId: "fixture-model",
      baseUrl: "http://127.0.0.1:8000/v1",
      hasKey: false,
    },
  ]);
  const view = await renderSettings(false);
  try {
    await openPicker("Add fallback");
    expect(pickerOptions()).toEqual(["fixture-model", "Ollama Cloud"]);
    await choose("Ollama Cloud");
    expect(baseUrlField(view.container).value).toBe("https://ollama.com/v1");
  } finally {
    await view.unmount();
  }
});

it("keeps connection and key inside one advanced section for compatible servers", async () => {
  models.list.mockResolvedValue([compatibleEntry]);
  models.credentials.mockResolvedValue([]);
  const view = await renderSettings(false);
  try {
    await pick("Change Main model", "OpenAI-compatible");
    expect([...view.container.querySelectorAll("button")].some(button => button.textContent?.includes("Advanced settings"))).toBe(false);
    expect([...view.container.querySelectorAll("h3")].some(heading => heading.textContent === "Advanced settings")).toBe(true);
    expect([...view.container.querySelectorAll("button")].some((button) => button.textContent === "Connection settings")).toBe(false);
    expect([...view.container.querySelectorAll("button")].some((button) => button.textContent === "API key")).toBe(false);
  } finally {
    await view.unmount();
  }
});

it.each(["https://ollama.com", "https://ollama.com/v1/"])(
  "keeps Save enabled with a saved Ollama key at %s",
  async (baseUrl) => {
    vi.mocked(rpc.me).mockResolvedValue(account("openai-compatible", "fixture-model"));
    models.list.mockResolvedValue([compatibleEntry]);
    models.credentials.mockResolvedValue([
      {
        id: "fixture",
        label: "OpenAI-compatible",
        provider: "openai-compatible",
        modelId: "fixture-model",
        baseUrl: "https://ollama.com/v1",
        hasKey: true,
      },
    ]);
    const view = await renderSettings(false);
    try {
      await manage();
      expect(titles(view.container)).toContain("Ollama Cloud");
      await typeInto(baseUrlField(view.container), baseUrl);
      expect(buttons(view.container, "Save")[0]?.disabled).toBe(false);
      await typeInto(baseUrlField(view.container), "https://other.test/v1");
      await typeInto(baseUrlField(view.container), "https://ollama.com/v1/");
      expect(buttons(view.container, "Save")[0]?.disabled).toBe(false);
    } finally {
      await view.unmount();
    }
  },
);

it.each([undefined, "api_key", "oauth"])(
  "only enables subscription connection checks for saved OAuth credentials (%s)",
  async (authKind) => {
    vi.mocked(rpc.me).mockResolvedValue(account("openai-codex", "fixture-model"));
    models.list.mockResolvedValue([
      {
        provider: "openai-codex",
        providerName: "ChatGPT",
        id: "fixture-model",
        label: "Fixture model",
        billing: "Subscription",
        auth: "oauth",
        signIn: "device-code",
        oauthLabel: "Sign in with ChatGPT",
      },
    ]);
    models.credentials.mockResolvedValue(
      authKind
        ? [
            {
              id: "fixture",
              label: "ChatGPT",
              provider: "openai-codex",
              modelId: "fixture-model",
              authKind,
            },
          ]
        : [],
    );
    const view = await renderSettings();
    try {
      if (authKind) await manage();
      else await pick("Change Main model", "ChatGPT");
      expect(buttons(view.container, "Test connection")[0]?.disabled).toBe(authKind !== "oauth");
      expect(view.container.textContent).not.toContain("Test sign-in");
    } finally {
      await view.unmount();
    }
  },
);

it("shows the masked key form directly beside subscription sign-in in settings", async () => {
  vi.mocked(rpc.me).mockResolvedValue(account("anthropic", "claude-fixture"));
  models.list.mockResolvedValue([
    {
      provider: "anthropic",
      providerName: "Anthropic",
      id: "claude-fixture",
      label: "Claude fixture",
      billing: "",
      signIn: "auth-url",
    },
  ]);
  models.credentials.mockResolvedValue([
    {
      id: "fixture",
      label: "Anthropic",
      provider: "anthropic",
      modelId: "claude-fixture",
      hasKey: false,
      authKind: "oauth",
    },
  ]);
  const view = await renderSettings();
  try {
    await manage();
    expect([...view.container.querySelectorAll("button")].some(button => button.textContent?.includes("Or paste an API key"))).toBe(false);
    expect(keyField(view.container)).toBeTruthy();
    expect(buttons(view.container, "Connect API key")).toHaveLength(1);
    expect(view.container.textContent).not.toContain("Replace API key");
  } finally {
    await view.unmount();
  }
});

function providersSection() {
  const found = document.querySelector('[data-testid="model-providers"]');
  if (!found) throw new Error("Missing Providers section");
  return found as HTMLElement;
}

/** Opens a connection's page from the Providers list. */
async function openProvider(name: string) {
  await click(
    [...providersSection().querySelectorAll("button")].find((entry) => entry.textContent === name),
  );
}

const workCredential = {
  ...deepseekCredential,
  id: "cred-deepseek-work",
  label: "Work",
  isDefault: false,
};

it("lists every connection under Providers and adds another for a connected provider", async () => {
  models.credentials.mockResolvedValue([deepseekCredential, workCredential]);
  const view = await renderSettings();
  try {
    expect(
      [...providersSection().querySelectorAll('[data-testid^="model-provider-"]')].map(
        (row) => row.textContent,
      ),
    ).toEqual(["DeepSeek", "DeepSeek (Work)"]);
    await click(buttons(providersSection() as HTMLElement, "Add provider")[0]);
    expect(pickerOptions()).toContain("DeepSeek");
    await choose("DeepSeek");
    expect(titles(view.container)).toEqual(["Connect DeepSeek"]);
    expect(keyField(view.container).placeholder).toBe("sk-…");
    await typeInto(keyField(view.container), "sk-fixture-personal");
    await click(buttons(view.container, "Connect API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        apiKey: "sk-fixture-personal",
        credentialId: null,
        makeDefault: false,
      }),
    );
    expect(models.setRole).not.toHaveBeenCalled();
    expect(titles(view.container)).toEqual([]);
  } finally {
    await view.unmount();
  }
});

it("replaces one connection's key and disconnects only that connection", async () => {
  models.credentials.mockResolvedValue([deepseekCredential, workCredential]);
  const view = await renderSettings();
  try {
    await openProvider("DeepSeek (Work)");
    expect(titles(view.container)).toEqual(["DeepSeek (Work)"]);
    await typeInto(keyField(view.container), "sk-fixture-rotated");
    await click(buttons(view.container, "Replace API key")[0]);
    expect(models.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        apiKey: "sk-fixture-rotated",
        credentialId: "cred-deepseek-work",
      }),
    );

    await openProvider("DeepSeek (Work)");
    await click(buttons(view.container, "Disconnect")[0]);
    const confirm = buttons(view.container, "Disconnect");
    await click(confirm[confirm.length - 1]);
    expect(models.disconnect).toHaveBeenCalledWith({
      provider: "deepseek",
      credentialId: "cred-deepseek-work",
    });
  } finally {
    await view.unmount();
  }
});

it("keeps another connection's form when an earlier save finishes", async () => {
  models.list.mockResolvedValue([deepseekEntry, openrouterEntry]);
  models.credentials.mockResolvedValue([deepseekCredential]);
  let finishSave!: (value: unknown) => void;
  models.connect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  const view = await renderSettings();
  try {
    await openPicker("Add fallback");
    await choose("OpenRouter");
    await typeInto(keyField(view.container), "sk-fixture-router");
    await click(buttons(view.container, "Connect API key")[0]);
    // Fields wait for the save, so it cannot overwrite edits made meanwhile.
    expect(keyField(view.container).closest("fieldset")?.disabled).toBe(true);
    // The main model's connection opens while the first key still saves.
    await manage();
    expect(titles(view.container)).toEqual(["DeepSeek"]);
    await act(async () => {
      finishSave({ ...deepseekCredential, id: "cred-openrouter", provider: "openrouter" });
    });
    expect(titles(view.container)).toEqual(["DeepSeek"]);
    // The finished save's slot picker does not take over.
    expect(pickerOptions()).toEqual([]);
  } finally {
    await view.unmount();
  }
});

it("renames a connection", async () => {
  models.rename.mockResolvedValue({ ok: true });
  models.credentials.mockResolvedValue([deepseekCredential, workCredential]);
  const view = await renderSettings();
  try {
    await openProvider("DeepSeek (Work)");
    const input = view.container.querySelector<HTMLInputElement>("input[maxlength]");
    if (!input) throw new Error("Missing name field");
    expect(input.value).toBe("Work");
    await typeInto(input, "Client work");
    await act(async () => {
      input.form?.requestSubmit();
    });
    expect(models.rename).toHaveBeenCalledWith({
      credentialId: "cred-deepseek-work",
      label: "Client work",
    });
  } finally {
    await view.unmount();
  }
});

it("shows what a disconnect left, not a read sent before it", async () => {
  models.credentials.mockResolvedValue([deepseekCredential, workCredential]);
  const queryClient = testQueryClient();
  const first = await renderSettings(true, queryClient);
  await first.unmount();

  // The revisit's background read still lists Work when the disconnect lands.
  let releaseStale: () => void = () => undefined;
  models.credentials
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStale = () => resolve([deepseekCredential, workCredential]);
        }),
    )
    .mockResolvedValue([deepseekCredential]);
  const providerNames = () =>
    [...providersSection().querySelectorAll("button")].map((entry) => entry.textContent);
  const view = await renderSettings(true, queryClient);
  try {
    expect(providerNames()).toContain("DeepSeek (Work)");
    await openProvider("DeepSeek (Work)");
    await click(buttons(view.container, "Disconnect")[0]);
    const confirm = buttons(view.container, "Disconnect");
    await click(confirm[confirm.length - 1]);
    await act(async () => releaseStale());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(providerNames()).not.toContain("DeepSeek (Work)");
  } finally {
    await view.unmount();
  }
});

it("recovers provider reads after a network failure without presenting an empty disconnected directory", async () => {
  models.list.mockRejectedValue(new TypeError("Failed to fetch")); models.credentials.mockRejectedValue(new TypeError("Failed to fetch"));
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    expect(view.container.textContent).not.toContain("Failed to fetch");
    expect(view.container.textContent).toContain("Your providers could not be checked");
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.container.textContent).not.toContain("No results"); expect(view.container.textContent).not.toContain("No model catalog is available");
    models.list.mockResolvedValue([deepseekEntry]); models.credentials.mockResolvedValue([deepseekCredential]);
    await click([...view.container.querySelectorAll("button")].find(button => button.textContent === "Retry"));
    await act(async () => { await Promise.resolve(); });
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain("DeepSeek"); expect(models.connect).not.toHaveBeenCalled(); expect(models.disconnect).not.toHaveBeenCalled(); expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});
it("offers a translated retry for an isolated compact default-model read failure", async () => {
  models.role.mockRejectedValue(new TypeError("Failed to fetch"));
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    const role = view.container.querySelector('[data-testid="default-provider"]')!;
    expect(role.textContent).not.toContain("Failed to fetch");
    expect(role.querySelector('[role="alert"]')).not.toBeNull();
    models.role.mockResolvedValue({ primary: null, backups: [] });
    await click([...role.querySelectorAll("button")].find(button => button.textContent === "Retry"));
    expect(role.querySelector('[role="alert"]')).toBeNull(); expect(models.setRole).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});
it("retries failed provider reads on reconnect without writing a provider choice", async () => {
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  models.list.mockRejectedValue(new TypeError("Failed to fetch"));
  const view = await renderSettings(true, testQueryClient(), "account", true);
  try {
    models.list.mockResolvedValue([deepseekEntry]);
    await act(async () => window.dispatchEvent(new Event("online")));
    await act(async () => { await Promise.resolve(); });
    expect(view.container.querySelector('[role="alert"]')).toBeNull(); expect(models.setDefault).not.toHaveBeenCalled(); expect(models.connect).not.toHaveBeenCalled();
  } finally { visible.mockRestore(); await view.unmount(); }
});
