import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown, LinkifiedText, withBlockMentions } from "@mycellios/chat-ui/web";
import type { MessageReaction, ThreadMessage } from "@mycellios/contracts";
import type { ChildBotBlock } from "@mycellios/core";
import { isPeerReceiptBlocks, isSecretAskBlock, isToolActivityBlock } from "@mycellios/core";
import { BotAvatar, Button, cn, resolvePersonaColorDef } from "@mycellios/ui-web";
import { UserRound } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import { AskCard } from "../../components/AskCard";
import { CollaborationMarker } from "../../components/ai/CollaborationMarker";
import { CloudAgentCard } from "../../components/CloudAgentCard";
import {
  generatedImageArtifactIds,
  ImageGenerationCard,
} from "../../components/ImageGenerationCard";
import { SubagentCard } from "../../components/SubagentCard";
import { TaskReportCard } from "../../components/TaskReportCard";
import { RoutineRunMarker } from "../../components/RoutineRunMarker";
import {
  LIVE_TOOL_STEP_WINDOW,
  StandaloneToolActivity,
  ToolActivityDisclosure,
  ToolOnlyNarration,
  ToolSteps,
} from "../../components/ToolActivityDisclosure";
import { SkillDraftCard } from "../../components/teach/SkillDraftCard";
import { ThreadLinkChip } from "../../components/ThreadLinkChip";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { messageProviderLabel } from "../../lib/messaging";
import { PlanDisclosure } from "../../components/PlanDisclosure";
import { naturalTurnLayout } from "../../lib/natural-turn";
import { useResponseStyle } from "../../lib/response-style";
import {
  isToolOnlyNarration,
  renderableMessageBlocks,
  shouldRenderToolCard,
  toolStepCount,
} from "../../lib/tool-activity-view";
import { ReplyLine } from "./chat-context";
import { FALLBACK_BOT_COLOR, previewMessageText } from "./chat-shared";
import type { ImportSetupTarget } from "./import-setup-card";
import { ImportSetupCard } from "./import-setup-card";
import {
  AppConnectCard,
  ArtifactImage,
  ChartBlockView,
  ChoiceCard,
  McpApprovalCard,
} from "./message-cards";
import { MessageHoverActions } from "./message-hover-actions";

export const MessageView = memo(function MessageView({
  artifactTarget,
  canAnswer,
  canDismiss,
  message,
  mentions,
  onAnswer,
  onShowBot,
  onOpenPeerMessages,
  peerReplies,
  onTogglePeerReplies,
  speakerName,
  memberName,
  peerBot,
  replyParent,
  onJumpToMessage,
  onRefresh,
  onBotChanged,
  onAddRoutine,
  onOpenComputer,
  onOpenImportSetup,
  onOpenImport,
  showToolActivity,
  runEnded = false,
  showFullText = false,
  textWasStreamed = false,
  hideHoverActions = false,
  onReply,
  onMarkUnread,
  markedUnread = false,
  onReact,
  onDelete,
  onBranch,
  branchDisabled = false,
}: {
  artifactTarget: ArtifactTarget;
  canAnswer: boolean;
  canDismiss: boolean;
  message: ThreadMessage;
  mentions?: readonly ChildBotBlock[];
  onAnswer: (
    message: ThreadMessage,
    text: string,
    username?: string,
    dismiss?: boolean,
  ) => Promise<void>;
  onShowBot: (botId: string) => void;
  onOpenPeerMessages: (peer: { peerBotId: string; peerBotName: string }) => void;
  /** Set on a received marker whose peer run has folded replies. */
  peerReplies?: "collapsed" | "expanded";
  onTogglePeerReplies: (markerId: string) => void;
  speakerName?: string;
  memberName?: (botId: string | undefined) => string | undefined;
  peerBot: (botId: string) => { name?: string; color: string; status?: string } | undefined;
  replyParent?: ThreadMessage;
  onJumpToMessage?: (messageId: string) => void;
  onRefresh: () => Promise<void>;
  onBotChanged: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speaking: boolean;
  onSpeak: (message: ThreadMessage) => void;
  onOpenComputer: (botId?: string, handoffRunId?: string) => void;
  /** Opens where an imported item's setup is finished. */
  onOpenImportSetup?: (target: ImportSetupTarget) => void;
  /** Opens the agent importer (from Chief's first-run focus card). */
  onOpenImport?: () => void;
  showToolActivity: boolean;
  /** The message's run is no longer active, so nothing it started is still in progress. */
  runEnded?: boolean;
  /** A search or quote jump must reveal the complete target. */
  showFullText?: boolean;
  textWasStreamed?: boolean;
  hideHoverActions?: boolean;
  onReply: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  onDelete?: (message: ThreadMessage) => void;
  /** "Branch in new conversation", only on the last Mico message of a turn. */
  onBranch?: (message: ThreadMessage) => void;
  branchDisabled?: boolean;
}) {
  const { t, i18n } = useLingui();
  const isNarration =
    message.role === "bot" &&
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) => block.kind === "text" || block.kind === "progress" || block.kind === "steps" || block.kind === "plan",
    );
  const isLive = message.id.startsWith("progress:");
  const naturalStyle = useResponseStyle() === "natural" && message.role === "bot";
  const quoteMessageId = message.id.includes(":") ? undefined : message.id;
  // Only what is drawn names the mentioned bots; copy, quote, and speech keep the original text.
  const blocks = useMemo(
    () =>
      mentions?.length
        ? withBlockMentions(
            message.blocks,
            mentions.map((bot) => ({ id: bot.botId, name: bot.name })),
          )
        : message.blocks,
    [message.blocks, mentions],
  );
  const visibleNarrationBlocks = renderableMessageBlocks(blocks, showToolActivity);
  const generatedImages = useMemo(() => generatedImageArtifactIds(blocks), [blocks]);
  const renderMention = useCallback((id: string) => {
    const block = mentions?.find((bot) => bot.botId === id);
    return block ? (
      <BotMention block={block} color={peerBot(id)?.color} onShowBot={onShowBot} />
    ) : undefined;
  }, [mentions, onShowBot, peerBot]);

  const replyBotId = message.replyPreview?.botId ?? replyParent?.botId;
  const speakerBot = message.botId ? peerBot?.(message.botId) : undefined;
  const speakerColorDef = useMemo(
    () => resolvePersonaColorDef(message.botId ?? "bot", speakerBot?.color),
    [message.botId, speakerBot?.color],
  );
  const messageContext = (
    <>
      {speakerName ? (
        <div
          className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-tight"
          dir="auto"
          style={{ color: speakerColorDef.light }}
        >
          <BotAvatar
            color={speakerBot?.color ?? FALLBACK_BOT_COLOR}
            identity={message.botId}
            size={22}
          />
          {speakerName}
        </div>
      ) : null}
      <ReplyLine
        target={artifactTarget}
        message={message}
        fallbackText={replyParent ? previewMessageText(replyParent) : undefined}
        author={
          (message.replyPreview?.role ?? replyParent?.role) === "user"
            ? t`You`
            : ((replyBotId ? peerBot(replyBotId)?.name : undefined) ??
              memberName?.(replyBotId) ??
              t`Bot`)
        }
        onJump={onJumpToMessage}
      />
    </>
  );
  // Anchored below the speaker and reply line so the rail centers on the bubble itself.
  // A message with text and attachments anchors it on its first text bubble.
  const textAnchorIndex = message.blocks.findIndex((block) => block.kind === "text");
  const hoverAnchorIndex =
    textAnchorIndex === -1
      ? message.blocks.findIndex((block) => block.kind === "ask")
      : textAnchorIndex;
  const hoverActions = hideHoverActions || isPeerReceiptBlocks(message.blocks) ? null : (
    <MessageHoverActions
      message={message}
      side={message.role === "user" ? "start" : "end"}
      onReply={onReply}
      onMarkUnread={onMarkUnread}
      markedUnread={markedUnread}
      onReact={onReact}
      onAddRoutine={"botId" in artifactTarget ? onAddRoutine : undefined}
      onBranch={onBranch}
      onDelete={onDelete}
      branchDisabled={branchDisabled}
    />
  );
  if (isNarration && naturalStyle) {
    // Natural style: the short notes the agent wrote between steps, one steps summary, then the
    // complete answer. The notes and the summary carry no actions; the answer keeps them.
    const turn = naturalTurnLayout(blocks, isLive);
    // A durable mid-turn progress message is a note too: it is never the answer.
    const layout = message.progress
      ? { ...turn, notes: [...turn.notes, ...turn.answer.map((block) => block.text.trim())], answer: [] }
      : turn;
    const steps = layout.steps && shouldRenderToolCard(layout.steps, showToolActivity) ? layout.steps : null;
    const planBlock = blocks.find((block) => block.kind === "plan");
    if (layout.notes.length === 0 && !steps && !planBlock && layout.answer.length === 0) return null;
    return (
      <>
        {messageContext}
        {layout.notes.map((note, i) => (
          <div
            key={`note-${i}`}
            data-testid="message-progress-note"
            className="max-w-[74%] min-w-0 ps-1 text-sm text-muted-foreground"
            dir="auto"
          >
            <ChatMarkdown renderMention={renderMention}>{note}</ChatMarkdown>
          </div>
        ))}
        {planBlock ? <PlanDisclosure block={planBlock} live={isLive} /> : null}
        {steps ? (
          <StandaloneToolActivity
            live={isLive}
            steps={steps.steps}
            stepCount={toolStepCount(steps.steps)}
            durationMs={steps.durationMs}
          />
        ) : null}
        {layout.answer.length > 0 ? (
          <div className="relative w-fit max-w-full [@media(hover:none)]:w-full">
            <div className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full">
              <div
                data-testid="message-bot-bubble"
                className="rk-message-bubble max-w-full space-y-2.5 rounded-[20px] px-3.5 py-2.5 text-body1 text-foreground"
                dir="auto"
              >
                {layout.answer.map((block, i) => (
                  <div key={i} data-quote-message-id={block.kind === "text" ? quoteMessageId : undefined}>
                    <CollapsibleMessageText text={block.text} showFull={showFullText} renderMention={renderMention} />
                  </div>
                ))}
              </div>
            </div>
            {hoverActions}
          </div>
        ) : null}
      </>
    );
  }
  if (isNarration) {
    if (visibleNarrationBlocks.length === 0) return null;
    if (isToolOnlyNarration(message.blocks, showToolActivity)) {
      return (
        <>
          {messageContext}
          <div className="relative">
            <ToolOnlyNarration blocks={visibleNarrationBlocks} live={isLive} />
            {hoverActions}
          </div>
        </>
      );
    }
    return (
      <>
        {messageContext}
        <div className="relative w-fit max-w-full [@media(hover:none)]:w-full">
          <div className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full">
            <div
              data-testid="message-bot-bubble"
              className="rk-message-bubble max-w-full space-y-2.5 rounded-[20px] px-3.5 py-2.5 text-body1 text-foreground"
              dir="auto"
            >
              {visibleNarrationBlocks.map((block, i) => {
                if (block.kind === "steps") {
                  return (
                    <ToolActivityDisclosure
                      key={i}
                      live={isLive}
                      stepCount={toolStepCount(block.steps)}
                      durationMs={block.durationMs}
                    >
                      <ToolSteps
                        steps={block.steps}
                        currentIndex={isLive ? block.steps.length - 1 : undefined}
                        limit={isLive ? LIVE_TOOL_STEP_WINDOW : undefined}
                      />
                    </ToolActivityDisclosure>
                  );
                }
                if (block.kind === "plan") return <PlanDisclosure key={i} block={block} live={isLive} />;
                if (block.kind === "text" || block.kind === "progress") {
                  return (
                    <div
                      key={i}
                      data-quote-message-id={block.kind === "text" ? quoteMessageId : undefined}
                    >
                      <CollapsibleMessageText text={block.text} streaming={isLive || block.kind === "progress"} initiallyExpanded={textWasStreamed} showFull={showFullText} renderMention={renderMention} />
                    </div>
                  );
                }
                return null;
              })}

            </div>
          </div>
          {hoverActions}
        </div>
      </>
    );
  }
  // Task briefs and reports come from the Mico, not the person, so they stay on its side.
  const fromPerson =
    message.role === "user" &&
    !blocks.some((block) => block.kind === "task_report" || block.kind === "task_brief");
  return (
    <>
      {messageContext}
      <div className={cn("relative flex flex-col gap-2", fromPerson && "items-end")}>
        {blocks.map((block, i) => {
          if (block.kind === "steps" && shouldRenderToolCard(block, showToolActivity)) {
            return (
              <StandaloneToolActivity
                key={i}
                live={isLive}
                steps={block.steps}
                stepCount={toolStepCount(block.steps)}
                durationMs={block.durationMs}
              />
            );
          }
          if (isToolActivityBlock(block)) return null;
          if (block.kind === "plan") return <PlanDisclosure key={i} block={block} live={isLive} />;
          if (block.kind === "handoff") {
            const from = memberName?.(block.fromBotId) ?? t`bot`;
            const to = memberName?.(block.toBotId) ?? t`bot`;
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span>
                  ↪ {to} ← {from}
                </span>
                <span>{block.text}</span>
              </div>
            );
          }
          if (block.kind === "bot_message_sent" || block.kind === "bot_message_received") {
            const sent = block.kind === "bot_message_sent";
            const firstPeer = sent ? block.toBotName : block.fromBotName;
            const peerBotId = sent ? block.toBotId : block.fromBotId;
            const recipients = sent ? (block.recipients ?? []).map((recipient) => recipient.botName) : [];
            const peer =
              recipients.length > 1
                ? new Intl.ListFormat(i18n.locale || "en", { type: "conjunction" }).format(recipients)
                : firstPeer;
            // Requests and questions ask for an answer; results, statuses and updates inform.
            const asks = block.intent === undefined || block.intent === "request" || block.intent === "question";
            const answersRequest = !sent && Boolean(message.replyToMessageId);
            const label = sent
              ? asks
                ? t`Messaged ${peer}`
                : t`Informed ${peer}`
              : asks && !answersRequest
                ? t`Message from ${peer}`
                : t`Update from ${peer}`;
            return (
              <CollaborationMarker
                key={i}
                ariaLabel={label}
                color={peerBot(peerBotId)?.color ?? FALLBACK_BOT_COLOR}
                identity={peerBotId}
                label={label}
                onClick={() => onOpenPeerMessages({ peerBotId, peerBotName: firstPeer })}
                body={block.text}
                toggleLabels={{ expand: t`Expand ${label}`, collapse: t`Collapse ${label}` }}
                replies={
                  !sent && peerReplies
                    ? {
                        expanded: peerReplies === "expanded",
                        label:
                          peerReplies === "expanded" ? t`Collapse ${label}` : t`Expand ${label}`,
                        onToggle: () => onTogglePeerReplies(message.id),
                      }
                    : undefined
                }
              />
            );
          }
          if (block.kind === "task_report") {
            return (
              <TaskReportCard
                key={i}
                block={block}
                color={peerBot(block.fromBotId)?.color ?? FALLBACK_BOT_COLOR}
              />
            );
          }
          if (block.kind === "routine_run") {
            // The transcript groups these; anywhere else a marker shows as its own line.
            return (
              <RoutineRunMarker
                key={i}
                runs={[{ id: message.id, createdAt: message.createdAt, block }]}
                locale={i18n.locale || "en"}
              />
            );
          }
          if (block.kind === "task_brief") {
            // What the Mico wrote into a conversation it opened: the brief or a follow-up.
            const author = block.fromBotName;
            return (
              <div key={i} data-testid="task-brief" className="flex max-w-full flex-col items-start gap-1 self-start">
                <span dir="auto" className="ps-1 text-[13px] text-muted-foreground">
                  {t`From ${author}`}
                </span>
                <div
                  className="rk-message-bubble max-w-full rounded-[20px] px-3.5 py-2.5 text-body1 text-foreground"
                  dir="auto"
                  data-quote-message-id={quoteMessageId}
                >
                  <CollapsibleMessageText text={block.text} showFull={showFullText} />
                </div>
              </div>
            );
          }
          if (block.kind === "channel_message") {
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span className="shrink-0">
                  {messageProviderLabel(block.provider, block.transport)}
                </span>
                <span>
                  {block.fromLabel}: {block.text}
                </span>
              </div>
            );
          }
          if (block.kind === "meta") {
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span className="text-warning">◷</span>
                <span>{block.text}</span>
              </div>
            );
          }
          if (block.kind === "progress") {
            return (
              <div
                key={i}
                className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full"
              >
                <div
                  data-testid="message-bot-bubble"
                  className="rk-message-bubble max-w-full rounded-[20px] px-3.5 py-2.5 text-body1 text-foreground"
                  dir="auto"
                >
                  <ChatMarkdown streaming renderMention={renderMention}>{block.text}</ChatMarkdown>
                </div>
              </div>
            );
          }
          if (block.kind === "subagent") {
            return <SubagentCard key={i} block={block} />;
          }
          if (block.kind === "child_bot") {
            return (
              <div key={i} className="flex items-center gap-1.5 text-[15.5px]">
                <BotMention
                  block={block}
                  color={peerBot(block.botId)?.color}
                  onShowBot={onShowBot}
                />
                {block.status === "created" ? null : (
                  <span className="text-muted-foreground">
                    {block.status === "archived" ? <Trans>archived</Trans> : <Trans>deleted</Trans>}
                  </span>
                )}
              </div>
            );
          }
          if (block.kind === "choice") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <ChoiceCard
                key={i}
                botId={botId}
                block={block}
                onBotChanged={onBotChanged}
                onImportAgent={onOpenImport}
              />
            );
          }
          if (block.kind === "app_connect") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <AppConnectCard
                  botId={botId}
                  threadId={message.threadId}
                  messageId={message.id}
                  block={block}
                />
              </div>
            );
          }
          if (block.kind === "chart") {
            return (
              <div key={i} className="flex justify-start">
                <ChartBlockView name={block.name} spec={block.spec} data={block.data} />
              </div>
            );
          }
          if (block.kind === "import_setup") {
            return (
              <div key={i} className="flex justify-start">
                <ImportSetupCard
                  botId={"botId" in artifactTarget ? artifactTarget.botId : message.botId}
                  block={block}
                  onOpen={onOpenImportSetup}
                />
              </div>
            );
          }
          if (block.kind === "mcp_approval") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <McpApprovalCard botId={botId} threadId={message.threadId} block={block} />
              </div>
            );
          }
          if (block.kind === "image_generation") {
            const picture = blocks.find(
              (candidate) =>
                candidate.kind === "image" && candidate.artifactId === block.artifactId,
            );
            return (
              <div key={i} className="flex justify-start">
                <ImageGenerationCard
                  block={
                    runEnded && block.status === "generating"
                      ? { ...block, status: "interrupted" }
                      : block
                  }
                  target={artifactTarget}
                  name={picture?.kind === "image" ? picture.name : undefined}
                />
              </div>
            );
          }
          if (block.kind === "image" && generatedImages.has(block.artifactId)) return null;
          if (block.kind === "image") {
            return (
              <div
                key={i}
                className={`flex ${fromPerson ? "justify-end" : "justify-start"}`}
              >
                <ArtifactImage
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                />
              </div>
            );
          }
          if (block.kind === "file") {
            return (
              <div
                key={i}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <ArtifactFileCard
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                  mimeType={block.mimeType}
                  size={block.size}
                />
              </div>
            );
          }
          if (block.kind === "thread_link") {
            return (
              <div key={i} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <ThreadLinkChip botId={block.botId} threadId={block.threadId} title={block.title} />
              </div>
            );
          }
          if (block.kind === "text" && message.role === "user") {
            // User bubbles stay literal text on web and mobile. Only explicit URLs
            // and email addresses are links, so a sent address is tappable without
            // formatting bold or headings.
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full flex-wrap justify-end [@media(hover:none)]:w-full"
              >
                <div
                  data-testid="message-user-bubble"
                  data-quote-message-id={quoteMessageId}
                  className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] bg-chat-user px-3.5 py-2.5 text-body1 text-chat-user-foreground"
                  dir="auto"
                >
                  <LinkifiedText>{block.text}</LinkifiedText>
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "text") {
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full flex-wrap justify-start [@media(hover:none)]:w-full"
              >
                <div
                  data-testid="message-bot-bubble"
                  className="rk-message-bubble max-w-full rounded-[20px] px-3.5 py-2.5 text-body1 text-foreground"
                  dir="auto"
                >
                  <div data-quote-message-id={quoteMessageId}>
                    <CollapsibleMessageText text={block.text} initiallyExpanded={textWasStreamed} showFull={showFullText} renderMention={renderMention} />
                  </div>

                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "card") {
            return (
              <div key={i} className="flex justify-start">
                <div className="flex flex-col gap-2 rounded-[20px] bg-muted px-5 py-4">
                  {block.lines.map((line) => (
                    <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                      <span className="text-success">✓</span>
                      <span className="font-semibold text-foreground">{line.k}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{line.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (block.kind === "ask") {
            return (
              <div
                key={i}
                className="relative w-full min-w-0 max-w-xl"
              >
                <AskCard
                  block={block}
                  canAnswer={canAnswer}
                  canDismiss={canDismiss}
                  onAnswer={(text, username) => onAnswer(message, text, username)}
                  onDismiss={() => onAnswer(message, "", undefined, true)}
                />
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "cloud_agent") return <CloudAgentCard key={i} block={block} />;
          if (block.kind === "skill_draft") {
            return (
              <div key={i} className="flex justify-start">
                <SkillDraftCard block={block} onRefresh={onRefresh} onAddRoutine={onAddRoutine} />
              </div>
            );
          }
          if (block.kind === "computer") {
            return (
              <div
                key={i}
                data-testid="computer-card"
                className="w-[340px] max-w-full rounded-[18px] border border-border bg-muted px-[18px] py-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-foreground">
                    <Trans>Computer</Trans>
                  </span>
                  <span
                    className={
                      block.state === "Needs you"
                        ? "rounded-full bg-warning/15 px-[11px] py-1 text-[13px] text-warning"
                        : block.state === "Skipped"
                          ? "rounded-full bg-foreground/10 px-[11px] py-1 text-[13px] text-muted-foreground"
                          : "rounded-full bg-success/15 px-[11px] py-1 text-[13px] text-success"
                    }
                  >
                    {block.state}
                  </span>
                </div>
                <div className="my-2.5 text-[14.5px] leading-[1.5] text-foreground/75">
                  <ChatMarkdown renderMention={renderMention}>{block.text}</ChatMarkdown>
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="computer-card-open"
                  onClick={() => onOpenComputer(message.botId, block.state === "Needs you" ? message.runId : undefined)}
                >
                  <Trans>Open</Trans>
                </Button>
              </div>
            );
          }
          return null;
        })}
        {hoverAnchorIndex === -1 ? hoverActions : null}
      </div>
    </>
  );
});

/** A bot named inline in its color. A deleted, archived, or missing bot keeps only its name. */
function BotMention({
  block,
  color,
  onShowBot,
}: {
  block: ChildBotBlock;
  color: string | undefined;
  onShowBot: (botId: string) => void;
}) {
  const live = block.status === "created" && color;
  const name = (
    <span
      dir="auto"
      className="font-medium"
      style={live ? { color: resolvePersonaColorDef(block.botId, color).light } : undefined}
    >
      {block.name}
    </span>
  );
  if (!live) {
    return (
      <span data-testid="bot-mention" className="inline-flex items-baseline gap-1.5">
        <UserRound className="size-4 self-center text-muted-foreground" aria-hidden="true" />
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="bot-mention"
      onClick={() => onShowBot(block.botId)}
      className="-mx-1 inline-flex items-baseline gap-1.5 rounded-md px-1 transition-colors hover:bg-accent"
    >
      <span className="self-center">
        <BotAvatar color={color} identity={block.botId} size={18} />
      </span>
      {name}
    </button>
  );
}

/** Long bot replies keep the useful answer in view; the rest stays one click away. */
function CollapsibleMessageText({
  text,
  renderMention,
  streaming = false,
  showFull = false,
  initiallyExpanded = false,
}: {
  text: string;
  renderMention?: ComponentProps<typeof ChatMarkdown>["renderMention"];
  streaming?: boolean;
  showFull?: boolean;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded || streaming);
  useEffect(() => { if (showFull) setExpanded(true); }, [showFull]);
  const collapsible = !streaming && !showFull && text.length > 20_000;
  if (!collapsible) return <ChatMarkdown streaming={streaming} renderMention={renderMention}>{text}</ChatMarkdown>;
  // Bound actual Markdown work, not just its CSS height. Copy/quote still use the original message.
  const boundary = text.lastIndexOf("\n", 3000);
  // Cut at a line end when one falls in the second half of the preview.
  const preview = text.slice(0, boundary > 1500 ? boundary : 3000).trimEnd();
  return (
    <div>
      <ChatMarkdown renderMention={renderMention}>{expanded ? text : preview}</ChatMarkdown>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-7 px-2 text-xs text-muted-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <Trans>Show less</Trans> : <Trans>Show full message</Trans>}
      </Button>
    </div>
  );
}
