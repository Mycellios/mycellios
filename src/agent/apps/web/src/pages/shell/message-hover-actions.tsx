import { useGeneralPreferences } from "../../lib/general-preferences";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageReaction, ThreadMessage } from "@mycellios/contracts";
import { canReactToThreadMessage, MESSAGE_REACTIONS } from "@mycellios/contracts";
import { canMarkMessageUnread } from "@mycellios/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@mycellios/ui-web";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@mycellios/ui-web/components/ui/sheet";
import { Brain, Repeat2, Copy, MessageSquareDot, MoreHorizontal, Pin, PinOff, Reply, Smile, Split, Trash2, Users, X } from "lucide-react";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MessagePinsContext } from "../../components/PinnedMessages";
import { useMemoryRecall } from "../../components/memory/MemoryRecall";
import { SEND_TO_GROUP_MENU_LIMIT, SendToGroupContext } from "../../components/SendToGroup";
import { MessageHoverMetadata } from "../../components/MessageHoverMetadata";
import { copyableMessageText } from "../../lib/message-text";

type MessageActions = {
  message: ThreadMessage;
  onReply: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onAddRoutine?: (name: string, prompt: string) => void;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  onDelete?: (message: ThreadMessage) => void;
};

function copyMessage(message: ThreadMessage) {
  const text = copyableMessageText(message);
  if (text && navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
}

export function MessageTouchActions({
  message, onReply, onMarkUnread, markedUnread, onReact, onAddRoutine, onDelete, children,
}: MessageActions & { children: ReactNode }) {
  const { t } = useLingui();
  const sendToGroup = useContext(SendToGroupContext);
  const pins=useContext(MessagePinsContext);
  const pinnable=Boolean(pins && !message.id.includes(":") && (message.role==="user"||message.role==="bot"));
  const pinned=pins?.ids.has(message.id)??false;
  const [open, setOpen] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const cancelHold = () => {
    window.clearTimeout(press.current?.timer);
    press.current = null;
  };
  useEffect(() => () => window.clearTimeout(press.current?.timer), []);
  const canHold = (target: EventTarget | null) =>
    target instanceof Element &&
    !target.closest("a, button, input, textarea, select, summary, [role=button], [contenteditable=true]") &&
    !window.getSelection()?.toString();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        className="[&_[data-quote-message-id]]:[-webkit-touch-callout:none]"
        onPointerDown={(event) => {
          if (event.pointerType !== "touch" || !event.isPrimary || !canHold(event.target)) return;
          cancelHold();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(() => {
              cancelHold();
              if (!window.getSelection()?.toString()) setOpen(true);
            }, 500),
          };
        }}
        onPointerMove={(event) => {
          if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10)
            cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => {
          if (!canHold(event.target)) return;
          event.preventDefault();
          cancelHold();
          setOpen(true);
        }}
      >
        {children}
        <SheetTrigger className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:bottom-0 focus-visible:z-20 focus-visible:rounded-md focus-visible:bg-popover focus-visible:p-2 focus-visible:text-sm">
          {t`Message actions`}
        </SheetTrigger>
      </div>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[80dvh] gap-2 overflow-y-auto overscroll-contain rounded-t-2xl px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] motion-reduce:transition-none">
        <div className="flex min-h-12 items-center justify-between gap-2">
          <SheetTitle>{t`Message actions`}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon" className="size-12" aria-label={t`Close`} />}><X /></SheetClose>
        </div>
        {canReactToThreadMessage(message) ? (
          <div role="group" aria-label={t`Reactions`} className="flex flex-wrap gap-1">
            {MESSAGE_REACTIONS.map((emoji) => (
              <SheetClose key={emoji} aria-label={emoji} className="grid size-11 place-items-center rounded-lg text-2xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void onReact(message, emoji)}>
                {emoji}
              </SheetClose>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col [&_button]:min-h-12 [&_button]:justify-start">
          {pinnable?<SheetClose render={<Button variant="ghost" disabled={pins!.busy} />} onClick={()=>pins!.set(message.id,!pinned)}>{pinned?<PinOff/>:<Pin/>}{pinned?t`Unpin message`:t`Pin message`}</SheetClose>:null}
          <SheetClose render={<Button variant="ghost" />} onClick={() => onReply(message)}><Reply />{t`Reply`}</SheetClose>
          {onAddRoutine && message.role === "user" && copyableMessageText(message) ? <SheetClose render={<Button variant="ghost" />} onClick={() => onAddRoutine(copyableMessageText(message).slice(0, 80), copyableMessageText(message))}><Repeat2 />{t`Repeat automatically`}</SheetClose> : null}
          {copyableMessageText(message) ? <SheetClose render={<Button variant="ghost" />} onClick={() => copyMessage(message)}><Copy />{t`Copy`}</SheetClose> : null}
          {sendToGroup && copyableMessageText(message) ? sendToGroup.groups.slice(0, SEND_TO_GROUP_MENU_LIMIT).map((group) => {
            const groupName = group.name;
            return <SheetClose key={group.id} render={<Button variant="ghost" />} onClick={() => sendToGroup.send(group.id, copyableMessageText(message))}><Users />{t`Send to ${groupName}`}</SheetClose>;
          }) : null}
          {canMarkMessageUnread(message) && !markedUnread ? (
            <SheetClose render={<Button variant="ghost" />} onClick={() => onMarkUnread(message)}><MessageSquareDot />{t`Mark as unread`}</SheetClose>
          ) : null}
          {onDelete ? <SheetClose render={<Button variant="ghost" className="text-destructive" />} onClick={() => onDelete(message)}>
            <Trash2 />{t`Delete`}
          </SheetClose> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MessageHoverActions({
  message,
  side,
  onReply,
  onMarkUnread,
  markedUnread = false,
  onReact,
  onAddRoutine,
  onDelete,
  onBranch,
  branchDisabled = false,
}: MessageActions & {
  side: "start" | "end";
  /** Offered on the last Mico message of a finished turn, on wide screens only. */
  onBranch?: (message: ThreadMessage) => void;
  /** The conversation works on a turn: branching waits until it ends. */
  branchDisabled?: boolean;
}) {
  const { t, i18n } = useLingui();
  const sendToGroup = useContext(SendToGroupContext);
  const pins=useContext(MessagePinsContext);
  const pinnable=Boolean(pins && !message.id.includes(":") && (message.role==="user"||message.role==="bot"));
  const pinned=pins?.ids.has(message.id)??false;
  const { compactMessageActions } = useGeneralPreferences();
  const memoryRecall = useMemoryRecall();
  const recallable = Boolean(memoryRecall && message.role === "bot" && !message.id.includes(":") && !message.progress);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);

  // Streaming progress bubbles keep hover free for selection / stop clicks.
  if (message.id.startsWith("progress:")) return null;


  const iconButtonClass =
    "grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground [@media(hover:hover)_and_(pointer:fine)]:h-7 [@media(hover:hover)_and_(pointer:fine)]:w-7";

  return (
    <MessageHoverMetadata pinned={moreOpen || reactionsOpen} side={side}>
      {!compactMessageActions && <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", { hour: "2-digit", minute: "2-digit" })}</time>}
      <div data-testid="message-hover-actions" className="flex items-center gap-0.5">
        {canReactToThreadMessage(message) ? (
          <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
            <PopoverTrigger aria-label={t`React`} className={iconButtonClass}>
              <Smile size={15} strokeWidth={1.7} />
            </PopoverTrigger>
            <PopoverContent
              align={side === "end" ? "start" : "end"}
              className="w-auto flex-row gap-0 rounded-2xl p-1.5"
              aria-label={t`Reactions`}
            >
              {MESSAGE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  className="grid h-11 w-11 place-items-center rounded-xl text-2xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setReactionsOpen(false);
                    void onReact(message, emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        <button
          type="button"
          aria-label={t`Reply`}
          onClick={() => onReply(message)}
          className={iconButtonClass}
        >
          <Reply size={15} strokeWidth={1.7} />
        </button>
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger aria-label={t`More`} className={iconButtonClass}>
            <MoreHorizontal size={15} strokeWidth={1.7} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={side === "end" ? "start" : "end"} className="w-auto">
            {pinnable?<DropdownMenuItem disabled={pins!.busy} onClick={()=>{setMoreOpen(false);pins!.set(message.id,!pinned);}}>{pinned?<PinOff size={14}/>:<Pin size={14}/>}<span>{pinned?t`Unpin message`:t`Pin message`}</span></DropdownMenuItem>:null}
            <DropdownMenuItem
              onClick={() => {
                setMoreOpen(false);
                onReply(message);
              }}
            >
              <Reply size={14} strokeWidth={1.7} />
              <Trans>Reply</Trans>
            </DropdownMenuItem>
            {canMarkMessageUnread(message) && !markedUnread ? (
              <DropdownMenuItem
                onClick={() => {
                  setMoreOpen(false);
                  onMarkUnread(message);
                }}
              >
                <MessageSquareDot size={14} strokeWidth={1.7} />
                <Trans>Mark as unread</Trans>
              </DropdownMenuItem>
            ) : null}
            {onBranch ? <DropdownMenuItem disabled={branchDisabled}
              title={branchDisabled ? t`Wait until the current turn ends to branch this conversation.` : undefined}
              onClick={() => { setMoreOpen(false); onBranch(message); }}>
              <Split size={14} strokeWidth={1.7} />
              <Trans>Branch in new conversation</Trans>
            </DropdownMenuItem> : null}
            {recallable ? <DropdownMenuItem onClick={() => { setMoreOpen(false); memoryRecall!.show(message.id); }}>
              <Brain size={14} strokeWidth={1.7} />
              <Trans>Memory in context</Trans>
            </DropdownMenuItem> : null}
            {onAddRoutine && message.role === "user" && copyableMessageText(message) ? <DropdownMenuItem onClick={() => { setMoreOpen(false); onAddRoutine(copyableMessageText(message).slice(0, 80), copyableMessageText(message)); }}>
              <Repeat2 size={14} /><Trans>Repeat automatically</Trans>
            </DropdownMenuItem> : null}
            <DropdownMenuItem onClick={() => copyMessage(message)}>
              <Copy size={14} strokeWidth={1.7} />
              <Trans>Copy</Trans>
            </DropdownMenuItem>
            {sendToGroup?.groups.length && copyableMessageText(message) ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="send-to-group">
                  <Users size={14} strokeWidth={1.7} />
                  <Trans>Send to group</Trans>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {sendToGroup.groups.slice(0, SEND_TO_GROUP_MENU_LIMIT).map((group) => (
                    <DropdownMenuItem
                      key={group.id}
                      onClick={() => {
                        setMoreOpen(false);
                        sendToGroup.send(group.id, copyableMessageText(message));
                      }}
                    >
                      <span dir="auto" className="truncate">{group.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {onDelete ? <DropdownMenuItem variant="destructive" onClick={() => onDelete(message)}>
              <Trash2 size={14} aria-hidden="true" /><Trans>Delete</Trans>
            </DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </MessageHoverMetadata>
  );
}
