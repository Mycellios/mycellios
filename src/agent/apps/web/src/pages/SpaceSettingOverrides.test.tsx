// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { spaceSettings, engines, rpcForSpace, panels } = vi.hoisted(() => {
  const spaceSettings = { overrides: vi.fn(), setOverride: vi.fn() };
  const engines = { list: vi.fn(), installOpenCode: vi.fn() };
  return {
    spaceSettings,
    engines,
    // The other namespaces are only refreshed after a change.
    rpcForSpace: vi.fn((_spaceId: string) => ({
      spaceSettings,
      models: {},
      me: vi.fn(),
      voice: {},
      approvalRules: {},
      autoReview: {},
      engines,
    })),
    panels: [] as string[],
  };
});

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`),
  }),
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
}));
vi.mock("../lib/rpc", () => ({
  rpc: { spaceSettings },
  rpcForSpace,
  createSpaceRpc: () => ({ spaceSettings }),
  selectedSpaceId: () => "selected",
}));
vi.mock("./ModelSettingsOverlay", () => ({
  ModelSettingsOverlay: ({ scope }: { scope: string }) => {
    panels.push(`models:${scope}`);
    return <div data-testid="models-panel" />;
  },
}));
vi.mock("./VoiceSettingsOverlay", () => ({
  VoiceSettingsOverlay: ({ scope }: { scope: string }) => {
    panels.push(`voice:${scope}`);
    return <div data-testid="voice-panel" />;
  },
}));
vi.mock("../components/ApprovalRulesSettings", () => ({
  ApprovalRulesSettings: ({ scope }: { scope: string }) => {
    panels.push(`confirmations:${scope}`);
    return <div data-testid="confirmations-panel" />;
  },
}));

import { QueryUserProvider } from "../lib/query";
import { SpaceRpcProvider } from "../lib/space-rpc";
import type { SpaceSetting } from "@rakazo/contracts";
import { SpaceSettingOverrides } from "./SpaceSettingOverrides";

let container: HTMLDivElement;
let root: Root;

async function render(setting: SpaceSetting = "models") {
  const children = <SpaceSettingOverrides setting={setting} onClose={() => undefined} onRequestLeave={(next) => next()} />;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <QueryUserProvider value="user">
          <SpaceRpcProvider spaceId="space-a">{children}</SpaceRpcProvider>
        </QueryUserProvider>
      </QueryClientProvider>,
    );
  });
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`Missing ${label}`);
  await act(async () => target.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  panels.length = 0;
  spaceSettings.overrides.mockReset();
  spaceSettings.setOverride.mockReset();
  engines.list.mockReset().mockResolvedValue([{ id: "opencode", name: "OpenCode", available: true }]);
  engines.installOpenCode.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("follows the account until a setting is customized, then edits the Space's own copy", async () => {
  spaceSettings.overrides.mockResolvedValue([]);
  spaceSettings.setOverride.mockImplementation(
    async ({ setting, enabled }: { setting: string; enabled: boolean }) =>
      enabled ? [setting] : [],
  );
  await render("voice");
  await vi.waitFor(() => expect(button("Customize Voice")).not.toBeNull());
  expect(button("Customize Voice")?.textContent).toBe("Customize");
  expect(button("Customize Approvals")).toBeNull();
  expect(container.textContent?.match(/Your defaults/g)).toHaveLength(1);
  expect(panels).toEqual([]);
  // The calls go to the space these settings are bound to, not the selected one.
  expect(rpcForSpace).toHaveBeenCalledWith("space-a");

  await click("Customize Voice");
  expect(spaceSettings.setOverride).toHaveBeenLastCalledWith({ setting: "voice", enabled: true });
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="voice-panel"]')).not.toBeNull(),
  );
  expect(new Set(panels)).toEqual(new Set(["voice:space"]));
  expect(button("Use defaults for Voice")?.textContent).toBe("Use defaults");
  expect(container.textContent).not.toContain("Your defaults");

  await click("Use defaults for Voice");
  expect(spaceSettings.setOverride).toHaveBeenLastCalledWith({ setting: "voice", enabled: false });
  await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-panel"]')).toBeNull());
  expect(button("Customize Voice")).not.toBeNull();
});

it("opens the panels a Space already customizes", async () => {
  spaceSettings.overrides.mockResolvedValue(["models", "confirmations"]);
  await render();
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="models-panel"]')).not.toBeNull(),
  );
  expect(container.querySelector('[data-testid="confirmations-panel"]')).toBeNull();
  expect(container.querySelector('[data-testid="voice-panel"]')).toBeNull();
  await vi.waitFor(() => expect(container.textContent).toContain("OpenCode"));
  expect(new Set(panels)).toEqual(new Set(["models:space"]));
});

it("keeps the row as it was when customizing fails", async () => {
  spaceSettings.overrides.mockResolvedValue([]);
  spaceSettings.setOverride.mockRejectedValue(new Error("Space is unavailable"));
  await render();
  await vi.waitFor(() => expect(button("Customize Models")).not.toBeNull());
  await click("Customize Models");
  await vi.waitFor(() => expect(container.textContent).toContain("Space is unavailable"));
  expect(button("Customize Models")).not.toBeNull();
  expect(panels).toEqual([]);
});

it("downloads the built-in CLI for the edited space and shows the managed version", async () => {
  spaceSettings.overrides.mockResolvedValue([]);
  engines.list.mockResolvedValue([
    { id: "opencode", name: "OpenCode", available: false, canInstall: true },
  ]);
  engines.installOpenCode.mockImplementation(async () => {
    engines.list.mockResolvedValue([
      { id: "opencode", name: "OpenCode", available: true, managedVersion: "1.19.5" },
    ]);
    return { installed: true };
  });
  await render();
  const download = () => [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Download",
  );
  await vi.waitFor(() => expect(download()).toBeDefined());
  await act(async () => download()?.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Version 1.19.5 · Downloaded by Mycellios"));
  expect(engines.installOpenCode).toHaveBeenCalledOnce();
  expect(download()).toBeUndefined();
});
