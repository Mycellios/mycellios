import { useLingui } from "@lingui/react/macro";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@mycellios/ui-web";
import { ChevronDown, Columns2, Hourglass, MessageCircle, MessageCirclePlus, MessageSquareText, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { BesideConversations } from "../lib/conversation-pane";
import { formatRelativeTime } from "../lib/relative-time";
import { type ConversationRow, conversationStatus, NEW_CONVERSATION_TAB, pickerConversations } from "../lib/thread-tabs";
import { ThreadStatusMark } from "./ThreadStatusMark";

/** Open conversations that wait for the person: a question, an approval or a takeover. */
export function waitingConversations(rows: readonly ConversationRow[]): number {
  return pickerConversations(rows).open.filter(row => row.state === "waiting").length;
}

/** The badge that counts the conversations waiting for the person; nothing when none waits. */
export function WaitingForYouBadge({ count, className = "", compact = false }: { count: number; className?: string; compact?: boolean }) {
  const { t } = useLingui();
  if (count < 1) return null;
  const label = t`Waiting for you: ${count}`;
  // Beside tabs leave little room: the number stays, its words become the label.
  return <span data-testid="conversations-waiting" title={compact ? label : undefined}
    className={`inline-flex shrink-0 items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning ${className}`}>
    {compact ? <><span aria-hidden="true">{count}</span><span className="sr-only">{label}</span></> : label}
  </span>;
}

/**
 * The side panel's Conversations pane: the Mico's open conversations (and the draft) with
 * their state and time. A row opens its conversation in the chat; its toggle opens it beside
 * the chat instead, as a tab of this pane, whose menu opens it in the chat or closes it.
 */
export function ConversationsPane({
  botName, rows, draftOpen, currentId, beside, canBeside, onOpen, onNewConversation, onShow, onToggleBeside,
  onCloseBeside, onClose, renderConversation,
}: {
  botName: string;
  rows: readonly ConversationRow[];
  /** The draft tab is open; its row leads back to it. */
  draftOpen: boolean;
  /** What the chat shows: a thread id, NEW_CONVERSATION_TAB, or nothing for the main chat. */
  currentId?: string;
  beside: BesideConversations;
  /** Phones have no room beside the chat. */
  canBeside: boolean;
  onOpen: (target: string) => void;
  onNewConversation: () => void;
  /** Shows one conversation beside the chat, or the list (null). */
  onShow: (id: string | null) => void;
  onToggleBeside: (id: string) => void;
  onCloseBeside: (id: string) => void;
  onClose: () => void;
  renderConversation: (row: ConversationRow) => ReactNode;
}) {
  const { t } = useLingui();
  const open = pickerConversations(rows).open;
  const waiting = waitingConversations(rows);
  const titleOf = (row: Pick<ConversationRow, "title">) => row.title || t`New conversation`;
  const besideRows = beside.ids.flatMap(id => {
    const row = rows.find(item => item.threadId === id);
    return row ? [row] : [];
  });
  const shown = beside.active ? besideRows.find(row => row.threadId === beside.active) : undefined;
  const tabList = useRef<HTMLDivElement>(null);
  // The shown tab stays in sight when the tabs need more room than the panel has.
  useEffect(() => {
    tabList.current?.querySelector<HTMLElement>(`[data-pane-tab="${shown?.threadId ?? "list"}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [shown?.threadId, besideRows.length]);
  const empty = !open.length && !draftOpen;

  return <section id="conversations-pane" data-testid="conversations-pane" aria-label={t`Conversations of ${botName}`}
    className="flex h-full min-h-0 w-full flex-col">
    <div className="flex h-[51px] shrink-0 items-center gap-1 border-b border-border px-2">
      <div ref={tabList} role="tablist" aria-label={t`Conversations`} className="rk-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        <Button role="tab" size="sm" variant="ghost" aria-selected={!shown} data-pane-tab="list"
          className="h-8 shrink-0 gap-1.5 px-2 font-normal aria-selected:bg-muted" onClick={() => onShow(null)}>
          <MessageSquareText size={15} aria-hidden="true" />
          {besideRows.length ? <span className="sr-only">{t`Conversations`}</span> : t`Conversations`}
          <WaitingForYouBadge count={waiting} compact={besideRows.length > 0} />
        </Button>
        {besideRows.map(row => {
          const status = conversationStatus(row);
          const selected = shown?.threadId === row.threadId;
          return <div key={row.threadId} data-pane-tab={row.threadId}
            className="group/pane-tab flex h-8 w-32 min-w-24 max-w-40 shrink-0 items-center rounded-md data-[selected]:bg-muted" data-selected={selected ? "" : undefined}>
            <Button role="tab" size="sm" variant="ghost" aria-selected={selected} title={titleOf(row)}
              className="h-full min-w-0 flex-1 justify-start gap-1.5 bg-transparent px-2 font-normal hover:bg-transparent"
              onClick={() => onShow(row.threadId)}>
              {status ? <ThreadStatusMark status={status} /> : <MessageCircle size={14} aria-hidden="true" />}
              <span className="min-w-0 truncate" dir="auto">{titleOf(row)}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={t`Actions for ${titleOf(row)}`}
                className="me-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronDown size={13} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onOpen(row.threadId)}><MessageCircle size={15} aria-hidden="true" />{t`Open in the chat`}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCloseBeside(row.threadId)}><X size={15} aria-hidden="true" />{t`Close`}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>;
        })}
      </div>
      <Button variant="ghost" size="icon-sm" className="app-no-drag shrink-0" aria-label={t`Close conversations`} onClick={onClose}>
        <X size={15} aria-hidden="true" />
      </Button>
    </div>
    {shown ? <div role="tabpanel" className="flex min-h-0 flex-1 flex-col" data-testid="beside-conversation">
      {renderConversation(shown)}
    </div> : <div role="tabpanel" className="rk-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {empty ? <div data-testid="conversations-empty" className="m-auto flex max-w-64 flex-col items-center gap-3 py-10 text-center">
        <MessageSquareText size={22} className="text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t`No conversations yet`}</p>
        <Button size="sm" variant="secondary" onClick={onNewConversation}>
          <MessageCirclePlus size={15} aria-hidden="true" />{t`New conversation`}
        </Button>
      </div> : <>
        <Button size="sm" variant="ghost" className="mb-1 justify-start gap-2 font-normal" onClick={onNewConversation}>
          <MessageCirclePlus size={15} aria-hidden="true" />{t`New conversation`}
        </Button>
        {draftOpen ? <Button size="sm" variant="ghost" data-conversation-row={NEW_CONVERSATION_TAB}
          aria-current={currentId === NEW_CONVERSATION_TAB ? "page" : undefined}
          className="h-auto min-h-9 justify-start gap-2 py-1.5 font-normal italic aria-[current=page]:bg-muted"
          onClick={() => onOpen(NEW_CONVERSATION_TAB)}>
          <MessageCirclePlus size={14} aria-hidden="true" />
          <span className="min-w-0 truncate">{t`New conversation`}</span>
          <span className="ms-auto shrink-0 text-xs not-italic text-muted-foreground">{t`Draft`}</span>
        </Button> : null}
        {open.map(row => {
          const status = conversationStatus(row);
          const inChat = currentId === row.threadId;
          const isBeside = beside.ids.includes(row.threadId);
          const when = row.updatedAt ? formatRelativeTime(row.updatedAt) : "";
          return <div key={row.threadId} data-conversation-row={row.threadId}
            className="group/conversation flex min-w-0 items-center gap-0.5 rounded-md has-[[aria-current=page]]:bg-muted">
            <Button size="sm" variant="ghost" aria-current={inChat ? "page" : undefined}
              className="h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 bg-transparent py-1.5 text-start font-normal hover:bg-muted/60"
              onClick={() => onOpen(row.threadId)}>
              {status ? <ThreadStatusMark status={status} /> : <MessageCircle size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="line-clamp-2 min-w-0 whitespace-normal break-words" dir="auto">{titleOf(row)}</span>
              {row.openWaits ? <span data-open-waits={row.openWaits} title={t`Waiting for an event`} className="shrink-0 text-muted-foreground">
                <Hourglass size={13} aria-hidden="true" /><span className="sr-only">{t`Waiting for an event`}</span>
              </span> : null}
              {when ? <time dateTime={row.updatedAt} data-thread-time className="ms-auto shrink-0 text-xs text-muted-foreground">{when}</time> : null}
            </Button>
            {canBeside ? <Button size="icon-sm" variant="ghost" aria-pressed={isBeside} disabled={inChat}
              aria-label={isBeside ? t`Close beside the chat` : t`Open beside the chat`}
              title={inChat ? t`Already open in the chat` : isBeside ? t`Close beside the chat` : t`Open beside the chat`}
              className="shrink-0 text-muted-foreground opacity-0 group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100 aria-pressed:text-foreground aria-pressed:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={() => onToggleBeside(row.threadId)}>
              <Columns2 size={14} aria-hidden="true" />
            </Button> : null}
          </div>;
        })}
      </>}
    </div>}
  </section>;
}
