// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
}));

const delayedDialog = vi.hoisted(() => ({ enabled: false }));
const developer = vi.hoisted(() => ({ enabled: true }));
vi.mock("../lib/developer-mode", () => ({ useDeveloperMode: () => [developer.enabled, vi.fn()] }));

vi.mock("@rakazo/ui-web", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({
    children,
    showCloseButton: _showCloseButton,
    initialFocus: _initialFocus,
    ...props
  }: { children?: ReactNode; showCloseButton?: boolean; initialFocus?: unknown } & Omit<
    React.ComponentProps<"div">,
    "children"
  >) => {
    const [mounted, setMounted] = useState(!delayedDialog.enabled);
    useEffect(() => setMounted(true), []);
    return mounted ? <div {...props}>{children}</div> : null;
  },
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  OptionSelect: ({
    options,
    value,
    onValueChange,
    "data-testid": testId,
  }: {
    options: readonly { value: string; label: string }[];
    value: string;
    onValueChange: (value: string) => void;
    "data-testid"?: string;
  }) => (
    <div>
      <button type="button" data-testid={testId}>
        {options.find((option) => option.value === value)?.label}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./AccountSettingsOverlay", () => ({
  ComputerSettingsPanel: () => null,
  GeneralSettingsPanels: () => null,
  UpdatesSettingsPanel: () => null,
  UsageSettingsPanel: () => null,
}));
vi.mock("./RunLogsSettingsPanel", () => ({
  RunLogsSettingsPanel: () => <p>Execution log panel</p>,
}));
const { memoryConfigs, memoryConfigChange, providerConfig, updaterStatus } = vi.hoisted(() => ({
  memoryConfigs: [] as unknown[],
  memoryConfigChange: { current: (_config: unknown) => {} },
  providerConfig: vi.fn(async (_spaceId: string): Promise<unknown> => null),
  updaterStatus: vi.fn(async (): Promise<unknown> => ({ installKind: "compose" })),
}));
const spaceBots = vi.hoisted(() => vi.fn(async (_spaceId: string): Promise<unknown[]> => []));
vi.mock("../lib/rpc", () => ({
  rpc: { updater: { status: updaterStatus } },
  createSpaceRpc: () => ({
    memory: { providerConfig: () => providerConfig("") },
    bots: { list: () => spaceBots("") },
  }),
  selectedSpaceId: () => null,
  rpcForSpace: (spaceId: string) => ({
    memory: { providerConfig: () => providerConfig(spaceId) },
    bots: { list: () => spaceBots(spaceId) },
  }),
}));
vi.mock("./BillingSettingsPanel", () => ({ BillingSettingsPanel: () => null }));
vi.mock("./MemorySettingsOverlay", () => ({
  MemorySettingsOverlay: ({
    config,
    onConfigChange,
  }: {
    config: unknown;
    onConfigChange: (config: unknown) => void;
  }) => {
    memoryConfigs.push(config);
    memoryConfigChange.current = onConfigChange;
    return null;
  },
}));
vi.mock("./SpaceSettingsPanel", () => ({
  SpaceSettingsPanel: ({
    space,
    onDelete,
  }: {
    space: { name: string };
    onDelete: () => Promise<void>;
  }) => (
    <button type="button" data-testid="space-settings" onClick={() => void onDelete()}>
      {space.name}
    </button>
  ),
}));
const { scopes, recordScope } = vi.hoisted(() => {
  const scopes: string[] = [];
  return {
    scopes,
    recordScope:
      (name: string) =>
      ({ scope }: { scope: string }) => {
        scopes.push(`${name}:${scope}`);
        return null;
      },
  };
});
vi.mock("./ModelSettingsOverlay", () => ({ ModelSettingsOverlay: recordScope("models") }));
vi.mock("./VoiceSettingsOverlay", () => ({ VoiceSettingsOverlay: recordScope("voice") }));
vi.mock("../components/ApprovalRulesSettings", () => ({
  ApprovalRulesSettings: recordScope("confirmations"),
}));
vi.mock("../components/ComputersUnavailableHint", () => ({
  computersAreUnavailable: () => false,
}));

import { SettingsOverlay } from "./SettingsOverlay";

it("hides developer navigation and a direct logs URL until enabled", async () => {
  developer.enabled = false;
  const view = await render({ section: "logs" });
  try {
    expect(view.container.querySelector('[data-testid="settings-nav-logs"]')).toBeNull();
    expect(view.container.textContent).not.toContain("Execution log panel");
    expect(
      view.container
        .querySelector('[data-testid="user-settings"]')
        ?.getAttribute("data-settings-section"),
    ).toBe("general");
    developer.enabled = true;
    await view.rerender({ section: "logs" });
    expect(view.container.textContent).toContain("Execution log panel");
    developer.enabled = false;
    await view.rerender({ section: "logs" });
    expect(view.container.textContent).not.toContain("Execution log panel");
  } finally {
    developer.enabled = true;
    await view.cleanup();
  }
});

it("reveals the active section after the settings portal mounts", async () => {
  delayedDialog.enabled = true;
  const reveal = vi.fn();
  const previousReveal = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: reveal });
  const scrollWidth = vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(1000);
  const clientWidth = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(300);
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    view = await render({ section: "logs" });
    expect(reveal).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(reveal.mock.contexts).toContain(
      view.container.querySelector('[data-testid="settings-nav-logs"]'),
    );
    expect(
      view.container.querySelector<HTMLButtonElement>('[aria-label="Next settings sections"]')
        ?.disabled,
    ).toBe(false);
  } finally {
    await view?.cleanup();
    delayedDialog.enabled = false;
    scrollWidth.mockRestore();
    clientWidth.mockRestore();
    if (previousReveal) Object.defineProperty(Element.prototype, "scrollIntoView", previousReveal);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

it("opens execution logs from settings with the current space visible", async () => {
  const view = await render({ section: "logs", space: acme, spaces });
  try {
    expect(view.container.textContent).toContain("Execution log panel");
    expect(
      view.container
        .querySelector('[data-testid="settings-nav-logs"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(view.container.querySelector('[data-testid="settings-space"]')?.textContent).toContain(
      "Acme",
    );
  } finally {
    await view.cleanup();
  }
});

const acme = { id: "space-a", name: "Acme" };
const spaces = [acme, { id: "space-b", name: "Beta" }];

async function render(props: Partial<React.ComponentProps<typeof SettingsOverlay>>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rerender = async (next: Partial<React.ComponentProps<typeof SettingsOverlay>>) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SettingsOverlay
            name="Jamie"
            onUsageOpen={() => undefined}
            timezone={null}
            onTimezoneChange={async () => undefined}
            memoryConfig={null}
            onMemoryConfigChange={() => undefined}
            onClose={() => undefined}
            section="general"
            onSectionChange={() => undefined}
            {...next}
          />
        </QueryClientProvider>,
      );
    });
  };
  await rerender(props);
  return {
    container,
    rerender,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("names the space a space-scoped section acts on and switches it in place", async () => {
  const onSpaceChange = vi.fn();
  const { container, cleanup } = await render({
    space: acme,
    spaces,
    onSpaceChange,
    section: "memory",
  });
  try {
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="settings-space"]');
    if (!trigger) throw new Error("Missing space switcher");
    expect(trigger.textContent).toBe("Acme");

    await act(async () => trigger.click());
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["Acme", "Beta"]);

    await act(async () => options[1]?.click());

    await vi.waitFor(() => expect(onSpaceChange).toHaveBeenCalledWith("space-b"));
  } finally {
    await cleanup();
  }
});

it("opens the Space section for the space it acts on, with the space picker", async () => {
  const onDeleteSpace = vi.fn(async () => undefined);
  const { container, cleanup } = await render({
    space: { ...acme, canDelete: true },
    spaces,
    onSpaceChange: vi.fn(),
    onDeleteSpace,
    section: "space",
  });
  try {
    const nav = [...container.querySelectorAll('[data-testid^="settings-nav-"]')].map((item) =>
      item.getAttribute("data-testid"),
    );
    // The account's sections come first; the per-space ones sit together under the picker.
    expect(nav.slice(0, 6)).toEqual([
      "settings-nav-general",
      "settings-nav-profile",
      "settings-nav-agents",
      "settings-nav-models",
      "settings-nav-notifications",
      "settings-nav-voice",
    ]);
    expect(container.querySelector('[data-testid="settings-space"]')?.textContent).toBe("Acme");
    const panel = container.querySelector<HTMLButtonElement>('[data-testid="space-settings"]');
    expect(panel?.textContent).toBe("Acme");
    await act(async () => panel?.click());
    expect(onDeleteSpace).toHaveBeenCalledWith("space-a");
  } finally {
    await cleanup();
  }
});

it("reports a section picked in the nav so the shell can keep it in the URL", async () => {
  const onSectionChange = vi.fn();
  const { container, cleanup } = await render({ onSectionChange });
  try {
    const usage = container.querySelector<HTMLButtonElement>('[data-testid="settings-nav-usage"]');
    if (!usage) throw new Error("Missing Usage nav item");
    await act(async () => usage.click());
    expect(onSectionChange).toHaveBeenCalledWith("usage");
  } finally {
    await cleanup();
  }
});

it("opens a linked billing section once billing turns out to be on", async () => {
  const { container, rerender, cleanup } = await render({
    section: "billing",
    billingEnabled: false,
  });
  const shown = () =>
    container.querySelector("[data-settings-section]")?.getAttribute("data-settings-section");
  try {
    expect(shown()).toBe("general");
    await rerender({ section: "billing", billingEnabled: true });
    expect(shown()).toBe("billing");
  } finally {
    await cleanup();
  }
});

it("shows no space label or switcher when there is only one space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces: [acme],
    onSpaceChange: vi.fn(),
    section: "space",
  });
  try {
    expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it("shows no space picker on sections that are not per space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces,
    onSpaceChange: vi.fn(),
    section: "general",
  });
  try {
    expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it("edits the account's models, voice, and confirmations with no space picker", async () => {
  scopes.length = 0;
  const props = { space: acme, spaces, onSpaceChange: vi.fn() };
  const { container, rerender, cleanup } = await render({ ...props, section: "models" });
  try {
    for (const section of ["models", "voice", "confirmations"] as const) {
      await rerender({ ...props, section });
      expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
    }
    expect(new Set(scopes)).toEqual(
      new Set(["models:account", "voice:account", "confirmations:account"]),
    );
  } finally {
    await cleanup();
  }
});

it("never hands one space's memory config to another space's panel", async () => {
  const shared = { provider: "mem0", defaultMemoryScope: "shared" };
  providerConfig.mockImplementation(async (spaceId) => (spaceId === "space-b" ? shared : null));
  const gamma = { id: "space-c", name: "Gamma" };
  const props = {
    space: spaces[1],
    spaces: [...spaces, gamma],
    currentSpaceId: "space-a",
    onSpaceChange: vi.fn(),
    section: "memory" as const,
  };
  const { rerender, cleanup } = await render(props);
  try {
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(shared));
    memoryConfigs.length = 0;
    // The parent answers onSpaceChange by passing the new space back in.
    await rerender({ ...props, space: gamma });
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBeNull());
    expect(memoryConfigs).not.toContain(shared);
  } finally {
    await cleanup();
  }
});

it("withholds memory connection controls after a failed load and retries the edited space", async () => {
  memoryConfigs.length = 0;
  providerConfig.mockReset();
  providerConfig.mockRejectedValueOnce(new Error("Memory service unavailable"));
  let resolveRetry: (config: unknown) => void = () => undefined;
  providerConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
  );
  const onMemoryConfigChange = vi.fn();
  const { container, cleanup } = await render({
    space: spaces[1],
    currentSpaceId: "space-a",
    section: "memory",
    onMemoryConfigChange,
  });
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("Memory service unavailable"));
    expect(memoryConfigs).not.toContain(null);
    const rendersBeforeRetry = memoryConfigs.length;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Memory service unavailable"),
    );
    expect(memoryConfigs.length).toBeGreaterThan(rendersBeforeRetry);
    expect(memoryConfigs.at(-1)).toBeUndefined();
    expect(providerConfig.mock.calls.map(([spaceId]) => spaceId)).toEqual(["space-b", "space-b"]);
    const config = { provider: "mem0", defaultMemoryScope: "shared" };
    await act(async () => resolveRetry(config));
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(config));
    expect(container.textContent).not.toContain("Retry");
    expect(onMemoryConfigChange).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

it("keeps another space's saved memory config when an older read lands after it", async () => {
  memoryConfigs.length = 0;
  let resolveRead: (config: unknown) => void = () => undefined;
  providerConfig.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  const { cleanup } = await render({
    space: spaces[1],
    currentSpaceId: "space-a",
    section: "memory",
  });
  try {
    await vi.waitFor(() => expect(providerConfig).toHaveBeenCalledTimes(1));
    const saved = { provider: "mem0", defaultMemoryScope: "shared" };
    await act(async () => memoryConfigChange.current(saved));
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(saved));
    await act(async () => resolveRead(null));
    // Query updates reach components on a timer; let any late write land.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(memoryConfigs.at(-1)).toBe(saved);
  } finally {
    await cleanup();
  }
});

const updatesNav = (container: HTMLElement) =>
  container.querySelector('[data-testid="settings-nav-updates"]');

it("loads the edited Space's Micos rather than showing an empty current-Space roster", async () => {
  spaceBots
    .mockReset()
    .mockResolvedValue([
      { id: "foreign-mico", spaceId: "space-b", name: "Other Space Mico", notifyOnFinish: true },
    ]);
  const view = await render({ space: spaces[1], currentSpaceId: "space-a", section: "agents" });
  try {
    await vi.waitFor(() => expect(view.container.textContent).toContain("Other Space Mico"));
    expect(spaceBots).toHaveBeenCalledWith("space-b");
    expect(view.container.textContent).not.toContain("No Micos in this space.");
  } finally {
    await view.cleanup();
  }
});

it("does not report an empty roster when another Space's Mico read fails, and retries that Space", async () => {
  spaceBots
    .mockReset()
    .mockRejectedValueOnce(new Error("Mico list unavailable"))
    .mockResolvedValue([
      { id: "retried-mico", spaceId: "space-b", name: "Recovered Mico", notifyOnFinish: true },
    ]);
  const view = await render({ space: spaces[1], currentSpaceId: "space-a", section: "agents" });
  try {
    await vi.waitFor(() => expect(view.container.querySelector('[role="alert"]')).not.toBeNull());
    expect(view.container.textContent).not.toContain("No Micos in this space.");
    const retry = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry!.click());
    await vi.waitFor(() => expect(view.container.textContent).toContain("Recovered Mico"));
    expect(spaceBots.mock.calls.map(([id]) => id)).toEqual(["space-b", "space-b"]);
  } finally {
    await view.cleanup();
  }
});

it("offers client updates in web without requesting server deployment authority", async () => {
  const { container, cleanup } = await render({});
  try {
    expect(updatesNav(container)).not.toBeNull();
    expect(updaterStatus).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

it("shows Updates in the desktop app", async () => {
  vi.stubGlobal("rakazoDesktop", { update: {} });
  const { container, cleanup } = await render({});
  try {
    expect(updatesNav(container)).not.toBeNull();
  } finally {
    await cleanup();
  }
});
