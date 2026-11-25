import { useIsMobile } from "@mycellios/ui-web/hooks/use-mobile";
import type { RenderAwaitingReplies } from "../../components/AwaitingReplies";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { MessageQueueConflictCode, MessageQueueState, MessageQueueSteerBlock, QueuedMessage } from "@mycellios/contracts";
import { MESSAGE_QUEUE_CONFLICT_CODES, MESSAGE_QUEUE_REORDER_LIMIT } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mycellios/ui-web";
import { ChevronDown, FileText, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { useBoundSpaceId, useSpaceRpc } from "../../lib/space-rpc";
import { useArtifactImage } from "../../lib/use-artifact-image";

type QueueTarget = { botId: string; taskThreadId?: string } | { groupId: string };

const HOLD_KEY = (messageId: string) => `mycellios:queue-edit:${messageId}`;
function storedHold(messageId: string): string | null {
  try { return localStorage.getItem(HOLD_KEY(messageId)); } catch { return null; }
}
function rememberHold(messageId: string, holdId: string | null) {
  try {
    if (holdId) localStorage.setItem(HOLD_KEY(messageId), holdId);
    else localStorage.removeItem(HOLD_KEY(messageId));
  } catch { /* The hold still works for this page. */ }
}

/** The stable code of a queue conflict the server explained, if this was one. */
export function queueConflictCode(error: unknown): MessageQueueConflictCode | null {
  const data = error && typeof error === "object" && "data" in error ? (error as { data?: unknown }).data : undefined;
  const code = data && typeof data === "object" ? (data as { queueCode?: unknown }).queueCode : undefined;
  return MESSAGE_QUEUE_CONFLICT_CODES.find(candidate => candidate === code) ?? null;
}

/** Moves one id within an order; returns null when nothing changes. */
export function movedOrder(order: readonly string[], id: string, to: number): string[] | null {
  const from = order.indexOf(id);
  if (from < 0 || to < 0 || to >= order.length || to === from) return null;
  const next = order.filter(candidate => candidate !== id);
  next.splice(to, 0, id);
  return next;
}

function Thumbnail({ target, message }: { target: ArtifactTarget; message: QueuedMessage }) {
  const attachment = message.attachment;
  const src = useArtifactImage(target, attachment?.artifactId ?? "", attachment?.kind === "image");
  if (!attachment) return null;
  return src
    ? <img src={src} alt={attachment.name} className="size-8 shrink-0 rounded-md object-cover" data-testid="queued-message-thumbnail" />
    : <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" title={attachment.name}>
      <FileText aria-hidden="true" size={14} />
      <span className="sr-only">{attachment.name}</span>
    </span>;
}

/**
 * The messages that wait in this conversation, with why they wait and what the person can do
 * with each: Steer now, Send now, Edit, Delete, reorder and Move to a new conversation. Queued
 * messages stay in the transcript too; this panel only manages their turn.
 */
export function QueuePanel({ target, artifactTarget, running, sending, onUseText, onMoved, renderAwaitingReplies }: {
  target: QueueTarget;
  artifactTarget: ArtifactTarget;
  running: boolean;
  sending: boolean;
  /** Puts text back in the composer (an edit that could no longer be saved). */
  onUseText?: (text: string) => void;
  /** A message moved to a new conversation: open it as a background tab. */
  onMoved?: (threadId: string, title: string) => void;
  renderAwaitingReplies?: RenderAwaitingReplies;
}) {
  const { t } = useLingui();
  const mobile = useIsMobile();
  const sharedSheet = mobile && Boolean(renderAwaitingReplies);
  const rpc = useSpaceRpc();
  const spaceId = useBoundSpaceId();
  const headingId = useId();
  const targetKey = JSON.stringify(target);
  const key = JSON.stringify([spaceId, targetKey]);
  const [saved, setSaved] = useState<{ key: string; state: MessageQueueState } | null>(null);
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ messageId: string; holdId: string; text: string } | null>(null);
  const [lostEdit, setLostEdit] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const draftTimer = useRef<number | undefined>(undefined);
  const pendingFocus = useRef<string | null>(null);

  const state = saved?.key === key ? saved.state : null;
  const rows = state?.messages ?? [];
  const shown = order ? order.flatMap(id => rows.find(row => row.messageId === id) ?? []) : rows;

  const load = useCallback(async () => {
    const next = await rpc.threads.queueState(JSON.parse(targetKey));
    setSaved({ key, state: next });
    setOrder(null);
    return next;
  }, [rpc, key, targetKey]);

  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending || sending || document.hidden) return;
      pending = true;
      // Showing the queue never resends a message or replaces its acceptance receipt.
      try { const next = await rpc.threads.queueState(JSON.parse(targetKey)); if (alive) { setSaved({ key, state: next }); setOrder(null); } }
      catch { /* Keep what is shown; the next refresh tries again. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = running || rows.length ? window.setInterval(() => void refresh(), 3000) : undefined;
    return () => { alive = false; window.clearInterval(timer); };
  }, [rpc, key, targetKey, sending, running, rows.length > 0]);

  // Resume an edit this device left open (a reload): the server kept the hold and its draft.
  useEffect(() => {
    if (editing) return;
    const mine = rows.find(row => row.editing && row.editing.holdId === storedHold(row.messageId));
    if (mine?.editing) setEditing({ messageId: mine.messageId, holdId: mine.editing.holdId, text: mine.editing.draft ?? mine.text });
  }, [rows, editing]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (id) { pendingFocus.current = null; rowRefs.current.get(id)?.focus(); }
  });

  const steerBlockText = (block: MessageQueueSteerBlock | undefined) =>
    block === "routine" ? t`A routine is running now.`
      : block === "own_work" ? t`The Mico is working on its own task here.`
      : block === "waiting" ? t`The current turn is waiting for your answer.`
      : t`Nothing is running here now.`;
  const conflictText = (code: MessageQueueConflictCode) => {
    switch (code) {
      case "gone": return t`This message already started or was removed.`;
      case "held": return t`This message is being edited somewhere else.`;
      case "not_held": return t`This edit was closed somewhere else.`;
      case "stale": return t`The queue changed meanwhile. It was refreshed; try again.`;
      case "empty": return t`A queued message needs text or a file.`;
      case "not_alone": return t`Only a message you sent to this Mico alone can move to a new conversation.`;
      default: {
        const reason = steerBlockText(code);
        return t`Not steered: ${reason}`;
      }
    }
  };
  const fail = (error: unknown) => {
    const code = queueConflictCode(error);
    toast.error(code ? conflictText(code) : t`Could not update the queue. Try again.`);
    void load().catch(() => undefined);
    return code;
  };
  const act = async (messageId: string, action: () => Promise<unknown>, done?: string) => {
    setBusyId(messageId);
    try {
      await action();
      if (done) setAnnouncement(done);
      await load().catch(() => undefined);
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = async (row: QueuedMessage, takeOver = false) => {
    const holdId = storedHold(row.messageId) ?? crypto.randomUUID();
    setBusyId(row.messageId);
    try {
      const held = await rpc.threads.queueEdit({ ...target, messageId: row.messageId, holdId, ...(takeOver ? { takeOver } : {}) });
      rememberHold(row.messageId, holdId);
      setEditing({ messageId: row.messageId, holdId, text: held.draft ?? held.text });
      await load().catch(() => undefined);
    } catch (error) {
      fail(error);
    } finally {
      setBusyId(null);
    }
  };
  const updateEdit = (text: string) => {
    if (!editing) return;
    const session = { ...editing, text };
    setEditing(session);
    window.clearTimeout(draftTimer.current);
    // The draft is kept on the server, so a reload or another device can finish the edit.
    draftTimer.current = window.setTimeout(() => {
      void rpc.threads.queueEditDraft({ ...target, messageId: session.messageId, holdId: session.holdId, draft: text }).catch(() => undefined);
    }, 800);
  };
  const closeEdit = (messageId: string) => {
    window.clearTimeout(draftTimer.current);
    rememberHold(messageId, null);
    setEditing(null);
    pendingFocus.current = messageId;
  };
  const saveEdit = async () => {
    if (!editing) return;
    const session = editing;
    setBusyId(session.messageId);
    try {
      await rpc.threads.queueEditSave({ ...target, messageId: session.messageId, holdId: session.holdId, text: session.text });
      closeEdit(session.messageId);
      setAnnouncement(t`Queued message saved.`);
      await load().catch(() => undefined);
    } catch (error) {
      const code = queueConflictCode(error);
      if (code === "gone" || code === "not_held") {
        // The message started, was removed or the edit moved elsewhere: keep the text.
        closeEdit(session.messageId);
        setLostEdit(session.text);
        void load().catch(() => undefined);
      } else fail(error);
    } finally {
      setBusyId(null);
    }
  };
  const cancelEdit = async () => {
    if (!editing) return;
    const session = editing;
    closeEdit(session.messageId);
    try {
      const result = await rpc.threads.queueEditCancel({ ...target, messageId: session.messageId, holdId: session.holdId });
      if (result.gone) toast.message(t`This message already started or was removed.`);
    } catch (error) {
      fail(error);
    }
    await load().catch(() => undefined);
  };

  const remove = async (row: QueuedMessage, force = false) => {
    if (row.editing && !force && row.editing.holdId !== editing?.holdId) {
      setConfirmDelete(row.messageId);
      return;
    }
    if (editing?.messageId === row.messageId) closeEdit(row.messageId);
    await act(row.messageId, () => rpc.threads.queueDelete({ ...target, messageId: row.messageId, ...(force ? { force } : {}) }), t`Queued message deleted.`);
  };

  const reorder = async (id: string, to: number) => {
    const current = shown.map(row => row.messageId).slice(0, MESSAGE_QUEUE_REORDER_LIMIT);
    const next = movedOrder(current, id, to);
    if (!next) return;
    setOrder(next);
    pendingFocus.current = id;
    try {
      await rpc.threads.queueReorder({ ...target, expected: current, order: next });
      const position = to + 1, total = next.length;
      setAnnouncement(t`Moved to position ${position} of ${total}.`);
      await load().catch(() => undefined);
      pendingFocus.current = id;
    } catch (error) {
      setOrder(null);
      fail(error);
    }
  };
  const rowKeys = (event: KeyboardEvent<HTMLLIElement>, row: QueuedMessage, index: number) => {
    if (event.target !== event.currentTarget || editing) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      void reorder(row.messageId, index + (event.key === "ArrowUp" ? -1 : 1));
    } else if (event.key === "Delete") {
      event.preventDefault();
      void remove(row);
    }
  };

  const move = async (row: QueuedMessage) => {
    setBusyId(row.messageId);
    try {
      const moved = await rpc.threads.queueMove({ ...target, messageId: row.messageId });
      onMoved?.(moved.threadId, moved.title);
      const title = moved.title;
      setAnnouncement(t`Moved to a new conversation: ${title}`);
      toast.success(t`Moved to a new conversation: ${title}`);
      await load().catch(() => undefined);
    } catch (error) {
      fail(error);
    } finally {
      setBusyId(null);
    }
  };

  const count = state?.slots?.running ?? 0;
  const waitText = state?.waiting === "slot" && state.slots
    ? <Plural value={count} one="Waiting for a free slot: # conversation of this Mico is working." other="Waiting for a free slot: # conversations of this Mico are working." />
    : state?.waiting === "restart" ? t`Waiting while the computer or the server restarts.`
    : state?.waiting === "usage" ? t`Paused: the last turn reached a usage or credit limit. Send one now when you are ready.`
    : state?.waiting === "signin" ? t`Paused: the last turn needs a sign-in or a working key. Fix it, then send one now.`
    : state?.waiting === "held" ? t`Paused while a message is being edited.`
    : t`They go one at a time, after the current turn.`;
  const steer = state?.steer ?? { available: false };
  const deleteRow = rows.find(row => row.messageId === confirmDelete);

  const queuedMessages = rows.length ? <section aria-labelledby={headingId} className={sharedSheet ? "min-w-0 rounded-xl border border-border bg-muted/30 text-xs" : "mx-3 mb-2 min-w-0 rounded-xl border border-border bg-muted/30 text-xs"} data-testid="message-queue">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 px-2 py-1">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={`${headingId}-list`}
        className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-1 text-start focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronDown aria-hidden="true" size={14} className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} />
        <h3 id={headingId} className="shrink-0 font-medium text-foreground"><Trans>Waiting to send</Trans> · {rows.length}</h3>
      </button>
      <p className="line-clamp-2 w-full min-w-0 pb-1 ps-6 text-muted-foreground sm:line-clamp-1 sm:w-auto sm:flex-1 sm:pb-0 sm:ps-0" data-testid="message-queue-reason" title={typeof waitText === "string" ? waitText : undefined}>{waitText}</p>
    </div>
    {open ? <ol id={`${headingId}-list`} aria-label={t`Messages waiting to send`} className={sharedSheet ? "space-y-1 px-2 pb-2" : "max-h-56 space-y-1 overflow-y-auto px-2 pb-2"}>
      {shown.map((row, index) => {
        const mineEditing = editing?.messageId === row.messageId;
        const elsewhere = Boolean(row.editing && !mineEditing && row.editing.holdId !== storedHold(row.messageId));
        const busy = busyId === row.messageId || sending;
        const position = index + 1, total = shown.length;
        const preview = row.text || row.attachment?.name || t`Attachment`;
        const files = row.attachmentCount;
        // A focused row moves with the arrow keys, so the row itself takes focus.
        return <li key={row.messageId} ref={element => { if (element) rowRefs.current.set(row.messageId, element); else rowRefs.current.delete(row.messageId); }}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard reordering of queued messages
          tabIndex={0} draggable={!editing} data-testid="queued-message"
          aria-label={t`Queued message ${position} of ${total}: ${preview}`}
          aria-describedby={`${headingId}-keys`}
          onKeyDown={event => rowKeys(event, row, index)}
          onDragStart={event => { setDragging(row.messageId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", row.messageId); }}
          onDragEnd={() => setDragging(null)}
          onDragOver={event => { if (dragging && dragging !== row.messageId) event.preventDefault(); }}
          onDrop={event => { event.preventDefault(); if (dragging) void reorder(dragging, index); setDragging(null); }}
          className={`flex min-w-0 flex-wrap items-start gap-2 rounded-lg bg-background px-1.5 py-1.5 focus-visible:outline-2 focus-visible:outline-ring ${dragging === row.messageId ? "opacity-50" : ""}`}>
          <GripVertical aria-hidden="true" size={14} className="mt-2 shrink-0 cursor-grab text-muted-foreground" />
          <Thumbnail target={artifactTarget} message={row} />
          <div className="min-w-40 flex-1">
            {mineEditing ? <div className="space-y-1">
              {/* biome-ignore lint/a11y/noAutofocus: Edit opens this field for typing at once */}
              <textarea value={editing.text} autoFocus aria-label={t`Edit queued message`} rows={3} maxLength={64000}
                onChange={event => updateEdit(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Escape") { event.preventDefault(); void cancelEdit(); }
                  else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveEdit(); }
                }}
                className="w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-ring" />
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" onClick={() => void saveEdit()} disabled={busy}><Trans>Save</Trans></Button>
                <Button size="sm" variant="ghost" onClick={() => void cancelEdit()} disabled={busy}><Trans>Cancel</Trans></Button>
                <span className="text-muted-foreground"><Trans>The queue waits until you save or cancel.</Trans></span>
              </div>
            </div> : <>
              <p className="line-clamp-2 break-words text-[13px] text-foreground" title={row.text}>
                {preview}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                {files > 1 ? <span><Plural value={files} one="# file" other="# files" /></span> : null}
                {row.editing ? <span className="rounded bg-muted px-1.5 py-0.5" data-testid="queued-message-editing">
                  {elsewhere ? t`Being edited somewhere else` : t`Editing`}
                </span> : null}
                {!steer.available && running && !row.editing ? <span className="rounded bg-muted px-1.5 py-0.5" title={steerBlockText(steer.blocked)} data-testid="queued-message-not-steered">
                  <Trans>Not steered</Trans><span className="sr-only">: {steerBlockText(steer.blocked)}</span>
                </span> : null}
              </div>
            </>}
          </div>
          {mineEditing ? null : <div className="ms-auto flex shrink-0 items-center gap-0.5">
            {row.editing ? null : steer.available
              ? <Button size="sm" variant="ghost" disabled={busy} title={t`Add it to the turn that is running now`}
                onClick={() => void act(row.messageId, () => rpc.threads.queueSteer({ ...target, messageId: row.messageId }), t`Added to the current turn.`)}>
                <Trans>Steer now</Trans>
              </Button>
              : null}
            {row.editing ? null : <Button size="sm" variant="ghost" disabled={busy} title={t`Stop the current turn and send this message next`}
              onClick={() => void act(row.messageId, () => rpc.threads.queueSendNow({ ...target, messageId: row.messageId }), t`Sending this message now.`)}>
              <Trans>Send now</Trans>
            </Button>}
            {row.canMove && !row.editing ? <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={t`Move to a new conversation`} title={t`Move to a new conversation`}
              onClick={() => void move(row)}>
              <Plus aria-hidden="true" />
            </Button> : null}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" />} disabled={busy} aria-label={t`More actions for this message`}>
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {elsewhere
                  ? <DropdownMenuItem onClick={() => void startEdit(row, true)}><Trans>Edit here instead</Trans></DropdownMenuItem>
                  : <DropdownMenuItem onClick={() => void startEdit(row)}><Trans>Edit</Trans></DropdownMenuItem>}
                <DropdownMenuItem disabled={index === 0 || Boolean(editing)} onClick={() => void reorder(row.messageId, index - 1)}><Trans>Move up</Trans></DropdownMenuItem>
                <DropdownMenuItem disabled={index === shown.length - 1 || Boolean(editing)} onClick={() => void reorder(row.messageId, index + 1)}><Trans>Move down</Trans></DropdownMenuItem>
                {row.canMove && !row.editing ? <DropdownMenuItem onClick={() => void move(row)}><Trans>Move to a new conversation</Trans></DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void remove(row)}><Trans>Delete</Trans></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}
        </li>;
      })}
    </ol> : null}
    <p id={`${headingId}-keys`} className="sr-only"><Trans>Use the up and down arrow keys to move a focused message in the queue.</Trans></p>
  </section> : null;
  const queueContents = <>
    {queuedMessages}
    <span className="sr-only" role="status">{announcement}</span>
    <AlertDialog open={Boolean(deleteRow)} onOpenChange={value => { if (!value) setConfirmDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle><Trans>Delete queued message?</Trans></AlertDialogTitle>
          <AlertDialogDescription><Trans>It is being edited somewhere else. Deleting it also discards that edit.</Trans></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel><Trans>Keep</Trans></AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { const row = deleteRow; setConfirmDelete(null); if (row) void remove(row, true); }}>
            <Trans>Delete</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={lostEdit !== null} onOpenChange={value => { if (!value) setLostEdit(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle><Trans>Edit not saved</Trans></AlertDialogTitle>
          <AlertDialogDescription><Trans>The message started, was removed or was edited somewhere else before you saved. Your text is kept below.</Trans></AlertDialogDescription>
        </AlertDialogHeader>
        <textarea readOnly value={lostEdit ?? ""} rows={4} aria-label={t`Your edited text`} className="w-full rounded-md border border-input bg-muted px-2 py-1 text-[13px]" />
        <AlertDialogFooter>
          <AlertDialogCancel><Trans>Close</Trans></AlertDialogCancel>
          {onUseText ? <AlertDialogAction onClick={() => { const text = lostEdit ?? ""; setLostEdit(null); onUseText(text); }}>
            <Trans>Put it in the message box</Trans>
          </AlertDialogAction> : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
  const next = rows[0];
  const replyQueue = sharedSheet && next ? {
    preview: next.text || next.attachment?.name || t`Attachment`,
    messages: queueContents,
  } : undefined;

  return <>
    {renderAwaitingReplies?.(replyQueue)}
    {replyQueue ? null : queueContents}
  </>;
}
