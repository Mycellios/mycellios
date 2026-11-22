import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MicoTaskTabs } from "../../src/components/MicoTaskTabs";
import { MicoWorkMenu } from "../../src/components/MicoWorkMenu";
import { WorkflowWorkspace } from "../../src/pages/WorkflowWorkspace";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { Button } from "@mycellios/ui-web";
import type { Workflow, WorkflowExecution } from "@mycellios/contracts";
import type { RpcClient } from "../../src/lib/rpc";
import "../../src/styles.css";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const rows: Array<{ threadId: string; title: string; kind?: string; archived?: boolean }> = [
  { threadId: "task-one", title: "Review API", kind: "conversation", archived: false },
  { threadId: "task-two", title: "A task with a deliberately long project and functionality name", kind: "conversation", archived: false },
  { threadId: "task-routine", title: "Daily digest", kind: "routine", archived: false },
  { threadId: "task-delegated", title: "Check supplier prices", kind: "delegation", archived: false },
  { threadId: "task-archived", title: "Old budget", kind: "conversation", archived: true },
];
// The two ordinary conversations start as open tabs; the rest stay in the picker.
localStorage.setItem("mycellios:open-task-tabs:fixture", JSON.stringify(["task-one", "task-two"]));
let limit = 4;
let workflows: Workflow[] = [];
let executions: WorkflowExecution[] = [];
let revision = 0, paused = false, childState = "queued";
const rpc = { tasks: {
  overview: async () => [],
  concurrency: async (input: { limit?: number }) => { limit = input.limit ?? limit; return { limit, effectiveLimit: limit }; },
  get: async () => ({ taskId: "parent", version: 1, paused: false, active: true, botId: "mico-fixture", runId: "run-fixture", bots: [{ id: "mico-fixture", name: "Existing Mico" }] }),
  work: async () => [{ id: "child", botId: "mico-fixture", parentTaskId: "parent", delegationState: childState, delegationRevision: revision, paused,
    workStopPending: false, expectedResult: "Review the synthetic change", resources: [], dependencies: [], delegatedRunId: "run-fixture", updatedAt: new Date().toISOString(), threadId: "task-one", result: "", resultIsUntrustedData: true, executionStatus: "queued" }],
  controlWork: async (input: { expectedRevision: number; action: string }) => { if (input.expectedRevision !== revision) throw new Error("Stale work"); revision++; paused = input.action !== "resume"; childState = input.action === "cancel" ? "cancelled" : paused ? "paused" : "queued"; return { taskId: "child", revision, paused, stopping: false }; },
}, workflows: {
  list: async () => workflows,
  create: async (input: Pick<Workflow, "id" | "name" | "graph">) => { const item = { ...input, active: false, version: 1, nextRunAt: null, updatedAt: new Date().toISOString() }; workflows.push(item); return item; },
  save: async (input: Workflow & { expectedVersion: number }) => { const item = { ...input, version: input.expectedVersion + 1, nextRunAt: null, updatedAt: new Date().toISOString() }; workflows = workflows.map(value => value.id === item.id ? item : value); return item; },
  runs: async () => executions,
  execute: async (input: { id: string }) => { const run: WorkflowExecution = { id: crypto.randomUUID(), workflowId: input.id, version: 1, status: "running", steps: {}, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; executions.push(run); return run; },
  stop: async () => { executions = executions.map(value => ({ ...value, status: "cancelled" })); return { ok: true }; },
}, development: {
  list: async () => rows,
  open: async (input: { botId: string; taskKey: string }) => {
    if (input.botId !== "mico-fixture") throw new Error("Wrong Mico");
    const row = { threadId: input.taskKey, title: "", kind: "conversation", archived: false };
    rows.push(row); return { threadId: row.threadId };
  },
} } as unknown as RpcClient;

function Preview() {
  const [threadId, select] = useState<string>();
  const [flows, showFlows] = useState(false);
  return <SpaceRpcProvider spaceId="fixture" client={rpc}><main className="mx-auto flex h-dvh max-w-3xl flex-col bg-background p-4 text-foreground">
    <header className="mb-4 text-sm font-medium">Mycellios · Mico</header>
    <div className="flex min-w-0 items-center gap-1">
      <MicoTaskTabs key={threadId ?? "main"} botId="mico-fixture" scope="fixture" taskThreadId={threadId} rpc={rpc} onSelect={select} />
      <MicoWorkMenu botId="mico-fixture" runId="run-fixture" userId="fixture" onOpenTask={() => undefined} />
      <Button size="sm" variant="ghost" onClick={() => showFlows(true)}>Workflows</Button>
    </div>
    <section className="flex-1 p-4" data-testid="active-task">{threadId ?? "Main chat"}</section>
    <div className="rounded-xl border p-3 text-sm">Message to Mico</div>
    {flows ? <WorkflowWorkspace botId="mico-fixture" bots={[{ id: "mico-fixture", name: "Existing Mico" }]} onClose={() => showFlows(false)} /> : null}
  </main></SpaceRpcProvider>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Preview /></I18nProvider>);
