// @vitest-environment jsdom
import type { AwaitingReplies as AwaitingRepliesData } from "@mycellios/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));
vi.mock("@mycellios/ui-web", () => ({
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
}));

import { AwaitingReplies } from "./AwaitingReplies";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const open: AwaitingRepliesData = {
  requests: [
    {
      requestId: "request-1",
      createdAt: "2026-11-22T10:00:00.000Z",
      settled: false,
      recipients: [
        { botId: "analyst", name: "Analyst", state: "replied" },
        { botId: "writer", name: "Writer", state: "working" },
        { botId: "scout", name: "Scout", state: "asked" },
        { botId: "lawyer", name: "Lawyer", state: "needs_you" },
      ],
    },
  ],
  work: [],
};
const settled: AwaitingRepliesData = {
  requests: [
    {
      requestId: "request-1",
      groupId: "group-1",
      groupName: "Launch",
      createdAt: "2026-11-22T10:00:00.000Z",
      settled: true,
      recipients: [
        { botId: "analyst", name: "Analyst", state: "replied" },
        { botId: "writer", name: "Writer", state: "stopped" },
      ],
    },
  ],
  work: [],
};

function render(lists: AwaitingRepliesData[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const awaitingReplies = vi.fn();
  for (const list of lists) awaitingReplies.mockResolvedValueOnce(list);
  awaitingReplies.mockResolvedValue(lists.at(-1) ?? { requests: [], work: [] });
  const tasks = {
    awaitingReplies,
    stopAwaitingReply: vi.fn().mockResolvedValue({ ok: true }),
    hideAwaitingReplies: vi.fn().mockResolvedValue({ ok: true }),
    controlWork: vi
      .fn()
      .mockResolvedValue({ taskId: "task-1", revision: 4, paused: false, stopping: false }),
  };
  const bots = [
    { id: "mico", name: "Mico" },
    { id: "analyst", name: "Analyst" },
    { id: "writer", name: "Writer" },
  ];
  const draw = (refreshKey = "run-1:completed") =>
    act(() =>
      root.render(
        <AwaitingReplies
          rpc={{ tasks } as never}
          botId="mico"
          bots={bots}
          refreshKey={refreshKey}
        />,
      ),
    );
  return { host, tasks, draw };
}
const button = (host: ParentNode, label: string) =>
  [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );

describe("Waiting for replies", () => {
  it("shows nothing while no teammate owes an answer", async () => {
    const view = render([{ requests: [], work: [] }]);
    await view.draw();
    await flush();
    expect(view.tasks.awaitingReplies).toHaveBeenCalledWith({ botId: "mico" });
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).toBeNull();
  });

  it("counts the answers in and gives every teammate a hint, with Stop only where work goes on", async () => {
    const view = render([open]);
    await view.draw();
    await flush();
    const list = view.host.querySelector("[data-testid=awaiting-replies]")!;
    expect(list.getAttribute("aria-label")).toBe("Waiting for replies");
    expect(list.textContent).toContain("1 of 4 replies in");
    const rows = [...list.querySelectorAll("[data-recipient]")];
    expect(rows.map((row) => row.textContent?.replace(/Stop$/, ""))).toEqual([
      "Analyst replied",
      "Writer is working on it",
      "Scout picks it up next",
      "Lawyer needs you",
    ]);
    expect(rows.map((row) => Boolean(button(row, "Stop")))).toEqual([false, true, true, false]);
    expect(button(list, "Hide this list")).toBeUndefined();
  });

  it("stops one teammate through the server and reads the list again", async () => {
    const view = render([open, open]);
    await view.draw();
    await flush();
    await act(async () =>
      button(view.host.querySelector("[data-recipient=writer]")!, "Stop")!.click(),
    );
    await flush();
    expect(view.tasks.stopAwaitingReply).toHaveBeenCalledWith({
      requestId: "request-1",
      botId: "writer",
    });
    expect(view.tasks.awaitingReplies).toHaveBeenCalledTimes(2);
  });

  it("shrinks to one Replies in line once every answer is in, and hides it at once", async () => {
    const view = render([settled]);
    let finish: (value: unknown) => void = () => {};
    view.tasks.hideAwaitingReplies.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await view.draw();
    await flush();
    const list = view.host.querySelector("[data-testid=awaiting-replies]")!;
    expect(list.getAttribute("aria-label")).toBe("Replies in");
    expect(list.textContent).toContain("Analyst replied · Writer was stopped");
    expect(list.textContent).not.toContain("Waiting for replies");
    await act(async () => button(list, "Hide this list")!.click());
    expect(view.tasks.hideAwaitingReplies).toHaveBeenCalledWith({ requestIds: ["request-1"] });
    // Gone before the server answers.
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).toBeNull();
    await act(async () => finish({ ok: true }));
  });

  it("brings the line back and says so when hiding fails", async () => {
    const view = render([settled]);
    view.tasks.hideAwaitingReplies.mockRejectedValueOnce(new Error("offline"));
    await view.draw();
    await flush();
    await act(async () =>
      button(view.host.querySelector("[data-testid=awaiting-replies]")!, "Hide this list")!.click(),
    );
    await flush();
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).not.toBeNull();
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(
      "The list could not be updated. Try again.",
    );
  });

  it("skips the count for a single teammate", async () => {
    const view = render([
      {
        requests: [
          {
            requestId: "request-2",
            createdAt: "2026-11-22T10:00:00.000Z",
            settled: false,
            recipients: [{ botId: "writer", name: "Writer", state: "working" }],
          },
        ],
        work: [],
      },
    ]);
    await view.draw();
    await flush();
    const list = view.host.querySelector("[data-testid=awaiting-replies]")!;
    expect(list.textContent).not.toContain("replies in");
    expect(list.textContent).toContain("Writer is working on it");
  });

  it("stops a delegated task with the revisioned controls and offers Continue, Reassign and Cancel once stopped", async () => {
    const running: AwaitingRepliesData = {
      requests: [],
      work: [
        {
          taskId: "task-1",
          botId: "writer",
          name: "Writer",
          delegationState: "running",
          revision: 3,
          paused: false,
          stopping: false,
        },
      ],
    };
    const stopped: AwaitingRepliesData = {
      requests: [],
      work: [
        {
          taskId: "task-1",
          botId: "writer",
          name: "Writer",
          delegationState: "running",
          revision: 4,
          paused: true,
          stopping: false,
        },
      ],
    };
    const view = render([running, stopped]);
    await view.draw();
    await flush();
    expect(view.host.textContent).toContain("Writer is working on a delegated task");
    await act(async () => button(view.host, "Stop Writer")!.click());
    await flush();
    expect(view.tasks.controlWork).toHaveBeenCalledWith({
      taskId: "task-1",
      expectedRevision: 3,
      action: "pause",
    });
    const card = view.host.querySelector("[data-awaiting-work=task-1]")!;
    expect(card.getAttribute("data-state")).toBe("stopped");
    expect(card.textContent).toContain("The task for Writer is stopped");
    await act(async () => button(card, "Continue")!.click());
    await flush();
    expect(view.tasks.controlWork).toHaveBeenLastCalledWith({
      taskId: "task-1",
      expectedRevision: 4,
      action: "resume",
    });
    const select = view.host.querySelector("select")!;
    expect([...select.options].map((option) => option.value)).toEqual(["", "mico", "analyst"]);
    await act(async () => {
      select.value = "analyst";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(view.tasks.controlWork).toHaveBeenLastCalledWith({
      taskId: "task-1",
      expectedRevision: 4,
      action: "reassign",
      botId: "analyst",
    });
    expect(
      button(view.host.querySelector("[data-awaiting-work=task-1]")!, "Cancel task"),
    ).toBeTruthy();
  });

  it("keeps the list and says so when an action fails", async () => {
    const view = render([open]);
    view.tasks.stopAwaitingReply.mockRejectedValueOnce(new Error("offline"));
    await view.draw();
    await flush();
    await act(async () =>
      button(view.host.querySelector("[data-recipient=scout]")!, "Stop")!.click(),
    );
    await flush();
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(
      "The list could not be updated. Try again.",
    );
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).not.toBeNull();
  });
});
