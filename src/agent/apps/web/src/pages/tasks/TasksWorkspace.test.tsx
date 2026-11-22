// @vitest-environment jsdom
import type { Bot, InboxTask, Space } from "@mycellios/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./TaskComposer", () => ({
  TaskComposer: ({ onSubmit }: { onSubmit: (text: string) => void }) => (
    <button type="button" onClick={() => onSubmit("Plan the offsite\nwith the budget")}>
      Send task
    </button>
  ),
  TaskAgentSelect: () => <span>Mico picker</span>,
}));
vi.mock("./TaskDetail", () => ({
  TaskDetail: ({ item, width }: { item: InboxTask; width?: number }) => (
    <aside data-testid="task-detail" data-width={width}>
      {item.title}
    </aside>
  ),
}));

import { TasksWorkspace } from "./TasksWorkspace";

const now = Date.now();
const at = (offset: number) => new Date(now - offset).toISOString();
const base: InboxTask = {
  id: "",
  botId: "fixture",
  threadId: "",
  title: "",
  runId: "run",
  status: "completed",
  error: null,
  progress: null,
  unread: false,
  archivedAt: null,
  outcome: "completed",
  createdAt: at(60000),
  updatedAt: at(60000),
};
const row = (id: string, change: Partial<InboxTask>): InboxTask => ({
  ...base,
  id,
  threadId: `thread-${id}`,
  title: id,
  ...change,
});
const items = [
  row("Failed run", { status: "failed", outcome: "failed", lastError: "Synthetic failure" }),
  row("Stopped run", { status: "cancelled", outcome: "interrupted" }),
  row("Question", { status: "waiting_input", outcome: null }),
  row("Not started yet", { runId: null, status: null, outcome: null }),
  row("Mico report", { startedBy: "agent" }),
  row("Older archive", { archivedAt: at(5000), updatedAt: at(1000) }),
  row("Newer archive", { archivedAt: at(2000), updatedAt: at(9000) }),
];
const api = { available: vi.fn(), list: vi.fn(), start: vi.fn() };
const client = { taskInbox: api } as unknown as RpcClient;
const bots = [{ id: "fixture", name: "Fixture", color: "#9B5CF6" }] as Bot[];
const select = vi.fn(),
  open = vi.fn();
let root: Root, host: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  api.available.mockResolvedValue({ enabled: true });
  api.list.mockResolvedValue(items);
  api.start.mockResolvedValue(
    row("Plan the offsite", { id: "started", status: "queued", outcome: null }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(null);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(selectedId: string | null) {
  await act(async () =>
    root.render(
      <TasksWorkspace
        client={client}
        scope="owner/space"
        bots={bots}
        spaces={[] as Space[]}
        spaceId={null}
        onSpace={() => {}}
        initialBotId="fixture"
        selectedId={selectedId}
        onSelect={select}
        onExit={() => {}}
        onOpenConversation={open}
        agentsOpen={false}
        onToggleAgents={() => {}}
      />,
    ),
  );
}
const section = (name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const rowOf = (title: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button.rk-task-row")].find((button) =>
    button.querySelector(".rk-task-row-title")?.textContent?.includes(title),
  )!;

it("lists conversations that have not started in Waiting, not in To continue", () => {
  expect(section("Waiting")?.textContent).toContain("Not started yet");
  expect(section("To continue")?.textContent).not.toContain("Not started yet");
  expect(rowOf("Not started yet").querySelector(".rk-task-status")?.textContent).toBe(
    "Not started",
  );
});

it("shows how each conversation ended, in words and in red or amber", () => {
  expect(rowOf("Failed run").dataset.tone).toBe("danger");
  expect(rowOf("Failed run").querySelector(".rk-task-status-danger")?.textContent).toBe("Failed");
  expect(rowOf("Stopped run").dataset.tone).toBe("danger");
  expect(rowOf("Stopped run").querySelector(".rk-task-status")?.textContent).toBe("Stopped");
  expect(section("To continue")?.textContent).toContain("Stopped run");
  expect(rowOf("Question").dataset.tone).toBe("attention");
  expect(rowOf("Question").querySelector(".rk-task-status-attention")?.textContent).toBe(
    "Needs your answer",
  );
  expect(rowOf("Mico report").querySelector(".rk-task-status")?.textContent).toBe("Answered");
  expect(rowOf("Mico report").dataset.tone).toBeUndefined();
});

it("marks the conversations a Mico opened by itself", () => {
  const report = rowOf("Mico report");
  expect(report.querySelector('[data-testid="task-row-by-mico"]')?.getAttribute("title")).toBe(
    "Fixture opened this conversation",
  );
  expect(report.getAttribute("aria-label")).toBe(
    "Mico report · Fixture opened this conversation · Answered",
  );
  expect(rowOf("Failed run").querySelector('[data-testid="task-row-by-mico"]')).toBeNull();
});

it("lists the most recently archived conversation first", () => {
  const titles = [...section("Archived")!.querySelectorAll(".rk-task-row-title")].map(
    (title) => title.textContent,
  );
  expect(titles).toEqual(["Newer archive", "Older archive"]);
});

it("names the Mico and the title of a new task, and Open starts it at once and shows it", async () => {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Send task")!
      .click(),
  );
  const line = host.querySelector('[data-testid="task-pending"]')!;
  expect(line.textContent).toContain("Fixture took “Plan the offsite”");
  expect(api.start).not.toHaveBeenCalled();
  await act(async () =>
    [...line.querySelectorAll("button")].find((button) => button.textContent === "Open")!.click(),
  );
  expect(api.start).toHaveBeenCalledTimes(1);
  expect(api.start.mock.calls[0]![0]).toMatchObject({
    botId: "fixture",
    text: "Plan the offsite\nwith the budget",
  });
  expect(select).toHaveBeenCalledWith("started");
  expect(host.querySelector('[data-testid="task-receipt"]')?.textContent).toContain(
    "Fixture took “Plan the offsite”",
  );
});

it("gives the detail panel the width kept for this device", async () => {
  localStorage.setItem("mycellios:tasks:panel-width", "500");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render("Failed run");
  expect(host.querySelector('[data-testid="task-detail"]')?.getAttribute("data-width")).toBe("500");
});
