// @vitest-environment jsdom
import type { Bot } from "@mycellios/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Options = { id: string; position?: string; duration?: number; action?: { label: string; onClick: () => void }; onDismiss?: () => void };
const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  queryOptions: [] as Array<Record<string, unknown>>,
  // Like sonner, a programmatic dismiss also reports onDismiss for a toast on screen.
  open: new Map<string, { onDismiss?: () => void }>(),
  toast: Object.assign(vi.fn((_title: string, options: { id: string; onDismiss?: () => void }) => { mocks.open.set(options.id, options); }), {
    dismiss: vi.fn((id: string) => { const options = mocks.open.get(id); mocks.open.delete(id); options?.onDismiss?.(); }),
    error: vi.fn(),
  }),
  install: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, i) => `${text}${i ? values[i - 1] : ""}${part}`, ""),
}) }));
vi.mock("@mycellios/ui-web", () => ({ toast: mocks.toast }));
vi.mock("../../components/ProviderLogo", () => ({ ProviderLogo: () => null }));
vi.mock("../../lib/query", () => ({ useSpaceQueries: () => ({ engines: { forBot: { queryOptions: (options: unknown) => ({ queryKey: ["engines", options] }) } } }) }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => ({ engines: { install: mocks.install } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => (mocks.queryOptions.push(options), { data: options.enabled ? mocks.data : undefined, refetch: mocks.refetch }),
}));
import { EngineUpdateToasts } from "./engine-update-toasts";

const release = { engine: "claude", version: "2.1.332", current: "2.1.330", source: "npm", package: "@anthropic-ai/claude-code", bytes: 200_000_000 };
const bot = (computerMode: Bot["computerMode"] = "dedicated") => ({ id: "mico", computerMode } as Bot);
let root: Root;
let container: HTMLDivElement;
const lastCall = () => mocks.toast.mock.calls.at(-1) as [string, Options];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.toast.mockClear(); mocks.toast.dismiss.mockClear(); mocks.open.clear(); mocks.install.mockReset().mockResolvedValue({ status: "installing" });
  mocks.queryOptions.length = 0; mocks.data = { computer: "desktop", engines: ["claude"], updates: [release], installing: [] };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (value: Bot) => act(() => root.render(<EngineUpdateToasts bot={value} />));

it("offers the PC's newer CLI at the top right and starts that exact update", async () => {
  render(bot());
  const [title, options] = lastCall();
  expect(title).toBe("Claude Code update available");
  expect(options).toMatchObject({ id: "engine-update-claude", position: "top-right", duration: Number.POSITIVE_INFINITY });
  await act(async () => options.action!.onClick());
  expect(mocks.install).toHaveBeenCalledExactlyOnceWith({ botId: "mico", engine: "claude", version: "2.1.332" });
  expect(mocks.refetch).toHaveBeenCalled();
});

it("updates the same notice with progress, then says it finished and closes by itself", () => {
  render(bot());
  mocks.data = { computer: "desktop", engines: ["claude"], updates: [release], installing: [{ engine: "claude", state: "downloading", receivedBytes: 78_000_000, totalBytes: 200_000_000 }] };
  render(bot());
  let [title, options] = lastCall();
  expect(title).toBe("Updating Claude Code");
  expect(options).toMatchObject({ id: "engine-update-claude", duration: Number.POSITIVE_INFINITY, action: undefined });
  mocks.data = { computer: "desktop", engines: ["claude"], updates: [], installing: [] };
  render(bot());
  [title, options] = lastCall();
  expect(title).toBe("Claude Code updated");
  expect(options.duration).toBe(6_000);
});

it("does not offer again a version the person closed", () => {
  render(bot());
  act(() => { mocks.open.delete("engine-update-claude"); lastCall()[1].onDismiss!(); });
  mocks.toast.mockClear();
  mocks.data = { ...(mocks.data as object) };
  render(bot());
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("never asks a server or Team computer for CLI updates", () => {
  render(bot("team"));
  expect(mocks.queryOptions.at(-1)).toMatchObject({ enabled: false });
  expect(mocks.toast).not.toHaveBeenCalled();
});
