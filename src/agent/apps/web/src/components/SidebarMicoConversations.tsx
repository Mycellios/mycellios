import { useLingui } from "@lingui/react/macro";
import type { MicoConversationSummary } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { MessageCircle } from "lucide-react";
import { formatRelativeTime } from "../lib/relative-time";
import { sidebarConversationRows } from "../lib/sidebar-conversations";
import { type ConversationRow, conversationStatus } from "../lib/thread-tabs";
import { ThreadStatusMark } from "./ThreadStatusMark";

function ConversationLine({ row, active, compact = false, onOpen }: {
  row: ConversationRow; active: boolean; compact?: boolean; onOpen: (threadId: string) => void;
}) {
  const { t } = useLingui();
  const status = conversationStatus(row);
  const title = row.title || t`New conversation`;
  return <Button size="sm" variant="ghost" data-sidebar-conversation={row.threadId} aria-current={active ? "page" : undefined}
    className={`h-auto w-full min-w-0 justify-start gap-2 rounded-lg py-1 text-start font-normal aria-[current=page]:bg-sidebar-accent ${compact ? "min-h-7 px-1.5" : "min-h-8 px-2"} ${status === "unread" ? "font-medium text-foreground" : "text-foreground/80"}`}
    onClick={() => onOpen(row.threadId)}>
    {status ? <ThreadStatusMark status={status} /> : <MessageCircle size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
    <span className="min-w-0 flex-1 truncate text-[13px]" dir="auto" title={title}>{title}</span>
    {row.updatedAt ? <time dateTime={row.updatedAt} className="shrink-0 text-[11px] text-faint-foreground">{formatRelativeTime(row.updatedAt)}</time> : null}
  </Button>;
}

/**
 * The conversations under an expanded Mico row: every one that needs a look, then the most
 * recent others, with "Show N more" / "Show less". A click opens the conversation.
 */
export function SidebarMicoConversations({ rows, all, onToggleAll, activeThreadId, onOpen, loading = false }: {
  rows: readonly ConversationRow[];
  all: boolean;
  onToggleAll: () => void;
  activeThreadId?: string;
  onOpen: (threadId: string) => void;
  loading?: boolean;
}) {
  const { t } = useLingui();
  const { needLook, recent, hidden, total } = sidebarConversationRows(rows, all);
  const shown = [...needLook, ...recent];
  return <fieldset data-testid="sidebar-mico-conversations" aria-label={t`Conversations`}
    className="m-0 ms-[34px] flex min-w-0 flex-col gap-px border-0 border-s border-sidebar-border p-0 ps-1.5 pb-1">
    {shown.map(row => <ConversationLine key={row.threadId} row={row} active={row.threadId === activeThreadId} onOpen={onOpen} />)}
    {!total ? <p className="px-2 py-1 text-xs text-muted-foreground">{loading ? t`Loading…` : t`No conversations yet`}</p> : null}
    {hidden > 0 || all && total > needLook.length + 3 ? <Button size="xs" variant="ghost" className="self-start px-2 font-normal text-muted-foreground"
      aria-expanded={all} onClick={onToggleAll}>
      {all ? t`Show less` : t`Show ${hidden} more`}
    </Button> : null}
  </fieldset>;
}

/**
 * The conversation part of a Mico's hover card: only what is already loaded (a hover never
 * reads anything new and never marks anything read), else the roster's summary.
 */
export function HoverConversations({ rows, summary, onOpen }: {
  rows: readonly ConversationRow[];
  summary?: MicoConversationSummary | null;
  onOpen: (threadId: string) => void;
}) {
  const { t } = useLingui();
  const { needLook, recent, total } = sidebarConversationRows(rows);
  const shown = [...needLook, ...recent].slice(0, 6);
  if (!total && !summary?.open) return null;
  const open = total || summary?.open || 0;
  const count = summary?.waiting ?? 0;
  const unread = summary?.unread ?? 0;
  return <div data-testid="hover-conversations" className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1.5">
    <p className="text-[11px] font-medium text-muted-foreground">{t`Conversations: ${open}`}</p>
    {shown.length ? shown.map(row => <ConversationLine key={row.threadId} row={row} active={false} compact onOpen={onOpen} />)
      : <p className="text-xs text-muted-foreground">
        {count ? t`Waiting for you: ${count}` : unread ? t`New replies in conversations` : t`Expand the row to see them`}
      </p>}
  </div>;
}
