import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MicoTaskTabs } from "../../src/components/MicoTaskTabs";
import { MicoWorkMenu } from "../../src/components/MicoWorkMenu";
import { MicoStartedBanner } from "../../src/components/NewConversationIntro";
import { NewChatControl } from "../../src/components/composer/NewChatControl";
import { WorkflowWorkspace } from "../../src/pages/WorkflowWorkspace";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { readComposerDraft, writeComposerDraft } from "../../src/lib/composer-draft";
import { sendFirstMessage } from "../../src/lib/new-conversation";
import { adoptNewConversation, forgetNewConversationRequest, NEW_CONVERSATION_TAB, newConversationRequest, updateConversationTabs } from "../../src/lib/thread-tabs";
import { Button, Toaster } from "@mycellios/ui-web";
import type { Workflow, WorkflowExecution } from "@mycellios/contracts";
import type { RpcClient } from "../../src/lib/rpc";
import "../../src/styles.css";

// The shared relative-time helper reads the global catalog, as in the app.
const locale = new URLSearchParams(window.location.search).get("locale") === "es" ? "es" : "en";
if (locale === "es") {
  const { messages } = await import("../../src/locales/es/messages.po");
  i18n.load(locale, messages);
} else i18n.load(locale, {});
i18n.activate(locale);
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
type Row = { threadId: string; title: string; kind?: string; archived?: boolean; archivedAt?: string | null; deleteAfter?: string | null;
  state?: string; outcome?: string | null; unread?: boolean; startedBy?: string; createdAt?: string; updatedAt?: string };
const savedRows = sessionStorage.getItem("mico-fixture-rows");
// The synthetic server keeps its rows across a reload, like a real one.
const rows: Row[] = savedRows ? JSON.parse(savedRows) as Row[] : [
  { threadId: "task-one", title: "Review API", kind: "conversation", state: "running", createdAt: at(300), updatedAt: at(1) },
  { threadId: "task-two", title: "A task with a deliberately long project and functionality name", kind: "conversation", state: "idle", unread: true, createdAt: at(200), updatedAt: at(20) },
  { threadId: "task-failed", title: "Import invoices", kind: "conversation", state: "idle", outcome: "failed", createdAt: at(150), updatedAt: at(90) },
  { threadId: "task-asks", title: "Choose a supplier", kind: "conversation", state: "waiting", createdAt: at(140), updatedAt: at(30) },
  { threadId: "task-routine", title: "Daily digest", kind: "routine", archived: false, state: "queued", createdAt: at(400), updatedAt: at(60) },
  { threadId: "task-delegated", title: "Check supplier prices", kind: "delegation", archived: false, state: "idle", createdAt: at(500), updatedAt: at(600) },
  { threadId: "task-archived", title: "Old budget", kind: "conversation", archived: true, archivedAt: at(2000), state: "closed", createdAt: at(3000), updatedAt: at(2000) },
];
const scope = "fixture";
const phoneMenu = new URLSearchParams(window.location.search).has("phone-menu");
const draftKey = "bot:mico-fixture:new-conversation";
// The two ordinary conversations start as open tabs; the rest stay in the picker.
if (!localStorage.getItem("mycellios:open-task-tabs:fixture")) localStorage.setItem("mycellios:open-task-tabs:fixture", JSON.stringify(["task-one", "task-two"]));
let limit = 4;
let workflows: Workflow[] = [];
let executions: WorkflowExecution[] = [];
let revision = 0, paused = false, childState = "queued";
const save = () => sessionStorage.setItem("mico-fixture-rows", JSON.stringify(rows));
const patch = (id: string, change: Partial<Row>) => { const row = rows.find(item => item.threadId === id); if (row) Object.assign(row, change); save(); };
const rpc = { threads: {
  compactContext: async (input: { botId: string; taskThreadId: string }) => {
    if (input.botId !== "mico-fixture" || input.taskThreadId !== "task-two") throw new Error("Wrong conversation");
    return { queued: true };
  },
}, tasks: {
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
  list: async () => rows.filter(row => !row.deleteAfter || Date.parse(row.deleteAfter) > Date.now()).map(row => ({ projectKey: "mico:mico-fixture", taskKey: row.threadId, ...row })),
  open: async (input: { botId: string; taskKey: string }) => {
    if (input.botId !== "mico-fixture") throw new Error("Wrong Mico");
    const existing = rows.find(row => row.threadId === input.taskKey);
    if (existing) return { threadId: existing.threadId };
    rows.push({ threadId: input.taskKey, title: "", kind: "conversation", archived: false, state: "idle", startedBy: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    save();
    return { threadId: input.taskKey };
  },
  rename: async (input: { taskThreadId: string; title: string }) => { patch(input.taskThreadId, { title: input.title.trim() }); return { threadId: input.taskThreadId, title: input.title.trim() }; },
  archive: async (input: { taskThreadId: string }) => { const archivedAt = new Date().toISOString(); patch(input.taskThreadId, { archived: true, archivedAt, state: "closed" }); return { ok: true, archivedAt }; },
  restore: async (input: { taskThreadId: string }) => {
    const row = rows.find(item => item.threadId === input.taskThreadId);
    if (row?.deleteAfter) { patch(input.taskThreadId, { deleteAfter: null, state: row.archived ? "closed" : "idle" }); return { ok: true, restored: "delete" }; }
    patch(input.taskThreadId, { archived: false, archivedAt: null, state: "idle", updatedAt: new Date().toISOString() });
    return { ok: true, restored: "archive" };
  },
  remove: async (input: { taskThreadId: string }) => {
    const row = rows.find(item => item.threadId === input.taskThreadId);
    if (row?.state === "running" || row?.state === "queued" || row?.state === "waiting") throw new Error("This conversation is still working. Stop it before you delete it.");
    const deleteAfter = new Date(Date.now() + 6_000).toISOString();
    patch(input.taskThreadId, { deleteAfter, state: "closed" });
    return { ok: true, deleteAfter };
  },
} } as unknown as RpcClient;
// A client bound to one new conversation: it reads the thread, then takes the first message as its title.
const bind = (threadId: string) => ({ threads: {
  head: async () => ({ threadId, cursor: -1 }),
  send: async (input: { text?: string }) => {
    const title = (input.text ?? "").split("\n").map(line => line.trim()).find(Boolean) ?? "";
    patch(threadId, { title: title.slice(0, 120), state: "running", updatedAt: new Date().toISOString() });
    return { taskId: "task-new", runId: "run-new", seq: 0 };
  },
} }) as unknown as RpcClient;

function Preview() {
  const [threadId, select] = useState<string>();
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState(() => readComposerDraft(draftKey));
  const [flows, showFlows] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const phone = typeof window !== "undefined" && window.innerWidth < 768;
  const shown = rows.find(row => row.threadId === threadId);
  async function sendDraft() {
    const result = await sendFirstMessage({ botId: "mico-fixture", requestKey: newConversationRequest(scope, "mico-fixture"), rpc, bind,
      message: { clientNonce: crypto.randomUUID(), text: draft } });
    if (result.status === "failed") return;
    forgetNewConversationRequest(scope);
    writeComposerDraft(draftKey, ""); setDraft("");
    updateConversationTabs(scope, state => adoptNewConversation(state, result.threadId));
    setDraftOpen(false); select(result.threadId);
  }
  return <SpaceRpcProvider spaceId="fixture" client={rpc}><main className="mx-auto flex h-dvh max-w-6xl flex-col bg-background p-4 text-foreground">
    <header className="mb-4 text-sm font-medium">Mycellios · Mico</header>
    <div className={`flex min-w-0 items-center gap-1 ${narrow ? "w-[180px]" : ""}`} data-testid="tab-row">
      <MicoTaskTabs key={draftOpen ? "draft" : threadId ?? "main"} botId="mico-fixture" scope={scope} taskThreadId={threadId}
        newConversationOpen={draftOpen} inMenu={phoneMenu} confirmDelete={phone} messageCount={refresh} rpc={rpc}
        onSelect={target => { if (target === NEW_CONVERSATION_TAB) { setDraftOpen(true); select(undefined); } else { setDraftOpen(false); select(target); } }} />
      {narrow ? null : <MicoWorkMenu botId="mico-fixture" runId="run-fixture" userId="fixture" onOpenTask={() => undefined} />}
      {narrow ? null : <Button size="sm" variant="ghost" onClick={() => showFlows(true)}>Workflows</Button>}
    </div>
    <section className="flex-1 overflow-auto p-4">
      {shown?.startedBy === "agent" ? <MicoStartedBanner name="Existing Mico" /> : null}
      <p data-testid="active-task">{draftOpen ? "Draft" : threadId ?? "Main chat"}</p>
    </section>
    {draftOpen ? <form className="flex gap-2 rounded-xl border p-3 text-sm" onSubmit={event => { event.preventDefault(); void sendDraft(); }}>
      <textarea aria-label="Start a new conversation with Existing Mico" placeholder="Start a new conversation with Existing Mico" className="min-h-10 flex-1 resize-none bg-transparent outline-none"
        value={draft} onChange={event => { setDraft(event.target.value); writeComposerDraft(draftKey, event.target.value); }} />
      <Button type="submit" size="sm" disabled={!draft.trim()}>Send</Button>
    </form> : <div className="flex items-center gap-2 rounded-xl border p-3 text-sm">Message to Mico
      {phoneMenu ? <SpaceRpcProvider spaceId="fixture" client={rpc} taskScope={{ botId: "mico-fixture", taskThreadId: "task-two" }}>
        <NewChatControl botId="mico-fixture" name="Existing Mico" canCompact />
      </SpaceRpcProvider> : null}
    </div>}
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="outline" onClick={() => {
        rows.push({ threadId: `mico-started-${rows.length}`, title: "Compare energy offers", kind: "conversation", startedBy: "agent", state: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        save();
        setRefresh(value => value + 1);
      }}>Mico starts a task</Button>
      <Button size="sm" variant="outline" onClick={() => setNarrow(value => !value)}>Narrow header</Button>
    </div>
    {flows ? <WorkflowWorkspace botId="mico-fixture" bots={[{ id: "mico-fixture", name: "Existing Mico" }]} onClose={() => showFlows(false)} /> : null}
    <Toaster />
  </main></SpaceRpcProvider>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><Preview /></I18nProvider>);
