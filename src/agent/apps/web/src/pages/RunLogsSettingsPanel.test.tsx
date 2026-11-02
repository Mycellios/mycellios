// @vitest-environment jsdom
import type { RunLogsOutput } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const { load, recent, scope } = vi.hoisted(() => ({
  load: vi.fn(),
  recent: vi.fn(),
  scope: { user: "user-1", space: "space-a" },
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../lib/query", () => ({ useQueryUserId: () => scope.user }));
vi.mock("../lib/rpc", () => ({ selectedSpaceId: () => scope.space }));
vi.mock("../lib/space-rpc", () => ({
  useBoundSpaceId: () => scope.space,
  useSpaceRpc: () => ({ runs: { logs: load, list: recent } }),
}));
vi.mock("./ActivityList", () => ({
  statusLabel: (status: string) => status,
  statusTone: () => "text-foreground",
}));
import { RunLogsSettingsPanel } from "./RunLogsSettingsPanel";

const at = "2026-01-02T10:00:00.000Z";
function page(): RunLogsOutput {
  return {
    observedAt: at,
    agents: [{ id: "agent", name: "Video studio" }],
    nextCursor: null,
    runs: [
      {
        id: "run-1",
        botId: "agent",
        botName: "Video studio",
        status: "running",
        trigger: "user",
        issue: "computer_missing",
        createdAt: at,
        updatedAt: at,
        startedAt: null,
        completedAt: null,
        firstResponseAt: null,
        modelProvider: null,
        modelId: null,
        dispatchCount: 4,
        attemptCount: 0,
        attempts: [],
      },
    ],
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  load.mockReset();
  recent.mockReset();
  scope.user = "user-1";
  scope.space = "space-a";
});
it("uses only recent metadata when the server lacks detailed logs", async () => {
  load.mockRejectedValue({ code: "NOT_FOUND" });
  recent.mockResolvedValue({ runs: [{
    runId: "old-run", botId: "old-agent", botName: "Studio", status: "completed", updatedAt: at,
    promptSnippet: "private prompt must not enter logs", agentMessage: { text: "private payload" },
  }] });
  const view = await render();
  try {
    await vi.waitFor(() => expect(view.container.querySelectorAll('[data-testid="run-activity-summary"]')).toHaveLength(1));
    expect(recent).toHaveBeenCalledWith({ filter: "recent" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(view.container.textContent).toContain("Detailed execution logs are not available yet");
    expect(view.container.textContent).toContain("old-run");
    expect(view.container.textContent).not.toContain("private");
    expect(view.container.textContent).not.toContain("Execution attempts");
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
  } finally { await view.cleanup(); }
});
it("does not hide authentication failures with activity fallback", async () => {
  load.mockRejectedValue({ code: "UNAUTHORIZED" });
  const view = await render();
  try {
    await vi.waitFor(() => expect(view.container.querySelector('[role="alert"]')).not.toBeNull());
    expect(recent).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});
async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const draw = () =>
    root.render(
      <QueryClientProvider client={query}>
        <RunLogsSettingsPanel />
      </QueryClientProvider>,
    );
  await act(async () => draw());
  return {
    container,
    query,
    rerender: async () => {
      await act(async () => draw());
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      query.clear();
      vi.unstubAllGlobals();
    },
  };
}
it("shows the actual pre-start blocker with no fabricated start time or attempts", async () => {
  load.mockResolvedValue(page());
  const view = await render();
  try {
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain("No virtual computer is assigned"),
    );
    expect(view.container.textContent).toContain("Blocked");
    const details = view.container.querySelector("details");
    expect(details?.open).toBe(false);
    const metric = (label: string) => [...(details?.querySelectorAll("dt") ?? [])]
      .find(entry => entry.textContent?.startsWith(label))?.nextElementSibling?.textContent;
    expect(metric("Execution attempts")).toBe("0");
    expect(metric("Worker claims")).toBe("4");
    expect(view.container.textContent).toContain("Not recorded");
  } finally {
    await view.cleanup();
  }
});
it("loads only the selected agent and never shows the previous filter's stale result", async () => {
  load.mockResolvedValueOnce(page()).mockImplementation(() => new Promise(() => {}));
  const view = await render();
  try {
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(1),
    );
    const select = view.container.querySelector("select")!;
    await act(async () => {
      select.value = "agent";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        { botId: "agent", before: undefined },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(0);
  } finally {
    await view.cleanup();
  }
});
it("forgets displayed logs when the authenticated owner changes", async () => {
  load.mockResolvedValueOnce(page()).mockImplementation(() => new Promise(() => {}));
  const view = await render();
  try {
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(1),
    );
    scope.user = "user-2";
    await view.rerender();
    expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(0);
  } finally {
    await view.cleanup();
  }
});
it("renders a recoverable error and can refresh without sending a new task", async () => {
  load.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(page());
  const view = await render();
  try {
    await vi.waitFor(() =>
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not refresh logs",
      ),
    );
    await act(async () => {
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Refresh logs"))!
        .click();
    });
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain("No virtual computer is assigned"),
    );
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await view.cleanup();
  }
});
it("paginates and removes duplicate run rows", async () => {
  const first = page();
  first.nextCursor = { id: "run-1", createdAt: at };
  load.mockResolvedValueOnce(first).mockResolvedValueOnce(page());
  const view = await render();
  try {
    await vi.waitFor(() => expect(view.container.textContent).toContain("Load older logs"));
    await act(async () => {
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Load older logs")!
        .click();
    });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(1);
    expect(load.mock.calls[1]?.[0].before).toEqual(first.nextCursor);
  } finally {
    await view.cleanup();
  }
});
it("shows an empty state rather than a permanent spinner", async () => {
  load.mockResolvedValue({ ...page(), runs: [] });
  const view = await render();
  try {
    await vi.waitFor(() => expect(view.container.textContent).toContain("No executions yet"));
  } finally {
    await view.cleanup();
  }
});

it("filters loaded states without issuing another task or hiding pagination", async () => {
  load.mockResolvedValue({ ...page(), nextCursor: { id: "run-1", createdAt: at } });
  const view = await render();
  try {
    await vi.waitFor(() => expect(view.container.textContent).toContain("Video studio"));
    const select = view.container.querySelector<HTMLSelectElement>(
      '[aria-label="Status of loaded logs"]',
    )!;
    await act(async () => {
      select.value = "failed";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(0);
    expect(view.container.textContent).toContain("No matches in loaded logs");
    expect(view.container.textContent).toContain("Load older logs");
    await act(async () => {
      select.value = "active";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.container.querySelectorAll('[data-testid="run-log-entry"]')).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await view.cleanup();
  }
});
