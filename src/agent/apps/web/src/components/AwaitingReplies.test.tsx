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
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@mycellios/ui-web/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("@mycellios/ui-web", () => ({
  DEFAULT_BOT_AVATAR_COLOR: "#000000",
  BotAvatar: () => null,
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
}));

import { AwaitingReplies } from "./AwaitingReplies";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  viewport.mobile = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
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

function render(lists: AwaitingRepliesData[], mobileQueue?: { preview: string; messages: ReactNode }) {
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
          mobileQueue={mobileQueue}
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
    const trigger = button(list, "Waiting for replies")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const popup = list;
    expect(popup.textContent).toContain("1 of 4 replies in");
    const rows = [...popup.querySelectorAll("[data-recipient]")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "AnalystAnswered",
      "WriterWorking",
      "ScoutQueued",
      "LawyerNeeds you",
    ]);
    expect(rows.map((row) => Boolean(row.querySelector("button")))).toEqual([false, true, true, false]);
    expect(button(popup, "Hide this list")).toBeUndefined();
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("Lawyer needs you");
  });

  it("keeps the mobile replies and queued messages together in a bottom sheet", async () => {
    viewport.mobile = true;
    const view = render([open], {
      preview: "Next message",
      messages: <div data-testid="queue-content">Queued payload</div>,
    });
    await view.draw();
    await flush();
    const trigger = button(view.host, "Messages waiting to send")!;
    expect(trigger.textContent).toBe("Next message");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-recipient]")).toBeNull();
    expect(document.querySelector("[data-testid=queue-content]")).toBeNull();

    await act(async () => trigger.click());
    const sheet = document.querySelector("[data-slot=sheet-content]")!;
    expect(sheet.getAttribute("data-side")).toBe("bottom");
    expect(sheet.textContent).toContain("Waiting for replies");
    expect(sheet.querySelector("[data-recipient=writer]")).toBeTruthy();
    expect(sheet.querySelector("[data-testid=queue-content]")?.textContent).toBe("Queued payload");

    await act(async () => button(sheet, "Close")!.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the mobile reply button without opening a list when the queue is empty", async () => {
    viewport.mobile = true;
    const view = render([open]);
    await view.draw();
    await flush();
    const trigger = button(view.host, "Waiting for replies")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.host.querySelector("[data-recipient]")).toBeNull();

    await act(async () => trigger.click());
    expect(document.querySelector("[data-slot=sheet-content] [data-recipient=writer]")).toBeTruthy();
  });

  it("stops one teammate through the server and reads the list again", async () => {
    const view = render([open, open]);
    await view.draw();
    await flush();
    const popup = view.host;
    await act(async () =>
      button(popup.querySelector("[data-recipient=writer]")!, "Stop Writer")!.click(),
    );
    await flush();
    expect(view.tasks.stopAwaitingReply).toHaveBeenCalledWith({
      requestId: "request-1",
      botId: "writer",
    });
    expect(view.tasks.awaitingReplies).toHaveBeenCalledTimes(2);
  });

  it("keeps results available until they are dismissed, and hides them at once", async () => {
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
    expect(list.querySelector("[data-recipient=analyst]")?.textContent).toBe("AnalystAnswered");
    expect(list.querySelector("[data-recipient=writer]")?.textContent).toBe("WriterStopped");
    expect(list.textContent).not.toContain("Waiting for replies");
    await act(async () => button(list, "Hide this list")!.click());
    expect(view.tasks.hideAwaitingReplies).toHaveBeenCalledWith({ requestIds: ["request-1"] });
    // Gone before the server answers.
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).toBeNull();
    await act(async () => finish({ ok: true }));
  });

  it("brings the results back and says so when hiding fails", async () => {
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
    const popup = list;
    expect(popup.textContent).not.toContain("replies in");
    expect(popup.querySelector("[data-recipient=writer]")?.textContent).toBe("WriterWorking");
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
    const popup = view.host;
    expect(popup.textContent).toContain("Writer is working on a delegated task");
    await act(async () => button(popup, "Stop Writer")!.click());
    await flush();
    expect(view.tasks.controlWork).toHaveBeenCalledWith({
      taskId: "task-1",
      expectedRevision: 3,
      action: "pause",
    });
    const card = popup.querySelector("[data-awaiting-work=task-1]")!;
    expect(card.getAttribute("data-state")).toBe("stopped");
    expect(card.textContent).toContain("The task for Writer is stopped");
    await act(async () => button(card, "Continue")!.click());
    await flush();
    expect(view.tasks.controlWork).toHaveBeenLastCalledWith({
      taskId: "task-1",
      expectedRevision: 4,
      action: "resume",
    });
    const select = popup.querySelector("select")!;
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
      button(popup.querySelector("[data-awaiting-work=task-1]")!, "Cancel task"),
    ).toBeTruthy();
  });

  it("keeps the list and says so when an action fails", async () => {
    const view = render([open]);
    view.tasks.stopAwaitingReply.mockRejectedValueOnce(new Error("offline"));
    await view.draw();
    await flush();
    const popup = view.host;
    await act(async () =>
      button(popup.querySelector("[data-recipient=scout]")!, "Stop Scout")!.click(),
    );
    await flush();
    expect(popup.querySelector("[role=alert]")?.textContent).toBe(
      "The list could not be updated. Try again.",
    );
    expect(view.host.querySelector("[data-testid=awaiting-replies]")).not.toBeNull();
  });
});
