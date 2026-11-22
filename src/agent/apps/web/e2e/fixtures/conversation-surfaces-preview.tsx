import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { OpenWait, Space, SideThreadRequest, ThreadSnapshot } from "@mycellios/contracts";
import { Toaster } from "@mycellios/ui-web";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationsPane } from "../../src/components/ConversationsPane";
import { MirroredRequests } from "../../src/components/MirroredRequests";
import { OpenWaits } from "../../src/components/OpenWaits";
import { SideConversationView } from "../../src/components/SideConversationView";
import { closeBeside, openBeside, showBeside, updateBeside, useBeside } from "../../src/lib/conversation-pane";
import type { RpcClient } from "../../src/lib/rpc";
import { micoConversationScope } from "../../src/lib/sidebar-conversations";
import { type ConversationRow, writeConversationRows } from "../../src/lib/thread-tabs";
import { BotContextMenu } from "../../src/pages/BotContextMenu";
import { SidebarRoster } from "../../src/pages/shell/sidebar-roster";
import { SidebarViewMenu } from "../../src/pages/shell/sidebar-view-menu";
import { NeedsYouGroup } from "../../src/pages/shell/needs-you-group";
import { sidebarGroupsForSpaces } from "../../src/pages/shell/space-sidebar";
import "../../src/styles.css";

// Only a loopback component fixture: synthetic rows and RPCs, no account, server or model.
i18n.load("en", {});
i18n.activate("en");
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const userId = "fixture-user";
const spaceId = "fixture-space";
const rows: ConversationRow[] = [
  { threadId: "plan", title: "Plan the spring trip", kind: "conversation", state: "running", createdAt: at(300), updatedAt: at(1) },
  { threadId: "asks", title: "Choose a supplier", kind: "conversation", state: "waiting", createdAt: at(200), updatedAt: at(5) },
  { threadId: "offers", title: "Compare energy offers", kind: "conversation", state: "idle", unread: true, openWaits: 1, createdAt: at(150), updatedAt: at(12) },
  { threadId: "invoices", title: "Import invoices", kind: "conversation", state: "idle", outcome: "failed", createdAt: at(140), updatedAt: at(40) },
  { threadId: "notes", title: "Meeting notes", kind: "conversation", state: "idle", createdAt: at(400), updatedAt: at(90) },
  { threadId: "budget", title: "Yearly budget", kind: "conversation", state: "idle", createdAt: at(500), updatedAt: at(300) },
  { threadId: "recipes", title: "Weekend recipes", kind: "conversation", state: "idle", createdAt: at(600), updatedAt: at(500) },
  { threadId: "travel", title: "Travel insurance", kind: "conversation", state: "idle", createdAt: at(700), updatedAt: at(800) },
];
const scope = micoConversationScope(userId, spaceId, "mico");
writeConversationRows(scope, () => rows);
writeConversationRows(micoConversationScope(userId, spaceId, "writer"), () => [
  { threadId: "draft-post", title: "Draft the forum post", state: "idle", unread: true, updatedAt: at(8) },
]);

const messages = (threadId: string, title: string): ThreadSnapshot["messages"] => [
  { id: `${threadId}-u`, threadId, seq: 0, role: "user", createdAt: at(20), blocks: [{ kind: "text", text: title }] },
  { id: `${threadId}-b`, threadId, seq: 1, role: "bot", createdAt: at(19), blocks: [{ kind: "text", text: `Here is where **${title}** stands. Two options look good; the second one is cheaper.` }] },
] as ThreadSnapshot["messages"];
const requests: SideThreadRequest[] = [
  { threadId: "asks", title: "Choose a supplier", runId: "run-asks", messageId: "asks-ask", kind: "approval", createdAt: at(5),
    block: { kind: "ask", text: "Send the order to the cheaper supplier?", approvalEffectId: "effect-1", status: "pending",
      actions: [{ id: "allow", label: "Allow once" }, { id: "always", label: "Always allow" }, { id: "deny", label: "Deny" }] } },
  { threadId: "plan", title: "Plan the spring trip", runId: "run-plan", messageId: null, kind: "takeover", block: null, createdAt: at(3) },
];
const answered: string[] = [];
const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
// Requests the Mico parked in the main chat with await_event; the second already woke.
const waits: OpenWait[] = [
  { waitId: "wait-report", threadId: "main", note: "Read tonight's sales report, compare it with last week and send the three biggest changes.",
    request: "When the nightly report lands, tell me what changed most.", openedAt: at(30), expiresAt: soon(1410), timeoutMinutes: 1440,
    routineId: "routine-report", routineName: "Nightly sales report", status: "waiting" },
  { waitId: "wait-deploy", threadId: "main", note: "Open the site and confirm the new prices are live.",
    request: "Deploy the price update and check it is live.", openedAt: at(20), expiresAt: soon(100), timeoutMinutes: 120,
    resumeAt: soon(25), status: "waiting" },
];
const closedWaits: string[] = [];
let deployWoke = false;
/** Lets the synthetic server redraw the page after an answer, as a roster refresh would. */
let redraw: () => void = () => undefined;
const rpc = {
  development: {
    list: async () => rows.map(row => ({ projectKey: "mico:mico", taskKey: row.threadId, ...row })),
    requests: async () => requests.filter(request => !answered.includes(request.runId)),
  },
  tasks: {
    waits: async () => waits.filter(wait => !closedWaits.includes(wait.waitId))
      .map(wait => wait.waitId === "wait-deploy" && deployWoke ? { ...wait, status: "woke" as const } : wait),
    // The deploy check woke on the server just before the click, so it is not cancelled.
    cancelWait: async ({ waitId }: { waitId: string }) => {
      if (waitId === "wait-deploy") { deployWoke = true; return { waitId, closed: false, alreadyClosed: false, status: "woke" as const }; }
      closedWaits.push(waitId);
      return { waitId, closed: true, alreadyClosed: false, status: "closed" as const };
    },
  },
} as unknown as RpcClient;
// One client per conversation, bound to it: it reads the conversation first, then answers or sends.
const bind = (threadId: string) => ({ threads: {
  head: async () => ({ threadId, cursor: 1 }),
  get: async () => ({ threadId, cursor: 1, olderCursor: null, botId: "mico", run: null,
    messages: messages(threadId, rows.find(row => row.threadId === threadId)?.title ?? "") }),
  markRead: async () => ({ ok: true, unreadAfterSeq: null }),
  send: async () => ({ taskId: "task", runId: "run", seq: 2 }),
  answer: async (input: { runId: string }) => {
    answered.push(input.runId);
    const row = rows.find(item => item.threadId === threadId);
    if (row) row.state = "running";
    writeConversationRows(scope, () => [...rows]);
    redraw();
    return { ok: true };
  },
} }) as unknown as RpcClient;

function Preview() {
  const [unread, setUnread] = useState(true);
  const [botMenu, setBotMenu] = useState<{ kind: "bot" | "group"; id: string } | null>(null);
  const [shown, setShown] = useState<string | undefined>();
  const [, setTick] = useState(0);
  redraw = () => setTick(value => value + 1);
  const beside = useBeside(scope);
  const anchor = useRef<HTMLElement | null>(null);
  const space: Space = {
    id: spaceId, name: "Personal", isDefault: true, hasContent: true, externalConversations: [], botSections: [],
    bots: [
      { id: "mico", spaceId, name: "Existing Mico", title: "", color: "#10B981", notifyOnFinish: true, pinned: false, sectionId: null,
        unread, unreadCount: unread ? 3 : undefined, parentBotId: null, preview: "Two options look good.", status: "idle", runErrorId: null,
        updatedAt: at(1), conversations: { open: rows.length, unread: unread ? 1 : 0, waiting: answered.length ? 0 : 1, working: 1, revision: `${unread}:${answered.length}` } },
      { id: "writer", spaceId, name: "Writer", title: "", color: "#6366F1", notifyOnFinish: true, pinned: false, sectionId: null,
        unread: false, parentBotId: null, preview: "The post is ready.", status: "idle", runErrorId: null, updatedAt: at(8),
        conversations: { open: 1, unread: unread ? 1 : 0, waiting: 0, working: 0, revision: String(unread) } },
      { id: "helper", spaceId, name: "Helper", title: "", color: "#F59E0B", notifyOnFinish: true, pinned: false, sectionId: null,
        unread: false, parentBotId: null, preview: "Which folder should I use?", status: "waiting_input", runErrorId: null, updatedAt: at(2) },
    ],
    groups: [],
  };
  const groups = sidebarGroupsForSpaces([space], "", { pinned: "Pinned", unassigned: "Unassigned" });
  const mico = space.bots[0]!;
  const markAll = async () => { setUnread(false); };
  return <I18nProvider i18n={i18n}><div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh lg:flex-row">
    <aside data-testid="fixture-sidebar" className="flex shrink-0 flex-col gap-1 border-b border-border bg-sidebar p-2.5 lg:w-80 lg:border-e lg:border-b-0">
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-sm font-medium">Mycellios · Micos</span>
        <SidebarViewMenu folders={[]} hasUnread={unread} onMarkAllRead={markAll} />
      </div>
      <NeedsYouGroup groups={groups} openSpaceChat={(_, path) => setShown(path)} />
      <SidebarRoster sidebarGroups={groups} collapsedSidebarSections={new Set()} bootstrapMe={{ spaceId }} botSections={[]}
        spaces={[space]} rosterDropKey={null} setRosterDropKey={() => undefined} rosterDropAction={() => null} applyRosterDrop={() => undefined}
        openSpaceChat={(_, path) => setShown(path)} spaceMenuAnchor={anchor} setSpaceMenu={() => undefined}
        setRenameSectionTarget={() => undefined} setDeleteSectionTarget={() => undefined} onCreateFolder={() => undefined}
        onMoveFolder={() => undefined} toggleSidebarSection={() => undefined} inGroup={false} active={{ id: "mico" }}
        activeGroup={undefined} botsSidebarDensity="comfortable" dismissedRunErrorIds={new Set()} displayedRunError={null}
        draggedBotId={null} setDraggedBotId={() => undefined} botMenu={botMenu} setBotMenu={setBotMenu} reorderRosterBot={() => undefined}
        activeSnapshot={null} userId={userId} activeThreadId={shown?.includes("task=") ? shown.split("task=")[1] : undefined}
        onOpenConversation={(_, botId, threadId) => setShown(`/app/${botId}?task=${threadId}`)} conversationClient={() => rpc}
        botMenuContent={botMenu?.kind === "bot" ? <BotContextMenu bot={space.bots.find(bot => bot.id === botMenu.id) ?? mico}
          conversationsUnread={unread} sections={[]} onClose={() => setBotMenu(null)} onTogglePinned={() => undefined}
          onMoveToSection={() => undefined} onCreateSection={() => undefined} onToggleUnread={() => { setBotMenu(null); setUnread(true); }}
          onEdit={() => undefined} onDuplicate={() => undefined} onClear={() => undefined} onArchive={() => undefined} onDelete={() => undefined}
          onMarkAllRead={() => { setBotMenu(null); setUnread(false); }} /> : null} />
    </aside>
    <main className="flex min-w-0 flex-1 flex-col p-4">
      <p data-testid="opened" className="text-sm text-muted-foreground">{shown ?? "Main chat"}</p>
      <div className="flex-1 overflow-auto">
        <p className="mx-auto max-w-[42rem] text-sm">The main chat with Existing Mico.</p>
        <OpenWaits rpc={rpc} botId="mico" threadId="main" refreshKey="fixture" />
        <MirroredRequests botId="mico" enabled={answered.length < requests.length} revision={String(answered.length)} rpc={rpc}
          bind={bind} onOpenConversation={threadId => setShown(`/app/mico?task=${threadId}`)} />
      </div>
    </main>
    <aside data-testid="fixture-panel" className="flex h-[36rem] shrink-0 flex-col border-t border-border bg-background lg:h-auto lg:w-[24rem] lg:border-s lg:border-t-0">
      <ConversationsPane botName="Existing Mico" rows={rows} draftOpen={false} currentId={shown?.split("task=")[1]}
        beside={beside} canBeside onOpen={target => { updateBeside(scope, state => closeBeside(state, target)); setShown(`/app/mico?task=${target}`); }}
        onNewConversation={() => setShown("/app/mico?draft=1")} onShow={id => updateBeside(scope, state => showBeside(state, id))}
        onToggleBeside={id => updateBeside(scope, state => state.ids.includes(id) ? closeBeside(state, id) : openBeside(state, id))}
        onCloseBeside={id => updateBeside(scope, state => closeBeside(state, id))} onClose={() => undefined}
        renderConversation={row => <SideConversationView key={row.threadId} botId="mico" threadId={row.threadId} title={row.title}
          micoName="Existing Mico" client={bind(row.threadId)}
          onOpenInChat={() => { updateBeside(scope, state => closeBeside(state, row.threadId)); setShown(`/app/mico?task=${row.threadId}`); }}
          onClose={() => updateBeside(scope, state => closeBeside(state, row.threadId))} />} />
    </aside>
    <Toaster />
  </div></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
