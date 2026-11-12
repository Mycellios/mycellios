// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MycelliosProvider } from "./mycellios-provider";
import { ProvidersSection } from "./providers-section";
import { mkdirSync, writeFileSync } from "node:fs";
const mock = vi.hoisted(() => ({ connect: vi.fn(), caps: vi.fn() }));
vi.mock("../../lib/auth-capabilities", () => ({ fetchAuthCapabilities: mock.caps }));
vi.mock("../../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ models: { connectMycellios: mock.connect } }),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts[0] }),
}));
const mounted: Array<() => void> = [];
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((cleanup) => cleanup()));
  vi.clearAllMocks();
});
async function render(connected = false, directory = false, accountEnabled = true) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.caps.mockResolvedValue({ mycelliosAccount: accountEnabled });
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const refreshed = vi.fn();
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mounted.push(() => {
    root.unmount();
    query.clear();
    div.remove();
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={query}>
        <ul>
          <MycelliosProvider directory={directory}
            credential={
              connected
                ? {
                    id: "owned",
                    provider: "openai-compatible",
                    label: "Mycellios",
                    hasKey: true,
                    isDefault: true,
                    headerNames: ["x-mycellios-funding"],
                  }
                : undefined
            }
            onConnected={refreshed}
          />
        </ul>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(div.textContent).toContain("Mycellios"));
  if (!connected && accountEnabled) await vi.waitFor(() => expect(div.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false));
  return { div, refreshed };
}
describe("built-in Mycellios provider", () => {
  it("does not ask an already signed-in local user to connect or sign in to a second account", async () => {
    const { div } = await render(false, true, false);
    await vi.waitFor(() => expect(div.textContent).toContain("Credits not enabled here"));
    expect(div.textContent).toContain("You are signed in");
    expect(div.textContent).not.toContain("Sign in with Mycellios");
    expect(div.textContent).not.toContain("Not connected");
    expect(div.querySelector("button")).toBeNull();
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it("activates models with the current account instead of offering another login", async () => {
    const { div } = await render(false, true);
    expect(div.textContent).toContain("Use my credits");
    expect(div.textContent).not.toContain("Connect Mycellios");
    expect(div.textContent).not.toContain("Sign in with Mycellios");
  });

  it("is offered to a new account without API-key fields or passive provisioning", async () => {
    const { div, refreshed } = await render();
    expect(div.querySelector("input")).toBeNull();
    expect(div.textContent).toContain("Optional");
    expect(div.textContent).toContain("Keep your own providers");
    expect(div.textContent).toContain("4% Mycellios service fee");
    expect(mock.connect).not.toHaveBeenCalled();
    mock.connect.mockResolvedValue({});
    await act(async () => (div.querySelector("button") as HTMLButtonElement).click());
    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
  it("shows directory details without an accordion or automatic provisioning", async () => {
    const { div } = await render(false, true);
    expect(div.querySelector("[aria-expanded]")).toBeNull();
    expect(div.textContent).toContain("4% Mycellios service fee");
    expect(mock.connect).not.toHaveBeenCalled();
  });
  it("opens a connection editor as a separate view and delegates guarded return", async () => {
    const div = document.createElement("div"); document.body.append(div);
    const root = createRoot(div), close = vi.fn();
    mounted.push(() => { root.unmount(); div.remove(); });
    await act(async () => root.render(<ProvidersSection credentials={[]} providers={[]} name={c => c.label}
      onAdd={() => {}} onOpen={() => {}} onClose={close} panelAt="add" panel={<input aria-label="Connection name" defaultValue="Draft" />} />));
    expect(div.querySelector("ul")).toBeNull();
    expect(div.querySelector("[aria-expanded]")).toBeNull();
    expect(div.querySelector("input")?.value).toBe("Draft");
    await act(async () => div.querySelector("button")!.click());
    expect(close).toHaveBeenCalledOnce();
  });
  it("uses the connected account without exposing keys, renaming or disconnect controls", async () => {
    const { div } = await render(true);
    expect(div.textContent).toContain("No API key needed");
    expect(div.querySelector("input")).toBeNull();
    expect(div.querySelector("button")).toBeNull();
  });
  it("offers a retry after failed setup without claiming a successful connection", async () => {
    const { div } = await render();
    mock.connect.mockRejectedValue(new Error("private upstream"));
    await act(async () => (div.querySelector("button") as HTMLButtonElement).click());
    expect(div.querySelector('[role="alert"]')?.textContent).toContain("No credits were spent");
    expect(div.textContent).toContain("Retry connection");
    expect(div.textContent).not.toContain("private upstream");
  });
  it("keeps Mycellios first before external providers and saves the actual markup for visual review", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mock.caps.mockResolvedValue({ mycelliosAccount: true });
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted.push(() => {
      root.unmount();
      query.clear();
      div.remove();
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={query}>
          <ProvidersSection
            credentials={[
              {
                id: "external",
                provider: "antseed",
                label: "AntSeed",
                hasKey: true,
                isDefault: false,
              },
            ]}
            providers={[]}
            name={(credential) => credential.label}
            onOpen={() => undefined}
            onAdd={() => undefined}
            primary={<MycelliosProvider onConnected={() => undefined} />}
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(div.querySelector("ul > li")?.textContent).toContain("Mycellios"),
    );
    expect(div.querySelectorAll("ul > li")[1]?.textContent).toContain("AntSeed");
    await vi.waitFor(() => expect(div.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false));
    mkdirSync("outputs/mycellios-provider-20261101", { recursive: true });
    writeFileSync(
      "outputs/mycellios-provider-20261101/visual.html",
      `<!doctype html><html lang="en" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mycellios — local provider preview</title><link rel="stylesheet" href="/preview.css"><body class="bg-background text-foreground"><main style="max-width:640px;margin:48px auto;padding:24px"><p class="mb-6 text-sm text-muted-foreground">Local interface test · example connections · no live account</p><h1 class="mb-8 text-2xl font-medium">Models</h1>${div.innerHTML}</main></body></html>`,
    );
  });
});
