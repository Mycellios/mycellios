import { botColors } from "@rakazo/ui-tokens";
import { useLingui } from "@lingui/react/macro";
import type { Bot, InboxTask, Space } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { validateAttachmentMimeType } from "@rakazo/core";
import { Input,
  BotAvatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { desktopDragClass, desktopHidesTitleBar } from "../../lib/desktop";
import { readFileAsBase64 } from "../../lib/pending-attachments";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { TaskAgentSelect, TaskComposer } from "./TaskComposer";
import { TaskDetail } from "./TaskDetail";
import { TaskEmptyBoard, TaskEmptyPitch } from "./TaskEmpty";
import { TASK_SECTIONS, type TaskSection, taskSection } from "./task-sections";
import { useTaskInbox } from "./use-task-inbox";
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
  useEffect(() => {
    if (state.receipt) setFiles([]);
  }, [state.receipt?.id]);
  const labels: Record<TaskSection, string> = {
    needsYou: t`Needs you`,
    working: t`Working`,
    waiting: t`Waiting`,
    unread: t`New answers`,
    read: t`Read`,
    archived: t`Archived`,
  };
  const empty = state.available !== null && !state.items.length && !state.pending;
  useEffect(() => {
    if (!state.botId && bots[0]) state.setBotId(bots[0].id);
  }, [bots, state.botId]);
  function status(item: InboxTask) {
    if (item.status === "completed") return t({ context: "task status", message: "Answered" });
    if (item.status === "cancelled") return t`Stopped`;
    if (item.status === "failed") return t`Failed`;
    if (item.status === "waiting_input" || item.status === "waiting_takeover")
      return t`Needs your answer`;
    if (item.status === "queued") return t`Waiting`;
    return item.progress || t`Working`;
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
        className={`rk-tasks-header ${desktopDragClass()}`}
        style={desktopHidesTitleBar() ? { paddingInlineStart: 48 } : undefined}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t`Switch workspace`}
            className="app-no-drag rk-tasks-space"
          >
            <span>{spaces.find((space) => space.id === spaceId)?.name ?? "Mycellios"}</span>
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
                {space.name}
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
      <div className="rk-tasks-body">
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
                <div className="rk-task-receipt" role="status">
                  <TaskAgentSelect
                    bots={bots}
                    botId={pending.botId}
                    onChange={state.reassignPending}
                    disabled={pending.phase !== "scheduled" || Boolean(pending.artifactIds?.length)}
                  />
                  <span className="truncate">{pending.text}</span>
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
                    <LoaderCircle size={14} className="animate-spin" />
                  )}
                </div>
              ) : state.receipt ? (
                <div className="rk-task-receipt" role="status">
                  <span className="truncate">
                    {t`Task assigned`} · {bots.find((bot) => bot.id === state.receipt?.botId)?.name}
                  </span>
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
                            Icon =
                              item.status === "completed"
                                ? CircleCheck
                                : item.status === "failed" || item.status === "waiting_input"
                                  ? CircleAlert
                                  : item.status === "queued"
                                    ? CircleDashed
                                    : LoaderCircle;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className="rk-task-row"
                                aria-pressed={item.id === selectedId}
                                onClick={() => onSelect(item.id === selectedId ? null : item.id)}
                              >
                                <Icon
                                  size={14}
                                  className={section === "working" ? "rk-task-spinner" : ""}
                                />
                                <span className="rk-task-row-title" title={item.title}>
                                  {item.title}
                                </span>
                                <span
                                  className={`rk-task-status ${item.unread || section === "needsYou" ? "rk-task-answered" : ""}`}
                                >
                                  {status(item)}
                                </span>
                                <BotAvatar
                                  identity={item.botId}
                                  color={bot?.color ?? botColors[3]}
                                  size={18}
                                />
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
            transcribe={transcribe}
          />
        ) : null}
      </div>
    </section>
  );
}
