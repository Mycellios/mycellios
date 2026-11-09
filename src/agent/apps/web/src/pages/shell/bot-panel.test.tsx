// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import type { Bot } from "@rakazo/contracts";
import type * as UiWeb from "@rakazo/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/rpc", () => {
  const rpc = {
    bots: { get: vi.fn(), update: vi.fn(), restoreInstructions: vi.fn() },
    voice: { voices: vi.fn().mockResolvedValue([]) },
    models: {
      credentials: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
      mycelliosModels: vi.fn().mockResolvedValue([]),
      connect: vi.fn().mockResolvedValue({}),
    },
    me: vi.fn().mockResolvedValue(null),
  };
  return {
    rpc,
    rpcForSpace: () => rpc,
    createSpaceRpc: () => rpc,
    selectedSpaceId: () => null,
  };
});
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", async (importOriginal) => ({
  ...(await importOriginal<typeof UiWeb>()),
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  Switch: ({
    onCheckedChange,
    checked,
    ...props
  }: ComponentProps<"button"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  Toggle: ({
    onPressedChange: _onPressedChange,
    pressed,
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & {
    variant?: string;
    size?: string;
    pressed?: boolean;
    onPressedChange?: (pressed: boolean) => void;
  }) => (
    <button type="button" aria-pressed={pressed} {...props}>
      {props.children}
    </button>
  ),
}));
vi.mock("./avatar-studio-popover", () => ({
  AvatarStudioPopover: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <button
      type="button"
      aria-label="Avatar color"
      data-color={value}
      onClick={() => onChange(value === "blue" ? "ink" : "blue")}
    />
  ),
}));
vi.mock("./bot-credentials", () => ({ BotCredentialsSection: () => null }));
vi.mock("../ScratchpadSection", () => ({ ScratchpadSection: () => <h3>Open work</h3> }));
vi.mock("../KnowledgeSection", () => ({
  KnowledgeSection: () => <h3>Memory and skills</h3>,
}));

import { InstructionSettings } from "../../components/InstructionSettings";
import { spaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { BotSettings } from "./bot-panel";

const longInstructions = "I".repeat(4_000);

function bot(description = "Billing", overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    spaceId: "space-1",
    name: "Ada",
    title: "Helper",
    description,
    instructions: longInstructions,
    color: "ink",
    notifyOnFinish: true,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: "thread-1",
    preview: "",
    status: "idle",
    runErrorId: null,
    computerMode: "team",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    fleetManagement: false,
    disabledBuiltinTools: [],
    webhookConfigured: false,
    spawnKey: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const onSave = vi.fn(
  async (_patch: Parameters<ComponentProps<typeof BotSettings>["onSave"]>[0]) => undefined,
);

async function render(
  description = "Billing",
  overrides: Partial<Bot> = {},
  memoryProviderConfigured = false,
  focusModel = 0,
  onUseThisComputer?: () => Promise<void>,
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BotSettings
          onOpenConnections={() => undefined}
          focusModel={focusModel}
          bot={bot(description, overrides)}
          memoryProviderConfigured={memoryProviderConfigured}
          onSave={onSave}
          onExport={async () => undefined}
          onClear={() => undefined}
          {...(onUseThisComputer ? { onUseThisComputer } : {})}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function openSettingsPage(page: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`[data-settings-page="${page}"]`)!.click());
}

async function expandAdvanced() {
  await openSettingsPage("advanced");
}

function descriptionField(): HTMLTextAreaElement {
  const textarea =
    container.querySelector<HTMLTextAreaElement>('textarea[id$="-description"]') ??
    container.querySelector("textarea");
  if (!textarea) throw new Error("Missing description field");
  return textarea;
}

async function setDescription(value: string) {
  if (
    container.querySelector('[data-testid="bot-settings"]') &&
    !container.querySelector('[id$="-description"]')
  )
    await expandAdvanced();
  const textarea = descriptionField();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickSave() {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Save",
  );
  await act(async () => {
    if (button) button.click();
    else container.querySelector<HTMLButtonElement>('button[id$="-notify-finish"]')!.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSave.mockReset().mockResolvedValue(undefined);
  vi.mocked(rpc.bots.update).mockReset();
  vi.mocked(rpc.bots.get).mockReset();
  vi.mocked(rpc.models.mycelliosModels).mockReset().mockResolvedValue([]);
  vi.mocked(rpc.models.connect).mockReset().mockResolvedValue({} as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

it("offers current network models for one Mico and enables its choice without changing the main model", async () => {
  vi.mocked(rpc.me).mockResolvedValueOnce({ userId: "user-1", spaceId: "space-1" } as never);
  vi.mocked(rpc.models.credentials).mockResolvedValueOnce([{
    id: "network-key", provider: "openai-compatible", label: "Mycellios", hasKey: true,
    isDefault: false, baseUrl: "https://www.mycellios.com/v1", modelId: "old-chat", enabledModelIds: ["old-chat"],
  }]);
  vi.mocked(rpc.models.mycelliosModels).mockResolvedValueOnce([{
    provider: "openai-compatible", providerName: "Mycellios", id: "qwen3-8b", label: "Qwen3 8B", billing: "Uses your credits",
  }]);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('button[id$="-model"]')!.click());
  const model = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((option) => /qwen3[- ]8b/i.test(option.textContent ?? ""));
  await vi.waitFor(() => expect(model()).toBeDefined());
  await act(async () => model()!.click());
  await clickSave();
  expect(rpc.models.connect).toHaveBeenCalledWith(expect.objectContaining({ credentialId: "network-key", enabledModelIds: ["old-chat", "qwen3-8b"], makeDefault: false }));
  expect(onSave.mock.lastCall?.[0]).toMatchObject({ modelProvider: "openai-compatible", modelId: "qwen3-8b" });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

it("opens settings subpages and returns focus to the overview row", async () => {
  await render("Billing", {}, true);
  expect(container.querySelector('[data-testid="bot-profile-header"]')?.textContent).toContain("Ada");
  expect(container.querySelector('[id$="-model"]')).not.toBeNull();
  expect(container.querySelector('textarea[id$="-instructions"]')?.closest("[hidden]")).not.toBeNull();
  await openSettingsPage("instructions");
  expect(container.querySelector('textarea[id$="-instructions"]')?.closest("[hidden]")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Instructions");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
  expect(document.activeElement?.getAttribute("data-settings-page")).toBe("instructions");

  await openSettingsPage("computer");
  expect(container.textContent).toContain("Memory scope");
  expect(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "This PC",
    )?.disabled,
  ).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
  await openSettingsPage("permissions");
  expect(container.querySelector('[id$="-fleet-management"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
  await expandAdvanced();
  expect(container.querySelector('[id$="-disabled-tools"]')).not.toBeNull();
  expect(container.querySelector('[id$="-auto-speak"]')).not.toBeNull();
  expect(container.querySelector('[id$="-model"]')?.closest("[hidden]")).not.toBeNull();
});

it("binds and repairs This PC from the computer page", async () => {
  const onUseThisComputer = vi.fn(async () => undefined);
  await render("Billing", { computerMode: "dedicated" }, false, 0, onUseThisComputer);
  await openSettingsPage("computer");
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === "Use this PC",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(onUseThisComputer).toHaveBeenCalledTimes(1);
});

describe("BotSettings model choices", () => {
  it("submits DeepSeek API ids and does not offer a display label", async () => {
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([
      {
        id: "cred-deepseek",
        provider: "deepseek",
        label: "DeepSeek",
        hasKey: true,
        isDefault: true,
        modelId: "DeepSeek-V4.1-Flash",
      },
    ]);
    vi.mocked(rpc.models.list).mockResolvedValueOnce([
      {
        provider: "deepseek",
        providerName: "DeepSeek",
        id: "deepseek-flash",
        label: "DeepSeek V4.1 Flash",
        billing: "",
      },
      {
        provider: "deepseek",
        providerName: "DeepSeek",
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        billing: "",
      },
    ]);
    await render();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[id$="-model"]')!.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.some((option) => option.textContent?.includes("DeepSeek V4 Pro"))).toBe(true);
    const flash = options.find((option) => option.textContent?.includes("DeepSeek V4.1 Flash"));
    expect(flash).toBeDefined();
    await act(async () => flash!.click());
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ modelProvider: "deepseek", modelId: "deepseek-flash" });
  });
});

describe("BotSettings thinking options", () => {
  it("preserves saved thinking on a profile save when options are hidden", async () => {
    await render("Billing", {
      modelProvider: "openai-compatible",
      modelId: "beta",
      thinkingLevel: "high",
    });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("thinkingLevel");
  });

  it("shows the connection's thinking levels for a bot on a second enabled model", async () => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.mocked(rpc.models.credentials).mockResolvedValueOnce([
      {
        id: "newer",
        provider: "openai-compatible",
        label: "Newer",
        hasKey: true,
        isDefault: false,
        enabledModelIds: ["beta"],
        thinkingLevels: ["off"],
      },
      {
        id: "cred-compatible",
        provider: "openai-compatible",
        label: "Local server",
        hasKey: true,
        isDefault: true,
        modelId: "alpha",
        enabledModelIds: ["alpha", "beta"],
        thinkingLevels: ["off", "low", "high"],
      },
    ]);
    await render("Billing", { modelProvider: "openai-compatible", modelId: "beta" });
    await act(async () => {
      await Promise.resolve();
    });
    const [model, thinking] = [...container.querySelectorAll('[id$="-model"], [id$="-thinking"]')];
    expect(model?.textContent).toContain("beta");
    if (!(thinking instanceof HTMLSelectElement)) throw new Error("Missing thinking select");
    expect([...thinking.options].map((option) => option.value)).toEqual(["", "low", "high"]);
  });
});

describe("BotSettings bot management saves", () => {
  it("cannot restore a stale enabled value when another session disables it", async () => {
    await render("Billing", { fleetManagement: true });
    await render("Billing", { fleetManagement: false });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("fleetManagement");
  });

  it("restores the toggle when the immediate save fails", async () => {
    await render();
    await openSettingsPage("permissions");
    onSave.mockRejectedValueOnce(new Error("offline"));
    const toggle = container.querySelector<HTMLButtonElement>('button[id$="-fleet-management"]');
    if (!toggle) throw new Error("Missing switch");
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it.each([false, true])("saves only the bot management toggle from %s", async (enabled) => {
    await render("Billing", { fleetManagement: enabled });
    await openSettingsPage("permissions");
    const toggle = container.querySelector<HTMLButtonElement>('button[id$="-fleet-management"]');
    if (!toggle) throw new Error("Missing switch");
    await act(async () => {
      toggle.click();
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fleetManagement: !enabled });
    await clickSave();
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("fleetManagement");
  });
});

describe("BotSettings description saves", () => {
  it("leaves instructions off a save that does not edit the description", async () => {
    await render();
    await clickSave();
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("description");
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("instructions");
  });

  it("does not resend instructions when the bot prop stays on the old description", async () => {
    await render();
    await setDescription("Invoices");
    await clickSave();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      description: "Invoices",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");

    // The parent still passes the description from when the panel opened.
    await render();
    await clickSave();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).not.toHaveProperty("description");
    expect(onSave.mock.calls[1]?.[0]).not.toHaveProperty("instructions");
  });

  it("still saves a description edited back to the stale prop value", async () => {
    await render();
    await setDescription("Invoices");
    await clickSave();
    await render();
    await setDescription("Billing");
    await clickSave();
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({
      description: "Billing",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");
  });

  it("keeps the previous description as the baseline when a save fails", async () => {
    onSave.mockRejectedValueOnce(new Error("offline"));
    await render();
    await setDescription("Invoices");
    await clickSave();
    await clickSave();
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({
      description: "Invoices",
    });
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("instructions");
  });
});

describe("instruction settings refresh", () => {
  it("refreshes a saved field against its latest baseline before the parent catches up", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Saved edit" });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Saved edit");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await act(async () => {
      root.render(<InstructionSettings bot={{ ...initial, instructions: "External update" }} />);
    });
    expect(descriptionField().value).toBe("External update");
    await setDescription("Fresh edit");
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Fresh edit" });
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenLastCalledWith({
      botId: initial.id,
      instructions: "Fresh edit",
      expectedInstructions: "External update",
    });
  });
  it("keeps a dirty draft when run completion refreshes the bot", async () => {
    const initial = bot();
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, updatedAt: "2026-09-02T00:00:00.000Z" }} />,
      );
    });
    expect(descriptionField().value).toBe("Unsaved instructions");
  });
  it("saves the original draft baseline after a newer instruction refresh", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({
      ...initial,
      instructions: "Unsaved instructions",
    });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, instructions: "Newer saved instructions" }} />,
      );
    });
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenCalledWith({
      botId: initial.id,
      instructions: "Unsaved instructions",
      expectedInstructions: initial.instructions,
    });
  });
  it("reloads the current instructions and baseline after a conflict", async () => {
    const initial = bot();
    vi.mocked(rpc.bots.update).mockRejectedValueOnce(
      new ORPCError("CONFLICT", { message: "Instructions changed" }),
    );
    vi.mocked(rpc.bots.get)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ...initial,
        instructions: "Newer saved instructions",
      });
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await setDescription("Unsaved instructions");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    const reload = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload",
    );
    if (!reload) throw new Error("Missing reload action");
    expect(descriptionField().value).toBe("Unsaved instructions");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      reload.click();
    });
    expect(descriptionField().value).toBe("Unsaved instructions");
    expect(container.textContent).toContain("Reload");
    await act(async () => {
      reload.click();
    });
    expect(descriptionField().value).toBe("Newer saved instructions");
    vi.mocked(rpc.bots.update).mockResolvedValueOnce({ ...initial, instructions: "Fresh draft" });
    await setDescription("Fresh draft");
    await act(async () => {
      descriptionField().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(rpc.bots.update).toHaveBeenLastCalledWith({
      botId: initial.id,
      instructions: "Fresh draft",
      expectedInstructions: "Newer saved instructions",
    });
  });
  it("refreshes pristine instructions after an external update", async () => {
    const initial = bot();
    await act(async () => {
      root.render(<InstructionSettings bot={initial} />);
    });
    await act(async () => {
      root.render(
        <InstructionSettings bot={{ ...initial, instructions: "Approved replacement" }} />,
      );
    });
    expect(descriptionField().value).toBe("Approved replacement");
  });
});

it("uses the empty label placeholder and cancels an inline name edit", async () => {
  await render("", { title: "" });
  expect(container.textContent).toContain("Add a label");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit name"]')!.click(),
  );
  const input = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  expect(input.value).toBe("Ada");
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('[aria-label="Name"]')).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});

it("focuses the visible model control without opening Advanced for a model deep link", async () => {
  await render("", {}, false, 1);
  expect(container.querySelector('[aria-label="Back"]')).toBeNull();
  expect(document.activeElement?.id.endsWith("-model")).toBe(true);
});

it("saves inline edits on blur and clears a label on Enter", async () => {
  await render();
  for (const [editLabel, label, value, key] of [
    ["Edit name", "Name", "Atlas", "name"],
    ["Edit label", "Title", "", "title"],
  ]) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[aria-label="${editLabel}"]`)!.click(),
    );
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      if (key === "name") input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSave.mock.lastCall?.[0]).toHaveProperty(key!, value);
  }
  expect(container.textContent).toContain("Add a label");
});

it.each(["color", "notifyOnFinish"])(
  "restores the last accepted %s after an automatic save fails",
  async (field) => {
    await render();
    const control = () =>
      container.querySelector<HTMLButtonElement>(
        field === "color" ? '[aria-label="Avatar color"]' : 'button[id$="-notify-finish"]',
      )!;
    const value = () => control().getAttribute(field === "color" ? "data-color" : "aria-checked");
    await act(async () => control().click());
    expect(value()).toBe(field === "color" ? "blue" : "false");
    onSave.mockRejectedValueOnce(new Error("offline"));
    await act(async () => control().click());
    expect(value()).toBe(field === "color" ? "blue" : "false");
    expect(container.textContent).toContain("offline");
    expect(
      [...container.querySelectorAll("button")].some((node) => node.textContent === "Save"),
    ).toBe(false);
  },
);

it("saves a color change back to the initial value after a successful automatic save", async () => {
  await render();
  const control = () => container.querySelector<HTMLButtonElement>('[aria-label="Avatar color"]')!;
  await act(async () => control().click());
  await act(async () => control().click());
  expect(onSave.mock.lastCall?.[0]).toHaveProperty("color", "ink");
});

describe("BotSettings cached data", () => {
  it("shows cached voices at once and refreshes them in the background", async () => {
    queryClient.setQueryData(spaceQueries(null, null).voice.voices.queryKey({ input: {} }), [
      { id: "cached-voice", label: "Cached voice" },
    ]);
    vi.mocked(rpc.voice.voices)
      .mockClear()
      .mockReturnValueOnce(new Promise(() => undefined));
    await render();
    await expandAdvanced();
    expect(container.querySelector('[id$="-voice"]')?.textContent).toContain("Cached voice");
    expect(rpc.voice.voices).toHaveBeenCalledTimes(1);
  });

  it("follows a newer bot in fields not edited and keeps the ones that were", async () => {
    await render("Billing", { computerMode: "team" });
    await setDescription("Invoices");
    await render("Remote edit", {
      name: "Grace",
      computerMode: "dedicated",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(container.querySelector('[aria-label="Edit name"]')?.textContent).toBe("Grace");
    expect(descriptionField().value).toBe("Invoices");
    await clickSave();
    const patch = onSave.mock.lastCall?.[0];
    expect(patch).toMatchObject({ description: "Invoices", computerMode: "dedicated" });
    expect(patch).not.toHaveProperty("name");
  });
});

it("keeps the per-agent model picker visible outside advanced settings", async () => {
  await render();
  const section = container.querySelector('[data-testid="bot-model-settings"]');

  expect(section).not.toBeNull();
  expect(section?.textContent).toContain("Model for this agent");
  expect(section?.querySelector('[id$="-model"]')).not.toBeNull();
  expect(section?.closest("[hidden]")).toBeNull();
});
