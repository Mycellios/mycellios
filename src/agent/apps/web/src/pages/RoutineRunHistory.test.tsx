// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { RoutineRun } from "@mycellios/contracts";
import type * as UiWeb from "@mycellios/ui-web";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { routines: api } }));
const format = vi.hoisted(
  () => (parts: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: parts }, ...values),
);
vi.mock("@lingui/core/macro", () => ({ t: format }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ i18n: { locale: "en" }, t: format }),
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));
vi.mock("@mycellios/ui-web", async (importOriginal) => ({
  ...(await importOriginal<typeof UiWeb>()),
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));

import { RoutineRunHistory } from "./RoutineRunHistory";

const run: RoutineRun = {
  id: "run-1",
  botId: "bot-1",
  groupId: null,
  status: "completed",
  error: null,
  createdAt: "2026-01-02T12:00:00Z",
  startedAt: "2026-01-02T12:00:00Z",
  completedAt: "2026-01-02T12:01:22Z",
  messageId: "reply-1",
};
const page = (runs: RoutineRun[]) => ({ runs, nextCursor: null });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  api.history.mockReset();
});
async function mounted(routineId = "routine-1") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (id: string) =>
    act(async () =>
      root.render(
        <MemoryRouter>
          <RoutineRunHistory key={id} routineId={id} />
        </MemoryRouter>,
      ),
    );
  await render(routineId);
  return {
    container,
    render,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it("shows loading, then the real run and its exact message link", async () => {
  let finish!: (rows: RoutineRun[]) => void;
  api.history.mockReturnValue(
    new Promise<RoutineRun[]>((resolve) => {
      finish = resolve;
    }).then(page),
  );
  const view = await mounted();
  try {
    expect(view.container.querySelector('[role="status"][aria-label="Loading…"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain("Loading");
    expect(view.container.textContent).not.toContain("No runs yet");
    await act(async () => finish([run]));
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.textContent).toContain("1m 22s");
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe("/app/bot-1?m=reply-1");
  } finally {
    await view.close();
  }
});
it("lists signed events that started nothing among the runs, with their reason", async () => {
  api.history.mockResolvedValue({
    ...page([run]),
    events: [
      { id: "receipt-2", receivedAt: "2026-01-02T13:00:00Z", reason: "filter" },
      { id: "receipt-1", receivedAt: "2026-01-02T11:00:00Z", reason: "paused" },
    ],
  });
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    await act(async () => button("Run history").click());
    const rows = [...view.container.querySelectorAll("li")];
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "routine-event-row",
      "routine-run-row",
      "routine-event-row",
    ]);
    expect(rows[0]?.textContent).toContain("Ignored: a filter did not match");
    expect(rows[2]?.textContent).toContain("Ignored: routine paused");
    expect(view.container.textContent).not.toContain("No runs yet");
  } finally {
    await view.close();
  }
});
it("shows a genuine empty state and refreshes while the panel is open", async () => {
  vi.useFakeTimers();
  api.history
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([{ ...run, messageId: null }]));
  const view = await mounted();
  try {
    expect(view.container.textContent).toContain("No runs yet");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.querySelector("a")).toBeNull();
    await view.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.history).toHaveBeenCalledTimes(2);
  } catch (error) {
    await view.close();
    throw error;
  }
});
it("shows failures honestly, preserves previous results and recovers on the next refresh", async () => {
  vi.useFakeTimers();
  api.history
    .mockResolvedValueOnce(page([run]))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(page([]));
  const view = await mounted();
  try {
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.textContent).not.toContain("No runs yet");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain("No runs yet");
  } finally {
    await view.close();
  }
});
it.each([
  [403, 2],
  [404, 2],
  [503, 5],
])("after a %i poll, history requests total %i", async (status, requests) => {
  vi.useFakeTimers();
  api.history
    .mockResolvedValueOnce(page([run]))
    .mockRejectedValueOnce(Object.assign(new Error("Refused"), { status }))
    .mockResolvedValue(page([run]));
  const view = await mounted();
  try {
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    expect(api.history).toHaveBeenCalledTimes(requests);
  } finally {
    await view.close();
  }
});
it("discards a response from the previous routine", async () => {
  let finish!: (rows: RoutineRun[]) => void;
  api.history
    .mockReturnValueOnce(
      new Promise<RoutineRun[]>((resolve) => {
        finish = resolve;
      }).then(page),
    )
    .mockResolvedValueOnce(page([]));
  const view = await mounted();
  try {
    await view.render("routine-2");
    await act(async () => finish([run]));
    expect(view.container.textContent).toContain("No runs yet");
    expect(view.container.querySelectorAll("li")).toHaveLength(0);
  } finally {
    await view.close();
  }
});
it("defaults to the latest run, expands all entries, and loads older pages", async () => {
  vi.useFakeTimers();
  const older = { ...run, id: "older", messageId: "older-reply" };
  const cursor = { id: "run-1", createdAt: run.createdAt };
  api.history.mockImplementation(async (input: { before?: unknown }) =>
    input.before
      ? page([{ ...older, id: "oldest", messageId: null }])
      : { runs: [run, older], nextCursor: cursor },
  );
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(button("Run history").getAttribute("aria-expanded")).toBe("false");
    await act(async () => button("Run history").click());
    expect(button("Run history").getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
    await act(async () => button("Load older runs").click());
    expect(api.history).toHaveBeenLastCalledWith({ routineId: "routine-1", before: cursor });
    expect(view.container.querySelectorAll("li")).toHaveLength(3);
    expect(view.container.textContent).not.toContain("Load older runs");
    await act(async () => button("Run history").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    const requests = api.history.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
    await act(async () => button("Run history").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
  } finally {
    await view.close();
  }
});
it("ignores a collapse refresh after expanded browsing resumes", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  const cursor = { id: run.id, createdAt: run.createdAt };
  api.history
    .mockResolvedValueOnce({ runs: [run], nextCursor: cursor })
    .mockResolvedValueOnce(page([{ ...run, id: "older" }]))
    .mockReturnValueOnce(
      new Promise<ReturnType<typeof page>>((resolve) => {
        finish = resolve;
      }),
    );
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    await act(async () => button("Run history").click());
    await act(async () => button("Load older runs").click());
    await act(async () => button("Run history").click());
    await act(async () => button("Run history").click());
    await act(async () => finish(page([run])));
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
  } finally {
    await view.close();
  }
});
it("ignores a collapsed poll after expanding and loading older runs", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof page>) => void;
  const cursor = { id: run.id, createdAt: run.createdAt };
  api.history
    .mockResolvedValueOnce({ runs: [run], nextCursor: cursor })
    .mockReturnValueOnce(
      new Promise<ReturnType<typeof page>>((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce(page([{ ...run, id: "older" }]));
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await act(async () => button("Run history").click());
    await act(async () => button("Load older runs").click());
    await act(async () => finish(page([run])));
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
  } finally {
    await view.close();
  }
});

it("keeps a newer collapsed page when an older refresh finishes last", async () => {
  vi.useFakeTimers();
  let releaseOlder!: (value: ReturnType<typeof page>) => void;
  const cursor = { id: run.id, createdAt: run.createdAt };
  api.history
    .mockResolvedValueOnce({ runs: [run], nextCursor: cursor })
    .mockResolvedValueOnce(page([{ ...run, id: "older" }]))
    .mockReturnValueOnce(
      new Promise<ReturnType<typeof page>>((resolve) => {
        releaseOlder = resolve;
      }),
    )
    .mockResolvedValueOnce(page([{ ...run, status: "failed" }]));
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    await act(async () => button("Run history").click());
    await act(async () => button("Load older runs").click());
    await act(async () => button("Run history").click());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.textContent).toContain("Failed");
    await act(async () => releaseOlder(page([run])));
    expect(view.container.textContent).toContain("Failed");
    expect(view.container.textContent).not.toContain("Done");
  } finally {
    await view.close();
  }
});
it("accepts a successful collapse refresh when the overlapping poll fails", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof page>) => void;
  api.history
    .mockResolvedValueOnce({ runs: [run], nextCursor: { id: run.id, createdAt: run.createdAt } })
    .mockResolvedValueOnce(page([{ ...run, id: "older" }]))
    .mockReturnValueOnce(
      new Promise<ReturnType<typeof page>>((resolve) => {
        finish = resolve;
      }),
    )
    .mockRejectedValueOnce(new Error("temporarily unavailable"));
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    await act(async () => button("Run history").click());
    await act(async () => button("Load older runs").click());
    await act(async () => button("Run history").click());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.textContent).toContain("Could not load run history");
    await act(async () => finish(page([{ ...run, status: "failed" }])));
    expect(view.container.textContent).toContain("Failed");
    expect(view.container.textContent).not.toContain("Could not load run history");
  } finally {
    await view.close();
  }
});

it("links View chat into the group thread when the run has a groupId", async () => {
  api.history.mockResolvedValue(page([{ ...run, groupId: "group-1", messageId: "reply-1" }]));
  const view = await mounted();
  try {
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "/app/g/group-1?m=reply-1",
    );
  } finally {
    await view.close();
  }
});
it("keeps loaded older runs while expanded, and refreshes to the first page on collapse", async () => {
  const older = { ...run, id: "older", messageId: "older-reply" };
  const cursor = { id: "run-1", createdAt: run.createdAt };
  api.history.mockImplementation(async (input: { before?: unknown }) =>
    input.before
      ? page([{ ...older, id: "oldest", messageId: null }])
      : { runs: [run, older], nextCursor: cursor },
  );
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    await act(async () => button("Run history").click());
    await act(async () => button("Load older runs").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(3);
    expect(view.container.textContent).not.toContain("Load older runs");
    await act(async () => button("Run history").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(button("Run history").getAttribute("aria-expanded")).toBe("false");
  } finally {
    await view.close();
  }
});

it("shows a silent failed run summary with diagnostics behind Details", async () => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  const error = "504: request timed out";
  api.history.mockResolvedValue(page([{ ...run, status: "failed", messageId: null, error }]));
  const view = await mounted();
  try {
    expect(view.container.textContent).toContain(
      "Your model provider took too long to respond. Try again.",
    );
    const details = view.container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Details");
    expect(details?.querySelector("pre")?.textContent).toBe(error);
    expect(view.container.querySelector("a")).toBeNull();
  } finally {
    await view.close();
  }
});

it.each(["completed", "failed"] as const)(
  "omits diagnostics for a %s run without an error",
  async (status) => {
    api.history.mockResolvedValue(page([{ ...run, status, messageId: null }]));
    const view = await mounted();
    try {
      expect(view.container.querySelector("details")).toBeNull();
      expect(view.container.querySelector("a")).toBeNull();
    } finally {
      await view.close();
    }
  },
);

it("omits error UI for a completed run carrying a stale error", async () => {
  api.history.mockResolvedValue(page([{ ...run, error: "504: request timed out" }]));
  const view = await mounted();
  try {
    expect(view.container.querySelector("details")).toBeNull();
    expect(view.container.textContent).not.toContain("Your model provider");
    expect(view.container.textContent).not.toContain("504: request timed out");
  } finally {
    await view.close();
  }
});

it("labels each run by what started it and marks quiet, late and missed runs", async () => {
  api.history.mockResolvedValue(
    page([
      {
        ...run,
        id: "late",
        source: "schedule",
        quiet: true,
        scheduledFor: "2026-01-02T08:00:00Z",
        missed: { count: 3, reason: "offline" },
        messageId: null,
        taskThreadId: "routine-thread",
      },
      { ...run, id: "manual", source: "manual", quiet: false, missed: { count: 1, reason: "busy" } },
      { ...run, id: "hook", source: "webhook" },
    ]),
  );
  const view = await mounted();
  try {
    const expand = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Run history"),
    );
    await act(async () => expand?.click());
    const rows = [...view.container.querySelectorAll('[data-testid="routine-run-row"]')];
    expect(rows.map((row) => row.querySelector('[data-testid="routine-run-source"]')?.textContent)).toEqual([
      "Scheduled · ",
      "Run by you · ",
      "Webhook · ",
    ]);
    // A quiet run reads as nothing new instead of a plain success.
    expect(rows[0]?.querySelector('[data-testid="routine-run-quiet"]')?.textContent).toBe("Nothing new");
    expect(rows[1]?.querySelector('[data-testid="routine-run-quiet"]')).toBeNull();
    expect(rows[0]?.querySelector('[data-testid="routine-run-late"]')?.textContent).toMatch(/^Ran late: it was due /);
    expect(rows[0]?.querySelector('[data-testid="routine-run-missed"]')?.textContent).toBe(
      "3 earlier runs did not happen: the server was not running at their time",
    );
    expect(rows[1]?.querySelector('[data-testid="routine-run-missed"]')?.textContent).toBe(
      "1 earlier run was folded into this one: the run before it had not started yet",
    );
    expect(rows[1]?.querySelector('[data-testid="routine-run-late"]')).toBeNull();
    // The quiet run still opens its routine conversation.
    expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/app/bot-1?task=routine-thread");
  } finally {
    await view.close();
  }
});

it("shows the reason a run gave when it reported its own failure", async () => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  const error = "The supplier page asked for a login again, so no prices were checked.";
  api.history.mockResolvedValue(page([{ ...run, status: "failed", error, source: "schedule" }]));
  const view = await mounted();
  try {
    expect(view.container.textContent).toContain(error);
    expect(view.container.querySelector('[data-testid="routine-run-quiet"]')).toBeNull();
  } finally {
    await view.close();
  }
});
