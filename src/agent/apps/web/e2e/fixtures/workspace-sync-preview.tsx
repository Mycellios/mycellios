import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Bot, Routine, Space, Workflow } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { createSpaceRpc } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { QueryUserProvider } from "../../src/lib/query";
import { WorkspaceRail } from "../../src/pages/shell/workspace-rail";
import { MarketplaceWorkspace } from "../../src/pages/marketplace/MarketplaceWorkspace";
import { RoutineWorkspace } from "../../src/pages/routines/RoutineWorkspace";
import { WorkflowWorkspace } from "../../src/pages/workflows/WorkflowWorkspace";
import { TasksWorkspace } from "../../src/pages/tasks/TasksWorkspace";
import { ScheduleWorkspace } from "../../src/pages/schedule/ScheduleWorkspace";
import { UsageWorkspace } from "../../src/pages/usage/UsageWorkspace";
import type { MarketplaceTab } from "../../src/pages/marketplace/catalog";
import "../../src/styles.css";

// Deterministic presentation fixture. All RPCs stay in memory; no account, model or microphone.
i18n.load("en", {}); i18n.activate("en");
document.documentElement.setAttribute("data-theme", "light");
const stamp = new Date().toISOString(), spaceId = "fixture-space", scope = "fixture-owner/fixture-space";
const bots = [{ id: "fixture-mico", name: "Fixture Mico", color: "#9B5CF6", status: "idle", spaceId }] as Bot[];
const spaces = [{ id: spaceId, name: "Synthetic workspace", bots, groups: [] }] as unknown as Space[];
let routine = { id: "fixture-routine", botId: bots[0]!.id, name: "Fixture reminder", prompt: "Synthetic reminder only", active: false,
  crons: ["0 9 * * 1-5"], timezone: "Europe/Madrid", watch: null, nextRunAt: null, lastRunAt: null, createdAt: stamp, updatedAt: stamp } as Routine;
let flows: Workflow[] = [];
const totals = { calls: 0, pricedCalls: 0, estimatedCalls: 0, pendingCalls: 0, incompleteCalls: 0, knownUsd: 0, confirmedUsd: 0,
  estimatedUsd: 0, costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, processed: 0, knownTokens: 0, knownProcessed: 0 };
const calls: Array<{ path: string; input: any }> = [];
(window as any).__workspaceFixture = { calls };
const originalFetch = window.fetch.bind(window);
window.fetch = async (resource, init) => {
  const request = new Request(resource, init), url = new URL(request.url);
  if (!url.pathname.includes("/rpc/")) return originalFetch(resource, init);
  const path = url.pathname.split("/rpc/")[1]!;
  const raw = request.method === "GET" ? url.searchParams.get("data") : await request.text();
  const input = raw ? JSON.parse(raw).json ?? {} : {};
  calls.push({ path, input });
  let value: any;
  if (path === "models/planLimits") value = { accounts: [], checkedAt: stamp };
  else if (path === "connections/catalog") value = [{ connectorId: "github", slug: "github", name: "GitHub", logo: null, noAuth: false, connected: false }];
  else if (["connections/list", "connections/accounts", "capabilities/list", "mcp/servers/list", "agentSkills/list", "models/credentials", "models/list"].includes(path)) value = [];
  else if (path === "capabilities/catalogSearch") value = { enabled: false, items: [], nextCursor: null };
  else if (path === "routines/list") value = [routine];
  else if (path === "routines/history") value = { runs: [], nextCursor: null };
  else if (path === "routines/calendar") value = { routines: [routine], entries: [], truncated: false, invalidRoutineIds: [], now: new Date().toISOString() };
  else if (path === "routines/update") value = routine = { ...routine, ...input };
  else if (path === "workflows/available" || path === "taskInbox/available") value = { enabled: true };
  else if (path === "workflows/list") value = flows;
  else if (path === "workflows/runs" || path === "taskInbox/list") value = [];
  else if (path === "workflows/create") { value = { ...input, version: 1, active: false, nextRunAt: null, updatedAt: stamp }; flows.push(value); }
  else if (path === "workflows/save") { value = { ...input, version: input.expectedVersion + 1, nextRunAt: null, updatedAt: stamp }; flows = flows.map(flow => flow.id === value.id ? value : flow); }
  else if (path === "usage/dashboard") value = { ...input, updatedAt: stamp, totals, agents: [], byAgent: [], byModel: [], byProvider: [], daily: [], providerDaily: [],
    sessions: 0, userMessages: 0, assistantMessages: 0, missingRuns: 0, activeRuns: 0, missingRunDays: [], unattributedCalls: 0, unmappedCalls: 0, collectionStartedAt: null };
  else return new Response(JSON.stringify({ message: `Unexpected fixture RPC: ${path}` }), { status: 500 });
  return Response.json({ json: value });
};
const client = createSpaceRpc(spaceId), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Preview() {
  const [page, setPage] = useState("tasks"), [tab, setTab] = useState<MarketplaceTab>("apps"), [routineId, selectRoutine] = useState<string | null>(null);
  const [taskId, selectTask] = useState<string | null>(null), [agentsOpen, setAgentsOpen] = useState(false);
  const exit = () => setPage("tasks"), onSpace = () => {};
  return <div className="flex h-dvh min-h-0 flex-col">
    <div className="shrink-0 bg-warning px-3 py-1 text-xs text-background">Synthetic UI fixture — no real account or execution</div>
    <div data-workspace-chrome="compact" className={`flex min-h-0 flex-1 ${["tasks", "schedule", "usage", "marketplace"].includes(page) ? `rk-task-shell rk-${page === "marketplace" ? "market" : page}-shell` : "bg-background text-foreground"}`}>
      <WorkspaceRail scope={scope} activity={false} tasks={page === "tasks"} onTasks={() => setPage("tasks")}
        routines={page === "routines"} onRoutines={() => setPage("routines")} workflows={page === "workflows"} onWorkflows={() => setPage("workflows")}
        schedule={page === "schedule"} onSchedule={() => setPage("schedule")} usage={page === "usage"} onUsage={() => setPage("usage")}
        marketplace={page === "marketplace"} onIntegrations={() => setPage("marketplace")} onChats={exit} onActivity={exit} onArtifacts={exit}
        onSettings={exit} onModels={exit} onWhatsNew={exit}/>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav className="flex shrink-0 flex-wrap gap-1 p-1 md:hidden" aria-label="Fixture pages">{["tasks", "routines", "workflows", "schedule", "usage", "marketplace"].map(name => <Button key={name} variant="ghost" size="sm" onClick={() => setPage(name)}>{name}</Button>)}</nav>
        {page === "marketplace" ? <MarketplaceWorkspace tab={tab} onTab={setTab} scope={scope} bots={bots} activeBotId={bots[0]!.id} onExit={exit} onMcp={exit} onCreated={() => {}} onOpenBot={exit} onBotsChanged={async () => {}} onCreateBot={exit}/> :
        page === "routines" ? <RoutineWorkspace bot={bots[0]!} scope={scope} client={client} selectedId={routineId} onSelect={selectRoutine} onEdit={() => {}} onAsk={exit} onExit={exit} onNavigation={exit} editorOpen={false} messages={[]}/> :
        page === "workflows" ? <WorkflowWorkspace client={client} scope={scope} bots={bots} spaces={spaces} spaceId={spaceId} onSpace={onSpace} onExit={exit} onNavigation={exit}/> :
        page === "schedule" ? <ScheduleWorkspace client={client} scope={scope} bots={bots} spaces={spaces} spaceId={spaceId} onSpace={onSpace} onExit={exit} onOpenRoutine={() => setPage("routines")} onOpenBot={exit} onCreateRoutine={() => setPage("routines")}/> :
        page === "usage" ? <UsageWorkspace client={client} scope={scope} bots={bots} spaces={spaces} spaceId={spaceId} onSpace={onSpace} onExit={exit} onPreferences={exit}/> :
        <TasksWorkspace client={client} scope={scope} bots={bots} spaces={spaces} spaceId={spaceId} onSpace={onSpace} initialBotId={bots[0]!.id} selectedId={taskId} onSelect={selectTask} onExit={exit} agentsOpen={agentsOpen} onToggleAgents={() => setAgentsOpen(value => !value)}/>}
      </main>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><QueryClientProvider client={cache}><QueryUserProvider value="fixture-owner"><SpaceRpcProvider spaceId={spaceId} client={client}><MemoryRouter><Preview/></MemoryRouter></SpaceRpcProvider></QueryUserProvider></QueryClientProvider></I18nProvider>);
