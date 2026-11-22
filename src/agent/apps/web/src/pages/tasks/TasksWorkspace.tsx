import { useLingui } from "@lingui/react/macro";
import type { Bot, InboxTask, Space } from "@mycellios/contracts";
import { ATTACHMENT_MAX_BYTES } from "@mycellios/contracts";
import { automaticThreadTitle, validateAttachmentMimeType } from "@mycellios/core";
import { botColors } from "@mycellios/ui-tokens";
import {
  BotAvatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@mycellios/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleStop,
  LoaderCircle,
  MessageCircleQuestion,
  PanelLeft,
  Pin,
  Bell,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopDragClass } from "../../lib/desktop";
import { readFileAsBase64 } from "../../lib/pending-attachments";
import type { RpcClient } from "../../lib/rpc";
import { selectedSpaceLabel, spaceLabel } from "../../lib/space-label";
import { errorText } from "../../lib/user-error";
import { TaskAgentSelect, TaskComposer } from "./TaskComposer";
import { TaskDetail } from "./TaskDetail";
import { TaskEmptyBoard, TaskEmptyPitch } from "./TaskEmpty";
import { reminderTime } from "./TaskFollowUp";
import { TaskPanelResizer, useTaskPanelWidth } from "./task-panel-width";
import {
  TASK_SECTIONS,
  type TaskSection,
  taskOutcome,
  taskReminderDue,
  taskSection,
  taskTone,
} from "./task-sections";
import { useTaskInbox } from "./use-task-inbox";

/** Archived conversations, most recently archived first. */
function archivedOrder(a: InboxTask, b: InboxTask) {
  return (b.archivedAt ?? b.updatedAt).localeCompare(a.archivedAt ?? a.updatedAt);
}

/** The mark before a row's title; the status text beside it always says the same in words. */
function TaskStatusIcon({ item }: { item: InboxTask }) {
  const working = item.status === "running" || item.status === "leased";
  const outcome = taskOutcome(item);
  const Icon = working
    ? LoaderCircle
    : item.status === "waiting_input" || item.status === "waiting_takeover"
      ? MessageCircleQuestion
      : item.status === "queued"
        ? CircleDashed
        : outcome === "answered"
          ? CircleCheck
          : outcome === "failed"
            ? CircleAlert
            : outcome === "stopped"
              ? CircleStop
              : CircleDashed;
  return <Icon size={14} aria-hidden="true" className={working ? "rk-task-spinner" : ""} />;
}
import "./tasks.css";

export function TasksWorkspace({
  client,
  scope,
  bots,
  spaces,
  spaceId,
  onSpace,
  initialBotId,
  selectedId,
  onSelect,
  onExit,
  onOpenConversation,
  agentsOpen,
  onToggleAgents,
  transcribe,
}: {
  client: RpcClient;
  scope: string;
  bots: Bot[];
  spaces: Space[];
  spaceId: string | null;
  onSpace: (id: string, path: string) => void;
  initialBotId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onExit: () => void;
  /** Opens the conversation in the chat; with a message, at that message. */
  onOpenConversation: (item: InboxTask, messageId?: string) => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  transcribe?: boolean;
}) {
  const { t } = useLingui();
  const state = useTaskInbox(client, scope, initialBotId || bots[0]?.id || "");
  const [query, setQuery] = useState(""),
    [search, showSearch] = useState(false),
    [allArchived, showArchived] = useState(false),
    [expanded, expand] = useState(false),
    [files, setFiles] = useState<Array<{ id: string; name: string }>>([]),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const selected = state.items.find((item) => item.id === selectedId);
  const body = useRef<HTMLDivElement>(null);
  const panel = useTaskPanelWidth(body);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.receipt) setFiles([]);
  }, [state.receipt?.id]);
  const labels: Record<TaskSection, string> = {
    pinned: t`Pinned conversations`,
    newReplies: t`New replies`,
    pending: t`To continue`,
    needsYou: t`Needs you`,
    working: t`Working`,
    waiting: t`Waiting`,
    archived: t`Archived`,
  };
  const empty = state.available === true && !state.items.length && !state.pending;
  useEffect(() => {
    if (!state.botId && bots[0]) state.setBotId(bots[0].id);
  }, [bots, state.botId]);
  function status(item: InboxTask) {
    if (taskReminderDue(item)) return t`Reminder due`;
    if (item.status === "waiting_input" || item.status === "waiting_takeover")
      return t`Needs your answer`;
    if (item.status === "queued") return t`Waiting`;
    if (item.status === "running" || item.status === "leased") return item.progress || t`Working`;
    const outcome = taskOutcome(item);
    if (outcome === "failed") return t`Failed`;
    if (outcome === "stopped") return t`Stopped`;
    if (outcome === "answered") return item.unread ? t`New reply` : t`Answered`;
    return t`Not started`;
  }
  const micoName = (botId: string) => bots.find((bot) => bot.id === botId)?.name ?? t`Mico`;
  /** The line a new task leaves: the Mico and the title the conversation will take. */
  function took(botId: string, text: string) {
    const name = micoName(botId);
    const title = automaticThreadTitle([{ kind: "text", text }]) ?? text;
    return t`${name} took “${title}”`;
  }
  function openedBy(botId: string) {
    const name = micoName(botId);
    return t`${name} opened this conversation`;
  }
  /** Opening a task that is still in its undo window starts it now, then shows it. */
  async function openPending() {
    const started = await state.startNow();
    if (started && mounted.current) onSelect(started.id);
  }
  async function attach(incoming: File[]) {
    if (state.available !== true || state.pending || uploading) return;
    setUploading(true);
    setUploadError("");
    try {
      if (files.length + incoming.length > 10) throw new Error(t`You can attach up to 10 files.`);
      for (const file of incoming) {
        if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(t`This file is too large.`);
        validateAttachmentMimeType(file.type);
        const saved = await client.artifacts.create({
          botId: state.botId,
          name: file.name,
          mimeType: file.type,
          contentBase64: await readFileAsBase64(file),
          clientNonce: crypto.randomUUID(),
        });
        setFiles((current) => [...current, { id: saved.id, name: file.name }]);
      }
    } catch (cause) {
      setUploadError(errorText(cause));
    } finally {
      setUploading(false);
    }
  }
  const pending = state.pending;
  return (
    <section className="rk-tasks-workspace" data-testid="tasks-workspace" aria-label={t`Tasks`}>
      <header
        data-testid="conversation-header"
        className={`rk-tasks-header rk-window-buttons-clear ${desktopDragClass()}`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t`Switch workspace`}
            className="app-no-drag rk-tasks-space"
          >
            <span>{selectedSpaceLabel(spaces, spaceId)}</span>
            <ChevronDown size={11} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                onClick={() => {
                  const first = space.bots[0];
                  onSpace(space.id, first ? `/app/${first.id}?view=tasks` : "/onboarding");
                }}
              >
                {spaceLabel(space.name)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag"
          aria-label={t`Back to chat`}
          onClick={onExit}
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag"
          aria-label={t`Forward`}
          data-task-forward
          disabled
        >
          <ArrowRight size={15} />
        </Button>
        <span className="rk-tasks-header-divider" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag"
          aria-label={agentsOpen ? t`Hide Micos` : t`Show Micos`}
          aria-expanded={agentsOpen}
          onClick={onToggleAgents}
        >
          <PanelLeft size={15} />
        </Button>
        <h2>{t`Tasks`}</h2>
        {state.items.length ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag ms-auto"
            aria-label={t`Find tasks`}
            aria-expanded={search}
            onClick={() => showSearch((value) => !value)}
          >
            <Search size={15} />
          </Button>
        ) : null}
      </header>
      <div className="rk-tasks-body" ref={body}>
        {!expanded || !selected ? (
          <div className="rk-tasks-scroll rk-scroll">
            <div className={`rk-tasks-column ${empty ? "rk-tasks-column-empty" : ""}`}>
              {empty ? <TaskEmptyPitch /> : null}
              {!empty ? (
                <div className="rk-tasks-list-top">
                  <h1>{t`Tasks`}</h1>
                  {search ? (
                    <Input
                      aria-label={t`Find tasks`}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t`Find tasks…`}
                    />
                  ) : null}
                </div>
              ) : null}
              {!empty ? <p className="rk-tasks-description">{t`Task conversations from all your Micos in this workspace. They stay here until you archive them.`}</p> : null}
              <div className="rk-task-compose-wrap">
                <TaskComposer
                  value={state.draft}
                  onChange={state.setDraft}
                  onSubmit={(text) => {
                    state.start(
                      text,
                      files.map((file) => file.id),
                    );
                  }}
                  bots={bots}
                  botId={state.botId}
                  onAgent={(id) => {
                    if (!files.length) state.setBotId(id);
                    else setUploadError(t`Remove the attachments before changing Mico.`);
                  }}
                  disabled={
                    state.available !== true ||
                    Boolean(pending) ||
                    uploading ||
                    !bots.some((bot) => bot.id === state.botId)
                  }
                  transcribe={transcribe}
                  onFiles={(incoming) => void attach(incoming)}
                />
                {files.length ? (
                  <div className="rk-task-files">
                    {files.map((file) => (
                      <span key={file.id}>
                        {file.name}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t`Remove attachment`}
                          onClick={() =>
                            setFiles((current) => current.filter((item) => item.id !== file.id))
                          }
                        >
                          <X size={12} />
                        </Button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {uploading ? (
                  <p className="text-xs text-muted-foreground" role="status">{t`Uploading…`}</p>
                ) : null}
                {uploadError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {uploadError}
                  </p>
                ) : null}
              </div>
              {pending ? (
                <div className="rk-task-receipt" role="status" data-testid="task-pending">
                  <TaskAgentSelect
                    compact
                    bots={bots}
                    botId={pending.botId}
                    onChange={state.reassignPending}
                    disabled={pending.phase !== "scheduled" || Boolean(pending.artifactIds?.length)}
                  />
                  <span className="truncate" dir="auto">{took(pending.botId, pending.text)}</span>
                  {pending.phase === "scheduled" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        const restored = state.undo();
                        if (restored?.artifactIds?.length)
                          setFiles((current) =>
                            restored.artifactIds!.map(
                              (id) =>
                                current.find((file) => file.id === id) ?? {
                                  id,
                                  name: t`Attachment`,
                                },
                            ),
                          );
                      }}
                    >{t`Undo`}</Button>
                  ) : pending.phase === "uncertain" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={state.retry}
                    >{t`Confirm task`}</Button>
                  ) : (
                    <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                  )}
                  {pending.phase === "uncertain" ? null : (
                    <Button size="xs" variant="ghost" onClick={() => void openPending()}>{t`Open`}</Button>
                  )}
                </div>
              ) : state.receipt ? (
                <div className="rk-task-receipt" role="status" data-testid="task-receipt">
                  <BotAvatar
                    identity={state.receipt.botId}
                    color={bots.find((bot) => bot.id === state.receipt?.botId)?.color ?? botColors[3]}
                    size={18}
                  />
                  <span className="truncate" dir="auto">{took(state.receipt.botId, state.receipt.title)}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onSelect(state.receipt!.id)}
                  >{t`Open`}</Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t`Dismiss`}
                    onClick={state.dismissReceipt}
                  >
                    <X size={13} />
                  </Button>
                </div>
              ) : null}
              {state.available === false ? (
                <p role="alert" className="rk-task-load-error">
                  {state.unsupported
                    ? t`This server needs the Tasks update. Your draft stays in this browser.`
                    : state.error || t`Could not load tasks`}
                  <Button size="xs" variant="ghost" onClick={state.refresh}>{t`Retry`}</Button>
                </p>
              ) : state.error ? (
                <p role="alert" className="rk-task-load-error">
                  {state.error}
                </p>
              ) : state.available === null ? (
                <div
                  role="status"
                  className="py-4 text-center text-xs text-muted-foreground"
                >{t`Loading tasks…`}</div>
              ) : null}
              {empty ? (
                <TaskEmptyBoard bots={bots} />
              ) : (
                TASK_SECTIONS.map((section) => {
                  const rows = state.items.filter(
                    (item) =>
                      taskSection(item) === section &&
                      `${item.title} ${bots.find((bot) => bot.id === item.botId)?.name ?? ""}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  );
                  if (!rows.length) return null;
                  if (section === "archived") rows.sort(archivedOrder);
                  const shown = section === "archived" && !allArchived ? rows.slice(0, 5) : rows;
                  return (
                    <section
                      className={`rk-task-section ${section === "archived" ? "rk-task-section-archived" : ""}`}
                      key={section}
                      aria-label={labels[section]}
                    >
                      <h3>
                        {labels[section]} <span>{rows.length}</span>
                      </h3>
                      <ul>
                        {shown.map((item) => {
                          const bot = bots.find((bot) => bot.id === item.botId),
                            tone = taskTone(item),
                            byMico = item.startedBy === "agent" ? openedBy(item.botId) : null;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className="rk-task-row"
                                data-tone={tone ?? undefined}
                                aria-pressed={item.id === selectedId}
                                aria-label={`${item.title} · ${byMico ?? bot?.name ?? t`Mico`} · ${status(item)}`}
                                onClick={() => onSelect(item.id === selectedId ? null : item.id)}
                              >
                                <TaskStatusIcon item={item} />
                                <span className="rk-task-row-title" title={item.title}>
                                  {item.pinned ? <Pin size={11} aria-hidden="true" /> : null}
                                  {byMico ? (
                                    <span className="rk-task-by-mico" title={byMico} data-testid="task-row-by-mico">
                                      <Sparkles size={11} aria-hidden="true" />
                                    </span>
                                  ) : null}
                                  {item.title}
                                  {item.remindAt?<small><Bell size={10}/>{reminderTime(item.remindAt)}</small>:null}
                                </span>
                                <span className={`rk-task-status ${tone ? `rk-task-status-${tone}` : ""}`}>
                                  {status(item)}
                                </span>
                                <span className="rk-task-agent" title={byMico ?? bot?.name}>
                                  <BotAvatar identity={item.botId} color={bot?.color ?? botColors[3]} size={18} />
                                  <span>{bot?.name ?? t`Mico`}</span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {section === "archived" && rows.length > 5 ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-expanded={allArchived}
                          onClick={() => showArchived((value) => !value)}
                        >
                          {allArchived ? t`Show less` : t`Show all archived tasks`}
                        </Button>
                      ) : null}
                    </section>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
        {selected ? (
          <TaskDetail
            scope={scope}
            key={selected.id}
            item={selected}
            client={client}
            bot={bots.find((bot) => bot.id === selected.botId)}
            onClose={() => {
              onSelect(null);
              expand(false);
            }}
            onChanged={() => void state.reload()}
            expanded={expanded}
            onExpand={() => expand((value) => !value)}
            onOpenChat={(messageId) => onOpenConversation(selected, messageId)}
            transcribe={transcribe}
            width={panel.width}
            edge={<TaskPanelResizer width={panel.width} max={panel.max} onResize={panel.resize} />}
          />
        ) : null}
      </div>
    </section>
  );
}
