import { joinMessageBubbles } from "../../lib/message-bubble-group";
import { useGeneralPreferences } from "../../lib/general-preferences";
import { NewChatDivider } from "../../components/composer/NewChatDivider";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import type { MessageReaction, ThreadMessage, Run } from "@rakazo/contracts";
import type { FoldedTranscript } from "@rakazo/core";
import {
  expandPeerReplies,
  groupVoiceChats,
  isPeerReceiptBlocks,
  liveActivityLine,
  liveMessageComposing,
  projectMessageReactions,
  projectBotMentions,
  taskCostMessageId,
  timeSeparatorIds,
  unreadDividerMessageId,
  voiceChatHoldsMessage,
} from "@rakazo/core";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { Button, cn, Spinner } from "@rakazo/ui-web";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { ArrowDown } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PendingRunActivity, RunActivityStatus } from "../../components/RunActivityStatus";
import { RunExecutionDetails } from "../../components/RunExecutionDetails";
import { VoiceChatCard } from "../../components/call/VoiceChatCard";
import { TranscriptEmptyAvatar } from "./transcript-empty-avatar";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { quoteDraftForSelection } from "../../lib/quote-selection";
import { messageHasVisibleBlocks } from "../../lib/tool-activity-view";
import { transcriptIsNearEnd, transcriptMovedDown } from "../../lib/transcript-scroll";
import { TimeSeparator, UnreadDivider } from "./chat-context";
import type { ImportSetupTarget } from "./import-setup-card";
import { MessageView } from "./message-view";
import { MessageTouchActions } from "./message-hover-actions";
import { QuoteSelectionButton } from "./quote-selection-button";
import { getResponseCostVisible, subscribeResponseCost } from "../../lib/response-cost-preference";
import { TaskCostFooter } from "./task-cost-footer";
import { useTaskCosts } from "./use-task-costs";
import type { PendingThreadSend } from "../../lib/pending-thread-sends";

const NO_PENDING_SENDS: readonly PendingThreadSend[] = [];

export function bubbleFrameWidth(role: ThreadMessage["role"]) {
  return role === "user"
    ? "max-w-[min(84%,39rem)]"
    : "max-w-[min(92%,42rem)]";
}

export const Transcript = memo(function Transcript({
  headerTabs = false,
  conversationBot,
  scrollRef,
  scrollRequest,
  onScrollRequestHandled,
  artifactTarget,
  transcript,
  pendingMessages = NO_PENDING_SENDS,
  showToolActivity,
  olderCursor,
  unreadAfterSeq,
  loadingOlder,
  answerableAskIds,
  dismissableAskIds,
  running,
  workingBots,
  activeRun,
  lastRun,
  missingComputer,
  userBubble,
  onCallBack,
  onLoadOlder,
  onOpenBot,
  onAnswer,
  onReply,
  onMarkUnread,
  markedUnreadMessageId,
  onQuote,
  onReact,
  onJumpToMessage,
  onOpenPeerMessages,
  memberName,
  peerBot,
  onRefresh,
  onBotChanged,
  onAddRoutine,
  voiceReady,
  speakingMessageId,
  onSpeak,
  onOpenComputer,
  onOpenImportSetup,
  onOpenImport,
}: {
  headerTabs?: boolean;
  conversationBot?: { id: string; color: string };
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollRequest: { messageId: string; nonce: number } | null;
  onScrollRequestHandled: () => void;
  artifactTarget: ArtifactTarget;
  transcript: FoldedTranscript<ThreadMessage>;
  pendingMessages?: readonly PendingThreadSend[];
  showToolActivity: boolean;
  olderCursor: number | null;
  /** The seq read up to when this chat opened; null when nothing was unread. */
  unreadAfterSeq: number | null;
  loadingOlder: boolean;
  answerableAskIds: Set<string>;
  dismissableAskIds: Set<string>;
  running: boolean;
  workingBots: GroupAvatarMember[];
  activeRun?: Run;
  lastRun?: Run | null;
  missingComputer?: boolean;
  /** Your bubbles take the bot's color in its own chat. */
  userBubble?: { background: string; foreground: string };
  /** Calls the bot back from a missed call in the transcript. */
  onCallBack?: () => void;
  onLoadOlder: () => void | Promise<void>;
  onOpenBot: (botId: string) => void;
  onAnswer: (
    message: ThreadMessage,
    text: string,
    username?: string,
    dismiss?: boolean,
  ) => Promise<void>;
  onReply: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  markedUnreadMessageId?: string;
  onQuote: (message: ThreadMessage, quote: string) => void;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  onJumpToMessage: (messageId: string) => void;
  onOpenPeerMessages: (peer: { peerBotId: string; peerBotName: string }) => void;
  memberName?: (botId: string | undefined) => string | undefined;
  peerBot: (botId: string) => { name?: string; color: string; status?: string } | undefined;
  onRefresh: () => Promise<void>;
  onBotChanged: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speakingMessageId: string | null;
  onSpeak: (message: ThreadMessage) => void;
  onOpenComputer: (botId?: string) => void;
  onOpenImportSetup?: (target: ImportSetupTarget) => void;
  onOpenImport?: () => void;
}) {
  const { t } = useLingui();
  const touchLayout = useIsMobile();
  const { compactMessageActions } = useGeneralPreferences();
  const compactMessages = touchLayout && compactMessageActions;
  const contentRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const following = useRef(true);
  const autoScrolling = useRef(false);
  const lastScrollTop = useRef<number | null>(null);
  const autoScrollTimer = useRef<number | undefined>(undefined);
  const jumpButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedPeerMarkers, setExpandedPeerMarkers] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const togglePeerReplies = useCallback((markerId: string) => {
    // Like a pointer press: a keyboard toggle must not snap the transcript to its end.
    following.current = false;
    autoScrolling.current = false;
    setExpandedPeerMarkers((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(markerId)) next.add(markerId);
      return next;
    });
  }, []);
  // A jump to a folded reply expands its marker; the scroll effect below then finds the row.
  useLayoutEffect(() => {
    const markerId = scrollRequest && transcript.markerOf.get(scrollRequest.messageId);
    if (!markerId) return;
    setExpandedPeerMarkers((expanded) =>
      expanded.has(markerId) ? expanded : new Set(expanded).add(markerId),
    );
  }, [scrollRequest, transcript]);
  const messages = useMemo(
    () => expandPeerReplies(transcript, expandedPeerMarkers),
    [transcript, expandedPeerMarkers],
  );
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  // A reply the reader watched arrive must not shrink when its durable message replaces progress.
  // Keys include the thread; the bounded set never changes another conversation's presentation.
  const [streamedTextRuns, setStreamedTextRuns] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const live = messages.filter(message => message.runId && message.id.startsWith("progress:") &&
      message.blocks.some(block => (block.kind === "text" || block.kind === "progress") && block.text.trim() && !("activity" in block && block.activity)));
    if (!live.length) return;
    if (live.every(message => streamedTextRuns.has(`${message.threadId}:${message.runId}`))) return;
    setStreamedTextRuns(previous => {
      const keys = live.map(message => `${message.threadId}:${message.runId}`);
      if (keys.every(key => previous.has(key))) return previous;
      return new Set([...previous, ...keys].slice(-128));
    });
  }, [messages, streamedTextRuns]);
  const mentionView = useMemo(() => projectBotMentions(messages), [messages]);
  const foldedIntoRef = useRef(mentionView.foldedInto);
  useLayoutEffect(() => { foldedIntoRef.current = mentionView.foldedInto; }, [mentionView.foldedInto]);
  const jumpToMessage = useCallback(
    (messageId: string) => onJumpToMessage(foldedIntoRef.current.get(messageId) ?? messageId),
    [onJumpToMessage],
  );
  const reactionView = useMemo(
    () => projectMessageReactions(mentionView.visibleMessages),
    [mentionView],
  );
  const shownMessages = useMemo(
    () => reactionView.visibleMessages.filter(message => messageHasVisibleBlocks(message.blocks, showToolActivity)),
    [reactionView.visibleMessages, showToolActivity],
  );
  const separatorIds = useMemo(() => timeSeparatorIds(shownMessages), [shownMessages]);
  const threadItems = useMemo(() => groupVoiceChats(reactionView.visibleMessages), [reactionView.visibleMessages]);
  const showResponseCost = useSyncExternalStore(
    subscribeResponseCost,
    getResponseCostVisible,
    () => false,
  );
  const taskCosts = useTaskCosts(shownMessages, running);
  const costMessageIds = useMemo(() => taskCostMessageId(shownMessages), [shownMessages]);
  const unreadDividerId = unreadDividerMessageId(shownMessages, unreadAfterSeq, olderCursor);
  const [quoteDraft, setQuoteDraft] = useState<{
    message: ThreadMessage;
    text: string;
    range: Range;
  } | null>(null);
  const selectingWithMouse = useRef(false);

  const evaluateSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setQuoteDraft(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const contentOf = (node: Node) =>
      (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
        "[data-quote-message-id]",
      ) ?? null;
    const startContent = contentOf(range.startContainer);
    const endContent = contentOf(range.endContainer);
    // selection.toString() serializes the whole range (a Ctrl+A transcript is
    // unbounded), so it only runs once both endpoints sit in one message.
    const draft = quoteDraftForSelection(
      {
        startContent,
        endContent,
        text: startContent && startContent === endContent ? selection.toString() : "",
      },
      messageById,
    );
    setQuoteDraft((prev) => {
      if (!draft) return null;
      // Repeat firings for an unchanged selection reuse the draft so the
      // transcript isn't re-rendered by every unrelated selection event. A
      // moved selection (e.g. keyboard-selecting a second occurrence of the
      // same text) must carry its new Range — the pill anchors to it.
      if (
        prev &&
        prev.message === draft.message &&
        prev.text === draft.text &&
        prev.range.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
        prev.range.compareBoundaryPoints(Range.END_TO_END, range) === 0
      ) {
        return prev;
      }
      return { ...draft, range };
    });
  }, [messageById]);

  // Keyboard and assistive-tech selections never reach a mouseup, so the pill
  // lifecycle listens on selectionchange; the mouse flag keeps it hidden while
  // a drag is still in flight.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      selectingWithMouse.current = true;
      if ((event.target as Element | null)?.closest?.("[data-quote-selection]")) return;
      setQuoteDraft(null);
    };
    const onMouseUp = () => {
      selectingWithMouse.current = false;
      evaluateSelection();
    };
    const onSelectionChange = () => {
      if (!selectingWithMouse.current) evaluateSelection();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuoteDraft(null);
    };
    // A drag that ends outside the window never fires document mouseup; reset
    // the flag on blur so keyboard selections keep working afterwards.
    const onWindowBlur = () => {
      selectingWithMouse.current = false;
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [evaluateSelection]);
  const jumpScrolling = useRef(false);
  const followGeometry = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport || !following.current || autoScrolling.current || jumpScrolling.current) return;
    const bottom = viewport.scrollHeight - viewport.clientHeight;
    if (bottom - viewport.scrollTop > 1) viewport.scrollTop = bottom;
  }, [scrollRef]);

  const settleLatest = useCallback(() => {
    if (!autoScrolling.current) return;
    autoScrolling.current = false;
    window.clearTimeout(autoScrollTimer.current);
    followGeometry();
  }, [followGeometry]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    following.current = true;
    autoScrolling.current = !reducedMotion;
    setAtEnd(true);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    window.clearTimeout(autoScrollTimer.current);
    if (!reducedMotion) autoScrollTimer.current = window.setTimeout(settleLatest, 2_000);
  }, [scrollRef, settleLatest]);

  const scrolledJump = useRef<number | null>(null);
  const jumpScrollTimer = useRef<number | undefined>(undefined);
  const endJumpScroll = useCallback(() => {
    jumpScrolling.current = false;
    window.clearTimeout(jumpScrollTimer.current);
    scrollRef.current?.removeEventListener("scrollend", endJumpScroll);
  }, [scrollRef]);
  // A jump scroll must win over follow-the-tail: unfollow inside the commit
  // that mounts the row so a live commit cannot cancel the animation, keep
  // retrying while the pinned window is still rendering, and suppress the
  // near-end follow re-arm only for the jump's own scroll events — scrollend
  // (or user input interrupting it, which also fires scrollend) ends the
  // suppression, with the timeout as fallback when no scroll happens.
  useLayoutEffect(() => {
    if (!scrollRequest || scrolledJump.current === scrollRequest.nonce) return;
    const element = scrollRef.current;
    const row = element?.querySelector(
      `[data-message-id="${CSS.escape(scrollRequest.messageId)}"]`,
    );
    if (!element || !row) return;
    scrolledJump.current = scrollRequest.nonce;
    following.current = false;
    autoScrolling.current = false;
    jumpScrolling.current = true;
    element.addEventListener("scrollend", endJumpScroll, { once: true });
    window.clearTimeout(jumpScrollTimer.current);
    jumpScrollTimer.current = window.setTimeout(endJumpScroll, 2_000);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Streaming layout updates can interrupt a smooth jump before it reaches the row.
    row.scrollIntoView({ behavior: "auto", block: "center" });
    row.animate(
      reducedMotion
        ? [{ backgroundColor: "var(--muted)" }, { backgroundColor: "var(--muted)" }]
        : [
            { backgroundColor: "transparent" },
            { backgroundColor: "var(--muted)" },
            { backgroundColor: "transparent" },
          ],
      { duration: 1200 },
    );
    onScrollRequestHandled();
  }, [messages, scrollRequest, scrollRef, endJumpScroll, onScrollRequestHandled]);

  // Follow actual geometry changes, including keyboard resize and late media,
  // instead of forcing a layout on every streaming commit.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    followGeometry();
    const observer = new ResizeObserver(followGeometry);
    observer.observe(content);
    observer.observe(viewport);
    viewport.addEventListener("scrollend", settleLatest);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scrollend", settleLatest);
    };
  }, [scrollRef, followGeometry, settleLatest]);

  const previousTail = useRef<ThreadMessage | undefined>(undefined);
  const tail = shownMessages.findLast(message => !message.id.startsWith("progress:"));
  useLayoutEffect(() => {
    const previous = previousTail.current;
    previousTail.current = tail;
    if (!previous || !tail || tail.role === "user" ||
        (tail.runId && streamedTextRuns.has(`${tail.threadId}:${tail.runId}`)) ||
        tail.seq <= previous.seq || !following.current ||
        jumpScrolling.current || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const row = contentRef.current?.querySelector(
      `[data-message-id="${CSS.escape(tail.id)}"]`,
    );
    row?.animate(
      [{ opacity: 0.55, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 175, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  }, [tail]);

  useLayoutEffect(() => {
    const button = jumpButtonRef.current;
    if (atEnd && button && document.activeElement === button) {
      button.blur();
    }
  }, [atEnd]);

  const loadOlder = useCallback(() => {
    const wasFollowing = following.current;
    // Prepend must not race the end-follow observer.
    following.current = false;
    autoScrolling.current = false;
    const pending = onLoadOlder();
    if (!pending) return;
    return Promise.resolve(pending).catch((error) => {
      const element = scrollRef.current;
      if (wasFollowing && element && transcriptIsNearEnd(element)) {
        following.current = true;
        setAtEnd(true);
      }
      throw error;
    });
  }, [onLoadOlder, scrollRef]);

  useEffect(
    () => () => {
      window.clearTimeout(autoScrollTimer.current);
      window.clearTimeout(jumpScrollTimer.current);
    },
    [],
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="transcript"
        onPointerDown={(event) => {
          lastScrollTop.current = event.currentTarget.scrollTop;
          if (autoScrolling.current) following.current = false;
          autoScrolling.current = false;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            lastScrollTop.current = event.currentTarget.scrollTop;
            autoScrolling.current = false;
            following.current = false;
          }
        }}
        onScroll={(event) => {
          const scrolledDown = transcriptMovedDown(
            lastScrollTop.current,
            event.currentTarget.scrollTop,
          );
          lastScrollTop.current = event.currentTarget.scrollTop;
          const nearEnd = transcriptIsNearEnd(event.currentTarget);
          if (atEnd !== nearEnd) setAtEnd(nearEnd);
          // A jump scroll owns the viewport until its animation settles; its
          // own near-end crossings must not re-arm tail-following.
          if (jumpScrolling.current) return;
          if (nearEnd) {
            if (scrolledDown) following.current = true;
          } else if (!autoScrolling.current) {
            following.current = false;
          }
        }}
        className="rk-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto scroll-pt-5 scroll-pb-7"
        style={
          userBubble
            ? ({
                "--chat-user": "var(--custom-chat-user, " + userBubble.background + ")",
                "--chat-user-foreground": "var(--custom-chat-user-foreground, " + userBubble.foreground + ")",
              } as CSSProperties)
            : undefined
        }
      >
        <div ref={contentRef} className="flex min-h-full min-w-0 rk-transcript-stack flex-col gap-0 px-3 pt-3 pb-8 md:px-[max(1.75rem,calc((100%_-_60rem)/2))] md:pt-5 md:pb-13">
        {olderCursor != null ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
            aria-label={t`Load earlier messages`}
            className="self-center text-muted-foreground"
          >
            {loadingOlder ? <Spinner aria-label={t`Loading…`} /> : null}
            {t`Load earlier messages`}
          </Button>
        ) : null}
        {reactionView.visibleMessages.length === 0 && !pendingMessages.length && !running && olderCursor == null ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 px-4 py-12 text-center">
            <TranscriptEmptyAvatar bot={conversationBot} />
            <h2 className="font-display text-2xl tracking-tight">{t`What shall we work on?`}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t`Start with a question, an idea, or something you want to get done.`}</p>
          </div>
        ) : null}
        {threadItems.map((item, itemIndex) => {
          if (item.kind === "voiceChat") {
            return (
              <div key={item.key}>
                {item.messages[0] && separatorIds.has(item.messages[0].id) ? (
                  <TimeSeparator
                    createdAt={item.messages[0].createdAt}
                    locale={i18n.locale || "en"}
                  />
                ) : null}
                {voiceChatHoldsMessage(item, unreadDividerId) ? (
                  <UnreadDivider
                    afterSeparator={Boolean(
                      item.messages[0] && separatorIds.has(item.messages[0].id),
                    )}
                  />
                ) : null}
                <VoiceChatCard
                  group={item}
                  revealMessageId={scrollRequest?.messageId}
                  onCallBack={onCallBack}
                />
              </div>
            );
          }
          const message = item.message;
          if (message.blocks.some(block => block.kind === "context_reset")) return <NewChatDivider key={message.id} messageId={message.id}/>;
          const messageToolActivity = showToolActivity && !(running && activeRun &&
            message.id.startsWith("progress:") &&
            (message.id === `progress:${activeRun.id}` || message.runId === activeRun.id));
          if (!messageHasVisibleBlocks(message.blocks, messageToolActivity)) return null;
          const before = threadItems[itemIndex - 1];
          const after = threadItems[itemIndex + 1];
          const joinsPrevious = joinMessageBubbles(before?.kind === "message" ? before.message : undefined, message, separatorIds.has(message.id) || message.id === unreadDividerId);
          const joinsNext = joinMessageBubbles(message, after?.kind === "message" ? after.message : undefined, Boolean(after?.kind === "message" && (separatorIds.has(after.message.id) || after.message.id === unreadDividerId)));
          const peerReceipt = isPeerReceiptBlocks(message.blocks);
          const messageReactions = reactionView.reactions.get(message.id);
          const wrapMessage = (content: ReactNode) =>
            compactMessages && !peerReceipt && !message.id.startsWith("progress:") &&
            message.blocks.some((block) => block.kind === "text" || block.kind === "file" || block.kind === "image" || block.kind === "ask")
              ? <MessageTouchActions message={message} onReply={onReply} onMarkUnread={onMarkUnread}
                  markedUnread={message.id === markedUnreadMessageId} onReact={onReact} onAddRoutine={"botId" in artifactTarget ? onAddRoutine : undefined}>{content}</MessageTouchActions>
              : content;
          return (
            <Fragment key={message.id}>
              {compactMessageActions && separatorIds.has(message.id) ? (
                <TimeSeparator createdAt={message.createdAt} locale={i18n.locale || "en"} />
              ) : null}
              {message.id === unreadDividerId ? (
                <UnreadDivider afterSeparator={separatorIds.has(message.id)} />
              ) : null}
              <div
                data-message-id={message.id}
                data-message-role={message.role}
                data-joins-previous={joinsPrevious || undefined}
                data-joins-next={joinsNext || undefined}
                className={cn(peerReceipt ? "relative py-0.5" : "group/message relative hover:z-20",
                  message.id.startsWith("progress:") && "rk-chat-live-row")}
              >
                <div
                  className={
                    peerReceipt
                      ? undefined
                      : `relative flex ${message.role === "user" ? "justify-end" : "justify-start"}`
                  }
                >
                  <div
                    data-testid={peerReceipt ? undefined : "message-bubble-frame"}
                    className={
                      peerReceipt
                        ? undefined
                        : message.blocks.some(
                              (block) => block.kind === "ask" || block.kind === "mcp_approval",
                            )
                          ? `relative w-full min-w-0 ${bubbleFrameWidth(message.role)}`
                          : `relative ${message.blocks.some((block) => block.kind === "app_connect") ? "w-full" : "w-fit"} min-w-0 ${bubbleFrameWidth(message.role)}`
                    }
                  >
                    {wrapMessage(<MessageView
                      artifactTarget={artifactTarget}
                      message={message}
                      markedUnread={message.id === markedUnreadMessageId}
                      mentions={mentionView.mentions.get(message.id)}
                      canAnswer={answerableAskIds.has(message.id)}
                      canDismiss={dismissableAskIds.has(message.id)}
                      onOpenBot={onOpenBot}
                      onOpenPeerMessages={onOpenPeerMessages}
                      peerReplies={
                        transcript.folded.has(message.id)
                          ? expandedPeerMarkers.has(message.id)
                            ? "expanded"
                            : "collapsed"
                          : undefined
                      }
                      onTogglePeerReplies={togglePeerReplies}
                      onAnswer={onAnswer}
                      speakerName={
                        peerReceipt
                          ? undefined
                          : message.role === "bot"
                            ? memberName?.(message.botId)
                            : undefined
                      }
                      memberName={memberName}
                      peerBot={peerBot}
                      replyParent={
                        message.replyToMessageId
                          ? messageById.get(message.replyToMessageId)
                          : undefined
                      }
                      onJumpToMessage={jumpToMessage}
                      onRefresh={onRefresh}
                      onBotChanged={onBotChanged}
                      onAddRoutine={onAddRoutine}
                      voiceReady={voiceReady}
                      speaking={speakingMessageId === message.id}
                      onSpeak={onSpeak}
                      onOpenComputer={onOpenComputer}
                      onOpenImportSetup={onOpenImportSetup}
                      onOpenImport={onOpenImport}
                      showToolActivity={messageToolActivity}
                      showFullText={scrollRequest?.messageId === message.id}
                      textWasStreamed={Boolean(message.runId && streamedTextRuns.has(`${message.threadId}:${message.runId}`))}
                      hideHoverActions={compactMessages}
                      onReply={onReply}
                      onMarkUnread={onMarkUnread}
                      onReact={onReact}
                    />)}
                    {lastRun?.completedAt && message.runId === lastRun.id &&
                    costMessageIds.get(lastRun.id) === message.id ? (
                      <details className="mt-2 max-w-prose text-xs text-muted-foreground">
                        <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t`Execution details`}</summary>
                        <div className="mt-2"><RunExecutionDetails run={lastRun} cost={taskCosts.get(lastRun.id)} /></div>
                      </details>
                    ) : null}
                    {showResponseCost &&
                    message.runId &&
                    costMessageIds.get(message.runId) === message.id &&
                    taskCosts.has(message.runId) ? (
                      <TaskCostFooter cost={taskCosts.get(message.runId)!} />
                    ) : null}
                  </div>
                </div>
                {!peerReceipt && messageReactions ? (
                  <div
                    data-testid="message-reactions"
                    className={cn(
                      "mt-1 flex flex-wrap gap-1",
                      message.role === "user" && "justify-end",
                    )}
                  >
                    {[...messageReactions].map(([emoji, count]) => (
                      <span
                        key={emoji}
                        className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
                      >
                        {emoji}
                        {count > 1 ? ` ${count}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Fragment>
          );
        })}
        {pendingMessages.map(message => (
          <div key={message.nonce} data-testid="pending-message" aria-busy={message.messageId === undefined} className="rk-chat-pending-row flex justify-end">
            <div className={cn("min-w-0 rounded-[20px] bg-chat-user px-3.5 py-2.5 text-body1 text-chat-user-foreground", bubbleFrameWidth("user"))}>
              {message.text ? <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p> : null}
              {message.attachments.map((name, index) => <p key={`${index}:${name}`} className="break-all text-xs">{name}</p>)}
              {message.messageId === undefined ? <span role="status" className="sr-only">{t`Sending…`}</span> : null}
            </div>
          </div>
        ))}
        {running &&
        (activeRun ||
          !messages.some(
            (message) => message.id.startsWith("progress:") && liveMessageComposing(message.blocks),
          )) ? (
          activeRun ? (
            <RunActivityStatus
              run={activeRun}
              messages={messages}
              bots={workingBots}
              activity={liveActivityLine(messages) ?? undefined}
              cost={taskCosts.get(activeRun.id)}
              missingComputer={missingComputer}
              onRefresh={onRefresh}
              onOpenComputer={() => onOpenComputer(activeRun.botId)}
            />
          ) : (
            <PendingRunActivity bots={workingBots} messages={messages} onRefresh={onRefresh} />
          )
        ) : null}
        </div>
      </div>
      {quoteDraft ? (
        <QuoteSelectionButton
          range={quoteDraft.range}
          onQuote={() => {
            onQuote(quoteDraft.message, quoteDraft.text);
            window.getSelection()?.removeAllRanges();
            setQuoteDraft(null);
          }}
        />
      ) : null}
      <Button
        ref={jumpButtonRef}
        variant="floating"
        size="icon-lg"
        aria-label={t`Jump to latest`}
        aria-hidden={atEnd}
        tabIndex={atEnd ? -1 : 0}
        onClick={jumpToLatest}
        className={`absolute bottom-11 left-1/2 z-20 -translate-x-1/2 shadow-md transition-[opacity,transform,background-color] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${
          atEnd ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <ArrowDown strokeWidth={1.8} className="size-[17px]" />
      </Button>
    </div>
  );
});

/**
 * Floating Quote action anchored to the selection's bounding rect. Measures
 * itself after mount so it can flip below the selection when there is no room
 * above and stay clamped inside the viewport; re-anchors on scroll/resize.
 */
