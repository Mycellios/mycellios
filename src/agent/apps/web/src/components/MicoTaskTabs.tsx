import { Trans, useLingui } from "@lingui/react/macro";
import { Button, ContextMenu, ContextMenuTrigger, Input, Popover, PopoverContent, PopoverTrigger, toast } from "@mycellios/ui-web";
import { ArchiveRestore, ChevronDown, MessageCircle, MessageCirclePlus, Pencil, Plus, X } from "lucide-react";
import { isRetryableError } from "@mycellios/core";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { queryClient } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import {
  closeOtherTabs, closeTab, closeTabsToRight, type ConversationRow, conversationStatus, type ConversationTabs,
  isClosedConversation, moveTab, NEW_CONVERSATION_TAB, openTab, parkTab, pickerConversations, placeTab,
  readConversationTabs, reconcileConversationTabs, unparkTab, updateConversationTabs,
  useConversationRows, useConversationTabs, writeConversationRows,
} from "../lib/thread-tabs";
import { errorText } from "../lib/user-error";
import { WaitingForYouBadge } from "./ConversationsPane";
import { DeleteConversationDialog, ThreadMenu, ThreadMenuButton } from "./ThreadMenu";
import { ThreadStatusMark } from "./ThreadStatusMark";

type TaskTab = ConversationRow;

/** Conversations the person started, or that the Mico started for them, take a user title. */
function renamable(tab: TaskTab) {
  return tab.threadId !== NEW_CONVERSATION_TAB && (!tab.kind || tab.kind === "conversation" || tab.startedBy === "agent");
}

/** Conversations that are not owned by a routine, workflow, delegation or app. */
const ownConversation = renamable;
/** A conversation that waits for the person holds no work: deleting it cancels the wait. */
const working = (tab: TaskTab) => tab.state === "running" || tab.state === "queued";
const LIST_LIMIT = 1000;
/** The navigation of the tab row on screen per Mico, for actions that end after a remount (Undo). */
const mountedSelectors = new Map<string, (target?: string) => void>();
/** Below these widths the tab row turns into a switcher, then into the picker button alone. */
// Leave room for the main chat, labeled picker, and new-conversation action.
const DESKTOP_CONTROLS_WIDTH = 360;
export const COMPACT_TABS_WIDTH = 440;
export const MINIMAL_TABS_WIDTH = 48;

/** Keep readable tabs; the picker retains every conversation, including closed tabs. */
export function fitConversationTabs<T extends { threadId: string }>(tabs: T[], activeId: string | undefined, width: number): T[] {
  const capacity = Math.max(1, Math.floor((width - DESKTOP_CONTROLS_WIDTH) / 176));
  if (tabs.length <= capacity) return tabs;
  const recent = tabs.slice(-capacity);
  const active = tabs.find(tab => tab.threadId === activeId);
  if (active && !recent.includes(active)) recent[0] = active;
  const ids = new Set(recent.map(tab => tab.threadId));
  return tabs.filter(tab => ids.has(tab.threadId));
}

/** A text field holding text keeps Alt+Shift+arrows for selecting by paragraph. */
function editableWithText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value.length > 0;
  return target.isContentEditable && Boolean(target.textContent);
}

/** Conversations belong to the existing Mico; a tab never creates another model or agent. */
export function MicoTaskTabs({
  botId, taskThreadId, newConversationOpen = false, rpc, onSelect, onWarm, scope, inMenu = false, messageCount = 0,
  confirmDelete = false, refreshKey, onConversationsChanged,
}: {
  botId: string;
  taskThreadId?: string;
  /** The draft tab is shown: the next message starts a conversation. */
  newConversationOpen?: boolean;
  rpc: RpcClient;
  /** A thread id, NEW_CONVERSATION_TAB for the draft, or nothing for the main chat. */
  onSelect: (target?: string) => void;
  onWarm?: (botId: string, taskThreadId: string) => Promise<unknown>;
  scope: string;
  inMenu?: boolean;
  messageCount?: number;
  /** Phones ask before deleting instead of offering Undo. */
  confirmDelete?: boolean;
  /** Changes when the roster reports that the Mico's conversations moved, so the list is read again. */
  refreshKey?: string;
  /** A conversation was archived, deleted or restored: the sidebar's "Needs you" reads it again. */
  onConversationsChanged?: () => void;
}) {
  const { t } = useLingui();
  /** A short marker for threads the user did not start as a conversation. */
  const kindLabel = (tab: TaskTab) => tab.startedBy === "agent" ? null
    : tab.kind === "routine" ? t`Routine` : tab.kind === "workflow" ? t`Workflow` : tab.kind === "delegation" ? t`Delegated`
      : tab.kind === "project" || tab.kind === "other" ? t`Other` : null;
  const tabs = useConversationRows(scope);
  const tabState = useConversationTabs(scope);
  const update = (change: (state: ConversationTabs) => ConversationTabs) => updateConversationTabs(scope, change);
  const current = newConversationOpen ? NEW_CONVERSATION_TAB : taskThreadId;
  const currentRef = useRef(current);
  currentRef.current = current;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onChangedRef = useRef(onConversationsChanged);
  onChangedRef.current = onConversationsChanged;
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = useState(() => queryClient.getQueryData<number>(["conversation-tabs", scope, "width"]) ?? 0);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TaskTab | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<TaskTab | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropMark, setDropMark] = useState<{ id: string; after: boolean } | null>(null);
  const alive = useRef(true);
  const renaming = useRef(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  const cancellingRename = useRef(false);

  useEffect(() => {
    update(state => {
      let next = state;
      if (taskThreadId) next = openTab(next, taskThreadId);
      if (newConversationOpen) next = openTab(next, NEW_CONVERSATION_TAB);
      const active = current ?? null;
      return next.active === active ? next : { ...next, active };
    });
  }, [scope, taskThreadId, newConversationOpen]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (inMenu) return;
    const navigate = (target?: string) => onSelectRef.current(target);
    mountedSelectors.set(scope, navigate);
    return () => { if (mountedSelectors.get(scope) === navigate) mountedSelectors.delete(scope); };
  }, [scope, inMenu]);
  useLayoutEffect(() => {
    if (inMenu || !nav.current || typeof ResizeObserver === "undefined") return;
    const measure = (width: number) => {
      setAvailableWidth(width);
      queryClient.setQueryData(["conversation-tabs", scope, "width"], width);
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

  /** Leaves a tab that is going away for the tab on its left, or the main chat. */
  function leave(id: string, before: ConversationTabs) {
    if (currentRef.current !== id) return;
    const index = before.ids.indexOf(id);
    onSelectRef.current(index > 0 ? before.ids[index - 1] : undefined);
  }

  useEffect(() => {
    let active = true;
    let pending = false;
    let refused = false;
    let timer: number | undefined;
    setLoadFailed(false);
    const schedule = (rows: readonly TaskTab[]) => {
      window.clearTimeout(timer);
      // Watch working conversations closely; idle ones only change on a reply.
      timer = window.setTimeout(refresh, rows.some(row => row.state === "running" || row.state === "queued") ? 5_000 : 15_000);
    };
    const load = async () => {
      if (pending || refused) return;
      pending = true;
      try {
        const listed = await rpc.development.list({ botId });
        if (!active) return;
        const rows = listed.filter(row => !row.projectKey?.startsWith("project:"));
        const cached = queryClient.getQueryData<TaskTab[]>(["conversation-tabs", scope]);
        writeConversationRows(scope, () => rows);
        const before = readConversationTabs(scope);
        const after = update(state => reconcileConversationTabs(state, rows, {
          activeId: currentRef.current, previous: cached, complete: listed.length < LIST_LIMIT,
        }));
        // The open view of a conversation archived or deleted elsewhere closes with its tab.
        const shown = currentRef.current;
        if (shown && before.ids.includes(shown) && after.parked.some(tab => tab.id === shown)) leave(shown, before);
        setLoadFailed(false);
        schedule(rows);
      } catch (cause) {
        refused = !isRetryableError(cause);
        if (active) { setLoadFailed(true); if (!refused) schedule([]); }
      } finally { pending = false; }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); else schedule([]); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [rpc, botId, revision, taskThreadId, messageCount, refreshKey]);

  const draftTab: TaskTab = { threadId: NEW_CONVERSATION_TAB, title: "" };
  const tabIds = [...tabState.ids];
  if (taskThreadId && !tabIds.includes(taskThreadId)) tabIds.push(taskThreadId);
  if (newConversationOpen && !tabIds.includes(NEW_CONVERSATION_TAB)) tabIds.push(NEW_CONVERSATION_TAB);
  const visibleTabs = tabIds.flatMap(threadId => {
    if (threadId === NEW_CONVERSATION_TAB) return [draftTab];
    const tab = tabs.find(row => row.threadId === threadId);
    return tab ? [tab] : threadId === taskThreadId ? [{ threadId, title: "" }] : [];
  });
  const displayedTabs = fitConversationTabs(visibleTabs, current, availableWidth);
  // On a phone only the active tab may fit. Include picker destinations so
  // responsive layout does not disable preloading the next conversation.
  const warmCandidates = threadPickerOpen ? tabs : inMenu ? [] : [...displayedTabs, ...tabs];
  const warmTabs = JSON.stringify([...new Set(warmCandidates
    .filter(tab => tab.threadId !== current && tab.threadId !== NEW_CONVERSATION_TAB && !tab.deleteAfter)
    .map(tab => tab.threadId))].slice(0, 2));

  function warmThread(threadId: string) {
    if (threadId !== current && threadId !== NEW_CONVERSATION_TAB && document.visibilityState === "visible") {
      void onWarm?.(botId, threadId).catch(() => undefined);
    }
  }

  useEffect(() => {
    if (!onWarm || document.visibilityState !== "visible") return;
    // At most two reads; one slow destination must not block the other.
    for (const threadId of JSON.parse(warmTabs) as string[]) {
      void onWarm(botId, threadId).catch(() => undefined);
    }
  }, [botId, onWarm, warmTabs]);
  const displayedIds = new Set(displayedTabs.map(tab => tab.threadId));
  const listed = tabs.filter(row => !row.deleteAfter);
  const picker = pickerConversations(listed);
  const unread = picker.open.filter(row => row.unread);
  const read = inMenu ? picker.open.filter(row => !row.unread) : [];
  const compact = !inMenu && availableWidth > 0 && availableWidth < COMPACT_TABS_WIDTH;
  const minimal = compact && availableWidth < MINIMAL_TABS_WIDTH;
  const hiddenReplies = unread.some(row => row.threadId !== current && (inMenu || compact || !displayedIds.has(row.threadId)));
  const showPicker = inMenu || loadFailed || listed.length > 0;
  const titleOf = (tab: TaskTab) => tab.threadId === NEW_CONVERSATION_TAB ? t`New conversation` : tab.title || t`New conversation`;
  const currentTitle = current ? titleOf(visibleTabs.find(tab => tab.threadId === current) ?? { threadId: current, title: "" }) : t`Main chat`;

  useEffect(() => {
    if (current) tabButtons.current.get(current)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current, tabs.length]);

  // Global shortcuts belong to the tab row in the header, never to the copy in a menu.
  const stepRef = useRef<(delta: number) => void>(() => undefined);
  stepRef.current = delta => {
    const order: Array<string | undefined> = [undefined, ...readConversationTabs(scope).ids];
    const index = Math.max(0, order.indexOf(currentRef.current));
    const target = order[(index + delta + order.length) % order.length];
    if (order.length > 1 && target !== currentRef.current) select(target);
  };
  const openDraftRef = useRef(openDraft);
  openDraftRef.current = openDraft;
  useEffect(() => {
    if (inMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.code === "KeyO") {
        event.preventDefault(); openDraftRef.current(); return;
      }
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        if (editableWithText(event.target)) return;
        event.preventDefault(); stepRef.current(event.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inMenu]);

  function select(target?: string) {
    setThreadPickerOpen(false);
    // The scoped chat may remount on navigation before effects run, so store the tab first.
    if (target) update(state => openTab(state, target));
    onSelect(target);
  }

  function openDraft() {
    setError("");
    select(NEW_CONVERSATION_TAB);
  }

  function focusAfterClose(before: ConversationTabs, id: string) {
    const index = before.ids.indexOf(id);
    const next = before.ids[index + 1] ?? before.ids[index - 1];
    requestAnimationFrame(() => (next && tabButtons.current.get(next) || addButton.current)?.focus({ preventScroll: true }));
  }

  function closeTabAction(id: string, focus = false) {
    if (renameTarget?.threadId === id) { cancellingRename.current = true; setRenameTarget(null); setRenameError(""); }
    const before = readConversationTabs(scope);
    update(state => closeTab(state, id));
    if (focus) focusAfterClose(before, id);
    leave(id, { ...before, ids: before.ids.includes(id) ? before.ids : [...before.ids, id] });
  }

  function closeOthers(id?: string) {
    update(state => closeOtherTabs(state, id ?? null));
    if (currentRef.current !== id) select(id);
  }

  function closeToRight(id: string) {
    const before = readConversationTabs(scope);
    update(state => closeTabsToRight(state, id));
    const shown = currentRef.current;
    if (shown && before.ids.indexOf(shown) > before.ids.indexOf(id)) select(id);
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds(ids => {
      const next = new Set(ids);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }

  const markRow = (id: string, patch: Partial<TaskTab>) =>
    writeConversationRows(scope, rows => rows.map(row => row.threadId === id ? { ...row, ...patch } : row));

  async function archive(tab: TaskTab) {
    if (busyIds.has(tab.threadId)) return;
    setBusy(tab.threadId, true);
    try {
      // The server stops the conversation's queued messages and work before it archives.
      const result = await rpc.development.archive({ botId, taskThreadId: tab.threadId });
      const before = readConversationTabs(scope);
      const wasShown = currentRef.current === tab.threadId;
      update(state => closeTab(state, tab.threadId));
      markRow(tab.threadId, { archived: true, archivedAt: result.archivedAt, state: "closed" });
      leave(tab.threadId, before);
      setRevision(value => value + 1);
      onChangedRef.current?.();
      // Another conversation may share the title, so say which one left and offer it back.
      const title = titleOf(tab);
      toast(t`${title} archived`, {
        action: { label: t`Undo`, onClick: () => void undoArchive(tab.threadId, wasShown) },
      });
    } catch (cause) {
      toast.error(errorText(cause, t`Could not archive the conversation. Try again.`));
    } finally { if (alive.current) setBusy(tab.threadId, false); }
  }

  async function undoArchive(id: string, reopen: boolean) {
    try {
      await rpc.development.restore({ botId, taskThreadId: id });
      markRow(id, { archived: false, archivedAt: null, state: "idle" });
      update(state => openTab(state, id));
      if (reopen) (mountedSelectors.get(scope) ?? onSelectRef.current)(id);
      if (alive.current) setRevision(value => value + 1);
      onChangedRef.current?.();
    } catch (cause) {
      toast.error(errorText(cause, t`Could not restore the conversation. Try again.`));
    }
  }

  async function restore(tab: TaskTab) {
    if (busyIds.has(tab.threadId)) return;
    setBusy(tab.threadId, true);
    setError("");
    try {
      await rpc.development.restore({ botId, taskThreadId: tab.threadId });
      markRow(tab.threadId, { archived: false, archivedAt: null, state: "idle" });
      select(tab.threadId);
      setRevision(value => value + 1);
      onChangedRef.current?.();
    } catch (cause) {
      if (alive.current) setError(errorText(cause, t`Could not restore the conversation. Try again.`));
    } finally { if (alive.current) setBusy(tab.threadId, false); }
  }

  function requestDelete(tab: TaskTab) {
    if (working(tab) || busyIds.has(tab.threadId)) return;
    if (confirmDelete || inMenu) setDeleteTarget(tab);
    else void remove(tab, true);
  }

  async function remove(tab: TaskTab, offerUndo: boolean) {
    const id = tab.threadId;
    const title = titleOf(tab);
    const before = readConversationTabs(scope);
    const wasShown = currentRef.current === id;
    // Hide it at once; its place is kept so Undo puts it back there.
    update(state => parkTab(state, id));
    markRow(id, { deleteAfter: new Date().toISOString() });
    leave(id, before);
    setBusy(id, true);
    try {
      const { deleteAfter } = await rpc.development.remove({ botId, taskThreadId: id });
      markRow(id, { deleteAfter });
      onChangedRef.current?.();
      if (offerUndo) {
        toast(t`${title} deleted`, {
          duration: Math.max(1_000, Date.parse(deleteAfter) - Date.now()),
          action: { label: t`Undo`, onClick: () => void undo(id, wasShown) },
        });
      }
    } catch (cause) {
      update(state => unparkTab(state, id));
      markRow(id, { deleteAfter: null });
      if (wasShown) (mountedSelectors.get(scope) ?? onSelectRef.current)(id);
      toast.error(errorText(cause, t`Could not delete the conversation. Try again.`));
    } finally { if (alive.current) setBusy(id, false); }
  }

  async function undo(id: string, reopen: boolean) {
    try {
      await rpc.development.restore({ botId, taskThreadId: id });
      update(state => unparkTab(state, id));
      markRow(id, { deleteAfter: null });
      if (reopen) (mountedSelectors.get(scope) ?? onSelectRef.current)(id);
      if (alive.current) setRevision(value => value + 1);
      onChangedRef.current?.();
    } catch (cause) {
      toast.error(errorText(cause, t`Could not undo the deletion.`));
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
      markRow(result.threadId, { title: result.title, titleSource: "user" });
      setRenameTarget(null); setRevision(value => value + 1);
    } catch (cause) { if (alive.current) setRenameError(errorText(cause, t`Could not rename the conversation. Try again.`)); }
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

  /** What a conversation's own menu offers: rename, archive or restore, and delete. */
  function conversationActions(tab: TaskTab) {
    if (tab.threadId === NEW_CONVERSATION_TAB || !ownConversation(tab)) return {};
    const closed = isClosedConversation(tab);
    return {
      onRename: () => startRename(tab),
      ...(closed ? { onRestore: () => void restore(tab) } : { onArchive: () => void archive(tab) }),
      onDelete: () => requestDelete(tab),
      deleteDisabled: working(tab),
      busy: busyIds.has(tab.threadId),
    };
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tab: TaskTab) {
    if (event.nativeEvent.isComposing) return;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if ((event.key === "Delete" || event.key === "Backspace") && plain) {
      event.preventDefault(); closeTabAction(tab.threadId, true); return;
    }
    if (event.key === "F2" && plain && renamable(tab)) { event.preventDefault(); startRename(tab); return; }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const rtl = nav.current ? getComputedStyle(nav.current).direction === "rtl" : false;
      const delta = (event.key === "ArrowRight") !== rtl ? 1 : -1;
      const wasFocused = document.activeElement === event.currentTarget;
      update(state => moveTab(state, tab.threadId, delta));
      if (wasFocused) requestAnimationFrame(() => {
        // Moving a focused node may blur it. Never take focus back from a later action.
        if (document.activeElement === document.body) {
          tabButtons.current.get(tab.threadId)?.focus({ preventScroll: true });
        }
      });
    }
  }

  function dropOn(target: string, after: boolean) {
    const id = dragged;
    setDragged(null); setDropMark(null);
    if (!id || id === target) return;
    update(state => {
      const rest = state.ids.filter(tab => tab !== id);
      const at = rest.indexOf(target);
      return at < 0 ? state : placeTab(state, id, at + (after ? 1 : 0));
    });
  }

  function tabItem(tab: TaskTab) {
    const active = tab.threadId === current;
    const draft = tab.threadId === NEW_CONVERSATION_TAB;
    const status = draft ? null : conversationStatus(tab);
    const title = titleOf(tab);
    const editing = renameTarget?.threadId === tab.threadId && !threadPickerOpen;
    return <ContextMenu key={tab.threadId}>
      <ContextMenuTrigger render={<div />} data-active={active ? "" : undefined} data-thread-tab={tab.threadId}
        data-drop={dropMark?.id === tab.threadId ? (dropMark.after ? "after" : "before") : undefined}
        draggable={!editing}
        onDragStart={event => { setDragged(tab.threadId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", title); }}
        onDragOver={event => {
          if (!dragged || dragged === tab.threadId) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
          const after = (event.clientX > box.left + box.width / 2) !== rtl;
          if (dropMark?.id !== tab.threadId || dropMark.after !== after) setDropMark({ id: tab.threadId, after });
        }}
        onDrop={event => { event.preventDefault(); dropOn(tab.threadId, dropMark?.id === tab.threadId ? dropMark.after : false); }}
        onDragEnd={() => { setDragged(null); setDropMark(null); }}
        className="app-no-drag group/task-tab relative flex h-7 min-w-0 max-w-64 flex-auto items-center overflow-hidden rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[active]:bg-muted data-[active]:text-foreground data-[drop=before]:shadow-[inset_2px_0_0_var(--primary)] data-[drop=after]:shadow-[inset_-2px_0_0_var(--primary)]">
        {editing ? titleEditor() : <Button ref={node => { if (node) tabButtons.current.set(tab.threadId, node); else tabButtons.current.delete(tab.threadId); }}
          size="sm" variant="ghost"
          className={`h-full min-w-0 flex-1 shrink justify-start gap-1.5 overflow-hidden bg-transparent px-2 font-normal hover:bg-transparent ${draft ? "italic" : ""}`}
          aria-current={active ? "page" : undefined} title={title}
          aria-keyshortcuts={`Delete${renamable(tab) ? " F2" : ""} Alt+Shift+ArrowLeft Alt+Shift+ArrowRight`}
          onPointerEnter={() => warmThread(tab.threadId)} onPointerDown={() => warmThread(tab.threadId)} onFocus={() => warmThread(tab.threadId)}
          onClick={() => !active ? select(tab.threadId) : renamable(tab) ? startRename(tab) : undefined}
          onDoubleClick={() => { if (renamable(tab)) startRename(tab); }}
          onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
          onAuxClick={event => { if (event.button === 1) { event.preventDefault(); closeTabAction(tab.threadId); } }}
          onKeyDown={event => onTabKeyDown(event, tab)}>
          {status ? <ThreadStatusMark status={status} /> : draft ? <MessageCirclePlus size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}
          <span className="min-w-0 truncate" dir="auto">{title}</span>
        </Button>}
        <Button size="icon-sm" variant="ghost" className="me-1 size-5 shrink-0 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/task-tab:opacity-100 [@media(hover:none)]:opacity-100"
          aria-label={t`Close tab`} onClick={() => closeTabAction(tab.threadId, true)}>
          <X size={13} aria-hidden="true" />
        </Button>
      </ContextMenuTrigger>
      <ThreadMenu label={t`Actions for ${title}`}
        onOpen={() => select(tab.threadId)}
        onClose={() => closeTabAction(tab.threadId)}
        onCloseOthers={() => closeOthers(tab.threadId)}
        onCloseToRight={() => closeToRight(tab.threadId)}
        {...conversationActions(tab)} />
    </ContextMenu>;
  }

  function pickerRow(tab: TaskTab) {
    const kind = kindLabel(tab);
    const closed = isClosedConversation(tab);
    const status = conversationStatus(tab);
    const busy = busyIds.has(tab.threadId);
    const when = tab.updatedAt ? formatRelativeTime(tab.updatedAt) : "";
    const rowClass = "group/conversation-row flex min-w-0 items-center gap-1 rounded-md has-[[aria-current=page]]:bg-muted";
    const editing = renameTarget?.threadId === tab.threadId && threadPickerOpen;
    const row = <>
      {editing ? titleEditor() : <Button size="sm" variant="ghost"
        className={`h-auto ${inMenu ? "min-h-11" : "min-h-8"} min-w-0 flex-1 justify-start gap-2 bg-transparent py-1.5 text-start hover:bg-muted/60`} aria-current={tab.threadId === taskThreadId ? "page" : undefined}
        disabled={busy} aria-busy={busy || undefined}
        title={closed ? t`Restore and open` : undefined}
        onPointerEnter={() => warmThread(tab.threadId)} onPointerDown={() => warmThread(tab.threadId)} onFocus={() => warmThread(tab.threadId)}
        onClick={() => closed ? void restore(tab) : select(tab.threadId)}>
        {status ? <ThreadStatusMark status={status} /> : null}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 whitespace-normal break-words" title={titleOf(tab)} dir="auto">{titleOf(tab)}</span>
          {!closed && tabIds.includes(tab.threadId) ? <span data-open-tab className="block text-xs text-muted-foreground"><Trans>Open tab</Trans></span> : null}
        </span>
        {inMenu && !closed && tab.unread && status !== "unread" ? <ThreadStatusMark status="unread" /> : null}
        {kind ? <span data-thread-kind={tab.kind} className="ms-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{kind}</span> : null}
        {when ? <time dateTime={tab.updatedAt ?? undefined} data-thread-time className={`${kind ? "" : "ms-auto "}shrink-0 text-xs text-muted-foreground`}>{when}</time> : null}
      </Button>}
    </>;
    const actions = ownConversation(tab)
      ? { ...conversationActions(tab), label: t`Actions for ${titleOf(tab)}`, onRename: () => startRename(tab, true) }
      : null;
    if (inMenu) return <div key={tab.threadId} className={rowClass} data-mobile-conversation={tab.threadId}>
      {row}
      {actions && !editing ? <ThreadMenuButton {...actions} /> : null}
    </div>;
    return <ContextMenu key={tab.threadId}>
      <ContextMenuTrigger render={<div />} className={rowClass}>
      {row}
      {closed && ownConversation(tab) ? <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground opacity-0 group-hover/conversation-row:opacity-100 group-focus-within/conversation-row:opacity-100 [@media(hover:none)]:opacity-100"
        aria-label={t`Restore conversation`} disabled={busy} onClick={() => void restore(tab)}><ArchiveRestore size={14} aria-hidden="true" /></Button> : null}
      {renamable(tab) ? <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground opacity-0 group-hover/conversation-row:opacity-100 group-focus-within/conversation-row:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t`Rename conversation`} onClick={() => startRename(tab, true)}><Pencil size={14} aria-hidden="true" /></Button> : null}
      </ContextMenuTrigger>
      {actions ? <ThreadMenu {...actions} /> : null}
    </ContextMenu>;
  }

  const allConversationsLabel = t`All conversations`;
  const pickerLabel = inMenu
    ? (hiddenReplies ? t`Conversations, new replies` : t`Conversations`)
    : (hiddenReplies ? t`All conversations, new replies` : allConversationsLabel);
  const replyDot = hiddenReplies ? <span aria-hidden="true" data-testid="conversations-new-replies" className="absolute end-1 top-1 size-1.5 rounded-full bg-primary" /> : null;

  const pickerElement = showPicker || minimal || (compact && current) ? <Popover open={threadPickerOpen} onOpenChange={setThreadPickerOpen}>
      <PopoverTrigger render={compact && !minimal
        ? <Button size="sm" variant="ghost" aria-label={`${currentTitle} · ${pickerLabel}`} title={currentTitle} className="relative h-7 min-w-0 flex-1 justify-between gap-1 px-2 font-normal" />
        : minimal || inMenu
          ? <Button size="icon-sm" variant="ghost" aria-label={pickerLabel} title={pickerLabel} className="relative" data-mobile-chat-action={inMenu || undefined} />
          : <Button size="sm" variant="ghost" aria-label={pickerLabel} title={pickerLabel} className="relative h-7 max-w-52 shrink-0 gap-1 px-2 font-normal" />}>
        {inMenu ? <><MessageCircle aria-hidden /><Trans>Conversations</Trans></>
          : compact && !minimal ? <><span className="min-w-0 truncate" dir="auto">{currentTitle}</span><ChevronDown size={15} aria-hidden="true" className="shrink-0" /></>
          : <>{!minimal ? <span className="min-w-0 truncate">{allConversationsLabel}</span> : null}<ChevronDown size={15} aria-hidden="true" className="shrink-0" /></>}
        {replyDot}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[60dvh] w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-1 [&_button]:font-normal">
        <div className="mb-1 border-b border-border pb-1">
          <Button size="sm" variant="ghost" className={`w-full justify-start gap-2 ${inMenu ? "min-h-11" : ""}`} onClick={openDraft}>
            <MessageCirclePlus size={15} aria-hidden="true" /><Trans>New conversation</Trans>
          </Button>
        </div>
        <Button size="sm" variant="ghost" className={`justify-start aria-[current=page]:bg-muted ${inMenu ? "min-h-11" : ""}`} aria-current={!current ? "page" : undefined} onClick={() => select()}><Trans>Main chat</Trans></Button>
        {inMenu ? <>
          <WaitingForYouBadge count={picker.open.filter(row => row.state === "waiting").length} className="mx-2 my-1 self-start" />
          {unread.length ? <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="px-2.5 py-1 text-xs font-medium text-muted-foreground"><Trans>Unread</Trans> · {unread.length}</legend>
            {unread.map(pickerRow)}
          </fieldset> : null}
          {read.length ? <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="px-2.5 py-1 text-xs font-medium text-muted-foreground"><Trans>Read</Trans></legend>
            {read.map(pickerRow)}
          </fieldset> : null}
        </> : picker.open.map(pickerRow)}
        {picker.archived.length ? <div className="mt-1 border-t border-border pt-1">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="px-2.5 py-1 text-xs font-medium text-muted-foreground"><Trans>Archived</Trans></legend>
            {picker.archived.map(pickerRow)}
          </fieldset>
        </div> : null}
        {loadFailed ? <Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}><Trans>Retry</Trans></Button> : null}
        {error && threadPickerOpen ? <p role="alert" className="px-2.5 py-1 text-xs text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover> : null;
  const addElement = !inMenu && !minimal ? <Button ref={addButton} size="icon-sm" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
    aria-label={t`New conversation`} title={t`New conversation`} aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
    onClick={openDraft}><Plus size={16} aria-hidden="true" /></Button> : null;

  return <nav ref={nav} aria-label={t`Conversations`} data-tabs-layout={inMenu ? "menu" : minimal ? "minimal" : compact ? "compact" : "tabs"}
    className={inMenu ? "min-w-0" : "flex min-w-0 flex-1 items-center gap-1 md:ms-1 md:border-s md:border-border md:ps-3"}>
    {!inMenu && !compact ? <>
      <MainTabMenu enabled label={t`Main chat`} onCloseAll={closeOthers}>
        <Button size="sm" variant="ghost" data-main-chat-tab aria-current={!current ? "page" : undefined}
          className="h-7 max-w-28 shrink-0 px-2 font-normal aria-[current=page]:bg-muted"
          onClick={() => select()}>
          <span className="min-w-0 truncate"><Trans>Main chat</Trans></span>
        </Button>
      </MainTabMenu>
      {displayedTabs.length ? <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {displayedTabs.map(tabItem)}
      </div> : null}
    </> : null}
    {pickerElement}{addElement}
    {error && !threadPickerOpen ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {renameError ? <p role="alert" className="max-w-52 text-xs text-destructive">{renameError}</p> : null}
    <DeleteConversationDialog open={Boolean(deleteTarget)} title={deleteTarget ? titleOf(deleteTarget) : ""}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => { const target = deleteTarget; setDeleteTarget(null); if (target) void remove(target, false); }} />
  </nav>;
}

/** The main chat tab's menu controls the side tabs. */
export function MainTabMenu({ enabled, label, onCloseAll, children }: {
  enabled: boolean; label: string; onCloseAll: () => void; children: ReactNode;
}) {
  if (!enabled) return children;
  return <ContextMenu>
    <ContextMenuTrigger render={<span className="contents" />}>{children}</ContextMenuTrigger>
    <ThreadMenu label={label} onCloseOthers={onCloseAll} onCloseToRight={onCloseAll} />
  </ContextMenu>;
}
