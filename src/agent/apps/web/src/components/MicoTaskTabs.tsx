import { Trans, useLingui } from "@lingui/react/macro";
import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
  Input, Popover, PopoverContent, PopoverTrigger } from "@mycellios/ui-web";
import { ChevronDown, MessageCircle, MessageCirclePlus, Pencil, Plus, X } from "lucide-react";
import { isRetryableError } from "@mycellios/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { queryClient } from "../lib/query";

type TaskThreadKind = "conversation" | "routine" | "workflow" | "delegation" | "project" | "other";
/** `kind` and `archived` come from the server; an older server omits them and every row reads as ordinary. */
type TaskTab = { threadId: string; title: string; kind?: TaskThreadKind; archived?: boolean };

/** Only ordinary conversations take a user title; the server keeps the others' names. */
function renamable(tab: TaskTab) {
  return !tab.kind || tab.kind === "conversation";
}

/** Keep readable tabs; the picker retains every conversation, including closed tabs. */
export function fitConversationTabs<T extends TaskTab>(tabs: T[], activeId: string | undefined, width: number): T[] {
  const capacity = Math.max(1, Math.floor((width - 80) / 176));
  if (tabs.length <= capacity) return tabs;
  const recent = tabs.slice(-capacity);
  const active = tabs.find(tab => tab.threadId === activeId);
  if (active && !recent.includes(active)) recent[0] = active;
  const ids = new Set(recent.map(tab => tab.threadId));
  return tabs.filter(tab => ids.has(tab.threadId));
}

function readOpenThreads(key: string): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Conversations belong to the existing Mico; a tab never creates another model or agent. */
export function MicoTaskTabs({ botId, taskThreadId, rpc, onSelect, scope, inMenu = false, messageCount = 0 }: {
  botId: string;
  taskThreadId?: string;
  rpc: RpcClient;
  onSelect: (threadId?: string) => void;
  scope: string;
  inMenu?: boolean;
  messageCount?: number;
}) {
  const { t } = useLingui();
  /** A short marker for threads the user did not start as a conversation. */
  const kindLabel = (kind: TaskThreadKind | undefined) =>
    kind === "routine" ? t`Routine` : kind === "workflow" ? t`Workflow` : kind === "delegation" ? t`Delegated`
      : kind === "project" || kind === "other" ? t`Other` : null;
  const cacheKey = ["conversation-tabs", scope];
  const [tabs, setTabs] = useState<TaskTab[]>(() => queryClient.getQueryData<TaskTab[]>(cacheKey) ?? []);
  function writeTabs(update: (rows: TaskTab[]) => TaskTab[]) {
    const next = update(queryClient.getQueryData<TaskTab[]>(cacheKey) ?? []);
    queryClient.setQueryData(cacheKey, next);
    setTabs(next);
  }
  const storageKey = `mycellios:open-task-tabs:${scope}`;
  const [openIds, setOpenIds] = useState(() => readOpenThreads(storageKey));
  const activeTab = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState(() => queryClient.getQueryData<number>([...cacheKey, "width"]) ?? 0);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TaskTab | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<string | null>(null);
  const alive = useRef(true);
  const creating = useRef(false);
  const renaming = useRef(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  const cancellingRename = useRef(false);
  useEffect(() => {
    if (taskThreadId) setOpenIds(ids => ids.includes(taskThreadId) ? ids : [...ids, taskThreadId]);
  }, [taskThreadId]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(openIds)); } catch { /* Storage is optional. */ }
  }, [storageKey, openIds]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (inMenu || !nav.current || typeof ResizeObserver === "undefined") return;
    const measure = (width: number) => {
      setAvailableWidth(width);
      queryClient.setQueryData([...cacheKey, "width"], width);
    };
    measure(nav.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(nav.current);
    return () => observer.disconnect();
  }, [inMenu]);
  useEffect(() => {
    if (renameTarget) { renameInput.current?.focus(); renameInput.current?.select(); }
  }, [renameTarget]);
  useEffect(() => {
    let active = true;
    let pending = false;
    let refused = false;
    setLoadFailed(false);
    const load = async () => {
      if (pending || refused) return;
      pending = true;
      try {
        const rows = await rpc.development.list({ botId });
        // A conversation being deleted stays hidden until it is restored or removed.
        if (active) { writeTabs(() => rows.filter(row => !row.projectKey?.startsWith("project:") && !row.deleteAfter)); setLoadFailed(false); }
      } catch (cause) { refused = !isRetryableError(cause); if (active) setLoadFailed(true); }
      finally { pending = false; }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [rpc, botId, revision, taskThreadId, messageCount]);

  async function create() {
    if (creating.current) return;
    creating.current = true;
    request.current ??= `mico-task:${botId}:${crypto.randomUUID()}`;
    setBusy(true);
    setError("");
    try {
      const result = await rpc.development.open({ botId, projectKey: `mico:${botId}`, taskKey: request.current });
      if (!alive.current) return;
      request.current = null;
      setThreadPickerOpen(false);
      writeTabs(rows => rows.some(row => row.threadId === result.threadId)
        ? rows : [...rows, { threadId: result.threadId, title: "" }]);
      const nextIds = openIds.includes(result.threadId) ? openIds : [...openIds, result.threadId];
      // The scoped chat may remount immediately on navigation, before effects run.
      try { localStorage.setItem(storageKey, JSON.stringify(nextIds)); } catch { /* Optional storage. */ }
      setOpenIds(nextIds);
      onSelect(result.threadId);
      setRevision(value => value + 1);
    } catch { if (alive.current) setError(t`Could not create the conversation. Try again.`); }
    finally { creating.current = false; if (alive.current) setBusy(false); }
  }
  const tabIds = taskThreadId && !openIds.includes(taskThreadId) ? [...openIds, taskThreadId] : openIds;
  const visibleTabs = tabIds.flatMap(threadId => {
    const tab = tabs.find(row => row.threadId === threadId);
    return tab ? [tab] : threadId === taskThreadId ? [{ threadId, title: "" }] : [];
  });
  const displayedTabs = fitConversationTabs(visibleTabs, taskThreadId, availableWidth);

  useEffect(() => {
    activeTab.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [taskThreadId, tabs.length]);

  function closeTab(threadId: string) {
    if (renameTarget?.threadId === threadId) { cancellingRename.current = true; setRenameTarget(null); setRenameError(""); }
    const nextIds = openIds.filter(id => id !== threadId);
    try { localStorage.setItem(storageKey, JSON.stringify(nextIds)); } catch { /* Optional storage. */ }
    setOpenIds(nextIds);
    if (threadId === taskThreadId) {
      const index = visibleTabs.findIndex(tab => tab.threadId === threadId);
      onSelect(visibleTabs[index - 1]?.threadId);
    }
  }

  function startRename(tab: TaskTab, inPicker = false) {
    cancellingRename.current = false;
    setName(tab.title); setRenameError(""); setRenameTarget(tab);
    setThreadPickerOpen(inPicker || !displayedTabs.some(row => row.threadId === tab.threadId));
  }

  async function rename() {
    if (!renameTarget || cancellingRename.current || renaming.current) return;
    if (!name.trim() || name.trim() === renameTarget.title) { setRenameTarget(null); return; }
    renaming.current = true; setRenameBusy(true); setRenameError("");
    try {
      const result = await rpc.development.rename({ botId, taskThreadId: renameTarget.threadId, title: name.trim() });
      if (!alive.current) return;
      writeTabs(rows => rows.map(row => row.threadId === result.threadId ? { ...row, title: result.title } : row));
      setRenameTarget(null); setRevision(value => value + 1);
    } catch { if (alive.current) setRenameError(t`Could not rename the conversation. Try again.`); }
    finally { renaming.current = false; if (alive.current) setRenameBusy(false); }
  }

  function titleEditor() {
    return <Input ref={renameInput} autoFocus aria-label={t`Conversation title`}
      value={name} maxLength={120} readOnly={renameBusy} aria-busy={renameBusy}
      aria-invalid={Boolean(renameError)} className="h-7 min-w-0 flex-1 rounded-md border-0 bg-background px-2 text-sm shadow-none"
      onFocus={event => event.currentTarget.select()}
      onChange={event => { setName(event.target.value); setRenameError(""); }}
      onBlur={() => { if (!renameError) void rename(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); void rename(); }
        if (event.key === "Escape" && !renameBusy) {
          event.preventDefault(); event.stopPropagation(); cancellingRename.current = true; setRenameTarget(null); setRenameError("");
        }
      }} />;
  }

  function pickerRow(tab: TaskTab) {
    const kind = kindLabel(tab.kind);
    return <ContextMenu key={tab.threadId}>
      <ContextMenuTrigger render={<div />} className="group/conversation-row flex min-w-0 items-center gap-1 rounded-md has-[[aria-current=page]]:bg-muted">
      {renameTarget?.threadId === tab.threadId && threadPickerOpen ? titleEditor() : <Button size="sm" variant="ghost"
        className="h-auto min-h-8 min-w-0 flex-1 justify-start gap-2 bg-transparent py-1.5 text-start hover:bg-muted/60" aria-current={tab.threadId === taskThreadId ? "page" : undefined}
        onClick={() => { setThreadPickerOpen(false); onSelect(tab.threadId); }}>
        <span className="line-clamp-2 min-w-0 whitespace-normal break-words" title={tab.title || t`New conversation`} dir="auto">{tab.title || t`New conversation`}</span>
        {kind ? <span data-thread-kind={tab.kind} className="ms-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{kind}</span> : null}
      </Button>}
      {renamable(tab) ? <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground opacity-0 group-hover/conversation-row:opacity-100 group-focus-within/conversation-row:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t`Rename conversation`} onClick={() => startRename(tab, true)}><Pencil size={14} aria-hidden="true" /></Button> : null}
      </ContextMenuTrigger>
      {renamable(tab) ? <ContextMenuContent><ContextMenuItem onClick={() => startRename(tab)}><Pencil size={14} aria-hidden="true" /><Trans>Rename conversation</Trans></ContextMenuItem></ContextMenuContent> : null}
    </ContextMenu>;
  }

  return <nav ref={nav} aria-label={t`Conversations`} className={inMenu ? "min-w-0" : "flex min-w-0 flex-1 items-center gap-1 md:ms-1 md:border-s md:border-border md:ps-3"}>
    {!inMenu ? <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {displayedTabs.map(tab => (
        <ContextMenu key={tab.threadId}>
        <ContextMenuTrigger render={<div />} data-active={tab.threadId === taskThreadId ? "" : undefined}
          className="app-no-drag group/task-tab relative flex h-7 min-w-0 max-w-64 flex-1 items-center overflow-hidden rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[active]:bg-muted data-[active]:text-foreground">
          {renameTarget?.threadId === tab.threadId && !threadPickerOpen ? titleEditor() : <Button ref={tab.threadId === taskThreadId ? activeTab : undefined} size="sm" variant="ghost"
            className="h-full min-w-0 flex-1 shrink justify-start gap-1.5 overflow-hidden bg-transparent px-2 font-normal hover:bg-transparent"
            aria-current={tab.threadId === taskThreadId ? "page" : undefined} title={tab.title || t`New conversation`}
            onClick={() => tab.threadId !== taskThreadId ? onSelect(tab.threadId) : renamable(tab) ? startRename(tab) : undefined}>
            <MessageCircle size={14} aria-hidden="true" />
            <span className="min-w-0 truncate" dir="auto">{tab.title || t`New conversation`}</span>
          </Button>}
          <Button size="icon-sm" variant="ghost" className="me-1 size-5 shrink-0 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/task-tab:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={t`Close tab`} onClick={() => closeTab(tab.threadId)}>
            <X size={13} aria-hidden="true" />
          </Button>
        </ContextMenuTrigger>
        {renamable(tab) ? <ContextMenuContent><ContextMenuItem onClick={() => startRename(tab)}><Pencil size={14} aria-hidden="true" /><Trans>Rename conversation</Trans></ContextMenuItem></ContextMenuContent> : null}
        </ContextMenu>
      ))}
    </div> : null}
    {!inMenu ? <Button size="icon-sm" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-foreground" aria-label={t`New conversation`} title={t`New conversation`} disabled={busy} aria-busy={busy} onClick={() => void create()}><Plus size={16} aria-hidden="true" /></Button> : null}
    <Popover open={threadPickerOpen} onOpenChange={setThreadPickerOpen}>
      <PopoverTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t`Conversations`} title={t`Conversations`} data-mobile-chat-action={inMenu || undefined} />}>
        {inMenu ? <><MessageCircle aria-hidden /><Trans>Conversations</Trans></> : <ChevronDown size={15} aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[60dvh] w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-1 [&_button]:font-normal">
        <div className="mb-1 border-b border-border pb-1">
          <Button size="sm" variant="ghost" className="w-full justify-start gap-2" disabled={busy} onClick={() => void create()}>
            <MessageCirclePlus size={15} aria-hidden="true" /><Trans>New conversation</Trans>
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="justify-start aria-[current=page]:bg-muted" aria-current={!taskThreadId ? "page" : undefined} onClick={() => { setThreadPickerOpen(false); onSelect(); }}><Trans>Main chat</Trans></Button>
        {tabs.filter(tab => !tab.archived).map(pickerRow)}
        {tabs.some(tab => tab.archived) ? <div className="mt-1 border-t border-border pt-1">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="px-2.5 py-1 text-xs font-medium text-muted-foreground"><Trans>Archived</Trans></legend>
            {tabs.filter(tab => tab.archived).map(pickerRow)}
          </fieldset>
        </div> : null}
        {loadFailed ? <Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}><Trans>Retry</Trans></Button> : null}
      </PopoverContent>
    </Popover>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {renameError ? <p role="alert" className="max-w-52 text-xs text-destructive">{renameError}</p> : null}
  </nav>;
}
