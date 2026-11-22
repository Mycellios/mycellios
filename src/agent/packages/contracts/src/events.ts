import * as z from "zod";
import { AgentImportSetupItemSchema } from "./agent-import-setup.js";
import { botSecretDestinationSchema } from "./bot-secrets.js";
import { AgentQuestions } from "./questionnaire.js";
import { Id } from "./ids.js";
import { McpTransportSchema } from "./mcp.js";

export const IMAGE_ASPECT_RATIOS = ["square", "portrait", "landscape"] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export const IMAGE_GENERATION_STATUSES = [
  "generating",
  "completed",
  "failed",
  "interrupted",
] as const;

export const ProductEventType = z.enum([
  "thread.message.created",
  "thread.cleared",
  "thread.message.updated",
  "thread.message.reaction",
  "thread.progress",
  "thread.artifact",
  "thread.ask",
  "thread.choice",
  "thread.meta",
  "thread.computer",
  "thread.subagent",
  "thread.cloud_agent",
  "thread.call.ended",
  "run.started",
  "run.steering.claimed",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.status",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "computer.command",
  "memory.revised",
  "routine.created",
  "routine.updated",
  "routine.fired",
  "skill.teaching.started",
  "skill.teaching.stopped",
  "skill.draft.created",
  "skill.saved",
  "effect.recorded",
  "agent.tool.called",
  "agent.tool.completed",
  "effect.reconciled",
  "usage.recorded",
  "bot.spawned",
  "bot.updated",
  "bot.archived",
  "bot.deleted",
  "group.created",
  "group.updated",
  "group.handoff",
  /** Liveness only: never persisted, never applied to a snapshot, always seq 0. */
  "heartbeat",
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const MessageRole = z.enum(["user", "bot", "system"]);
export const BotMessageIntent = z.enum(["request", "result", "question", "status", "fyi"]);
export type BotMessageIntent = z.infer<typeof BotMessageIntent>;

export const MAX_CHART_DATA_ROWS = 5_000;

const ChartSpec = z.record(z.string(), z.any());

function embeddedChartRowCount(spec: Record<string, unknown>): number {
  const specData = Array.isArray(spec.data) ? spec.data.length : 0;
  const markData = Array.isArray(spec.marks)
    ? spec.marks.reduce((total, mark) => {
        if (!mark || typeof mark !== "object" || !Array.isArray(mark.data)) return total;
        return total + mark.data.length;
      }, 0)
    : 0;
  return specData + markData;
}

const ChartBlock = z
  .object({
    kind: z.literal("chart"),
    name: z.string(),
    /** Declarative Observable Plot spec, validated by render_plot before publish.
        z.any keeps the inferred type JSON-assignable for persistence. */
    spec: ChartSpec,
    data: z.array(z.any()).max(MAX_CHART_DATA_ROWS),
  })
  .superRefine((block, ctx) => {
    if (block.data.length + embeddedChartRowCount(block.spec) <= MAX_CHART_DATA_ROWS) return;
    ctx.addIssue({
      code: "custom",
      message: `Chart data exceeds the ${MAX_CHART_DATA_ROWS.toLocaleString("en-US")}-row limit`,
    });
  });

/** How the turn a task report relays ended. */
export const TASK_REPORT_OUTCOMES = ["completed", "failed", "stopped", "interrupted"] as const;
export type TaskReportOutcome = (typeof TASK_REPORT_OUTCOMES)[number];

/**
 * How a routine run that worked in its own conversation ended, as its main-chat marker says:
 * it answered, it had nothing new (quiet), it failed or reported a failure, or it paused its
 * own routine.
 */
export const ROUTINE_RUN_OUTCOMES = ["reported", "quiet", "failed", "paused"] as const;
export type RoutineRunOutcome = (typeof ROUTINE_RUN_OUTCOMES)[number];

export const SecretAskPurpose = z.enum(["otp", "password", "api_key"]);
export type SecretAskPurpose = z.infer<typeof SecretAskPurpose>;

export const MessageBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("context_reset") }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    /** A user message points at another conversation of the same Mico; the title is the one it had then. */
    kind: z.literal("thread_link"),
    botId: Id,
    threadId: Id,
    title: z.string().max(240),
  }),
  z.object({
    kind: z.literal("card"),
    lines: z.array(z.object({ k: z.string(), v: z.string() })),
  }),
  z.object({
    kind: z.literal("ask"),
    questions: AgentQuestions.optional(),
    text: z.string(),
    approvalEffectId: Id.optional(),
    instructionUpdate: z
      .object({
        botId: Id,
        before: z.string(),
        after: z.string(),
        reason: z.string(),
        undoVersionId: Id.optional(),
      })
      .optional(),
    detail: z.string().optional(),
    detailFormat: z.enum(["text", "code"]).optional(),
    input: z.enum(["text", "secret"]).optional(),
    /** Why the secret is needed; drives field label on the masked card. */
    purpose: SecretAskPurpose.optional(),
    // Records what the runtime could produce under either deployment mode, so
    // an ask persisted before an owner toggles the private-HTTP flag still
    // validates on replay.
    credential: botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).optional(),
    /** On a fetch approval, the site an "always" answer allows. */
    site: z.string().optional(),
    status: z.enum(["pending", "answered"]).optional(),
    answer: z.string().optional(),
    /** A secret request the user dismissed instead of answering. */
    dismissed: z.literal(true).optional(),
    /**
     * A plan card (acknowledge_request): the steps the Mico will take, shown under the ask text.
     * The server answers "start" by itself at autoStartAt when nobody answers first.
     */
    plan: z
      .object({
        steps: z.array(z.object({ label: z.string().max(24), text: z.string().max(200) })).min(1).max(4),
        autoStartAt: z.string().optional(),
        autoStarted: z.literal(true).optional(),
      })
      .optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          outcome: z.enum(["created", "cancelled"]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({ id: z.string(), letter: z.string(), label: z.string() })),
    /** Set once the user picks an option; renders the picker as answered. */
    answerId: z.string().optional(),
  }),
  z.object({
    /** Inline app authorization card (Composio-backed): logo, name, one-line
        description, and an Authorize button that flips to connected. */
    kind: z.literal("app_connect"),
    connectorId: z.string().optional(),
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    logo: z.string().nullable(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("connect"),
    name: z.string(),
    initial: z.string(),
    color: z.string(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("computer"),
    state: z.string(),
    text: z.string(),
  }),
  z.object({
    /** Transcript card left in the thread when the bot hangs up a voice call. */
    kind: z.literal("voice_call"),
    /** Absent when the call had no client nonce to derive an id from. */
    callId: z.string().optional(),
    title: z.string(),
    farewell: z.string(),
    /** Connected time the caller's client measured; absent when the bot hung up. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** The bot is calling the user; the card tracks the call from ringing to its outcome. */
    kind: z.literal("call_request"),
    callId: z.string(),
    /** Why the bot is calling, shown on the incoming call. */
    reason: z.string(),
    /** The bot's first spoken sentence once the user answers. */
    opening: z.string(),
    status: z.enum(["ringing", "answered", "declined", "missed"]),
    expiresAt: z.string(),
    /** Connected time the user's client measured after answering. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("meta"), text: z.string() }),
  z.object({
    kind: z.literal("progress"),
    text: z.string(),
    /** Provider-generated tool status rather than assistant-authored narration. */
    activity: z.literal(true).optional(),
    pendingToolNames: z.array(z.string()).optional(),
    pendingToolLabels: z.array(z.string().max(500)).max(32).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    steps: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
    tools: z.array(z.object({
      id: z.string().max(256), name: z.string().max(200),
      outcome: z.enum(["running", "succeeded", "error", "paused"]),
      updatedAt: z.string().optional(), durationMs: z.number().nonnegative().optional(),
      error: z.string().max(500).optional(), detail: z.string().max(2000).optional(),
      command: z.string().max(2000).optional(), cwd: z.string().max(1000).optional(),
      output: z.string().max(12000).optional(), exitCode: z.number().int().nullable().optional(),
      outputTruncated: z.boolean().optional(),
      commandStatus: z.enum(["running", "done"]).optional(),
      commandStartedAt: z.string().optional(), commandFinishedAt: z.string().optional(),
    })).max(16).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** The turn's latest work plan (update_work_plan), shown as a task list above the answer. */
    kind: z.literal("plan"),
    explanation: z.string().max(240).optional(),
    steps: z.array(z.object({
      title: z.string().max(240),
      status: z.enum(["pending", "running", "done"]),
    })).max(12),
  }),
  z.object({
    kind: z.literal("subagent"),
    agentId: z.string(),
    name: z.string(),
    task: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    progress: z.string().optional(),
    result: z.string().optional(),
  }),
  z.object({
    kind: z.literal("child_bot"),
    botId: z.string(),
    name: z.string(),
    title: z.string().optional(),
    status: z.enum(["created", "archived", "deleted"]),
  }),
  z.object({
    /** Compact card for a remote cloud coding agent (not the bot computer). */
    kind: z.literal("cloud_agent"),
    agentId: z.string(),
    title: z.string(),
    status: z.enum(["running", "finished", "failed", "cancelled", "expired"]),
    url: z.string(),
    branch: z.string().optional(),
    prUrl: z.string().optional(),
    latestRunId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("skill_draft"),
    skillId: Id,
    name: z.string(),
    goal: z.string(),
    playbook: z.object({
      whenToUse: z.string(),
      inputs: z.array(z.string()),
      steps: z.array(z.string()),
      howToCheck: z.string(),
      whatToReturn: z.string(),
      approvalBoundaries: z.string(),
      failureHandling: z.string(),
    }),
    status: z.enum(["draft", "saved"]),
  }),
  ChartBlock,
  z.object({
    /** Approval card for an agent-created MCP server. The user completes the
        OAuth popup (or confirms no authorization is needed) in the UI. The
        status persists so the card renders its decision after a remount. */
    kind: z.literal("mcp_approval"),
    name: z.string(),
    serverId: Id,
    transport: McpTransportSchema,
    endpoint: z.string().nullable(),
    needsOAuth: z.boolean(),
    status: z.enum(["pending", "connected", "dismissed"]).default("pending"),
  }),
  z.object({
    kind: z.literal("import_setup"),
    items: z.array(AgentImportSetupItemSchema),
    /** Set by Undo, which also empties `items`; the checklist is then hidden. */
    undone: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("file"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  /**
   * A generate_image call, shown as one card from the moment generation starts.
   * A completed card is followed by the plain `image` block of the same artifact,
   * so clients without this card still show the picture.
   */
  z.object({
    kind: z.literal("image_generation"),
    status: z.enum(IMAGE_GENERATION_STATUSES),
    aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
    prompt: z.string().max(4000).optional(),
    artifactId: Id.optional(),
    width: z.number().int().positive().max(65_535).optional(),
    height: z.number().int().positive().max(65_535).optional(),
    error: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal("handoff"),
    fromBotId: Id,
    toBotId: Id,
    text: z.string(),
    /** Links ownership transfers in one user-started group turn. */
    hop: z.number().int().positive().optional(),
  }),
  z.object({
    /** A group-chat message delivered into a member bot's own thread. */
    kind: z.literal("channel_message"),
    provider: z.string(),
    /** Per-message network when a provider spans multiple transports. */
    transport: z.string().optional(),
    channelId: Id,
    fromAddress: z.string(),
    fromLabel: z.string(),
    text: z.string(),
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** Shown in the sending bot's own chat, so the user can see what it sent. */
    kind: z.literal("bot_message_sent"),
    toBotId: Id,
    toBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
  }),
  z.object({
    /** Delivered into the receiving bot's own chat as the prompt that woke it. */
    kind: z.literal("bot_message_received"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
    /** Sender-thread echo this delivery answers, when applicable. */
    returnToMessageId: Id.optional(),
    /** Links in a bot-started chain; absent when a person started it. */
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /**
     * What a Mico wrote into a conversation it opened itself: the brief that starts it, or a
     * later message from its main chat. The input of that conversation's next turn.
     */
    kind: z.literal("task_brief"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
  }),
  z.object({
    /**
     * A finished turn of a conversation the Mico opened, delivered into its own main chat,
     * where it starts the turn that gives the person the result. Shown folded.
     */
    kind: z.literal("task_report"),
    fromBotId: Id,
    fromBotName: z.string(),
    /** The conversation (side thread) the report comes from. */
    taskId: Id,
    title: z.string(),
    outcome: z.enum(TASK_REPORT_OUTCOMES),
    /** The turn's answer (cut with a closing "[…]"), its error, or the title when neither exists. */
    text: z.string(),
    truncated: z.literal(true).optional(),
  }),
  z.object({
    /**
     * A run of a routine that works in its own conversation, marked in the Mico's main chat.
     * The answer stays in the routine conversation; the marker only links to it. Consecutive
     * markers of one routine fold into one line. Never part of the model's history.
     */
    kind: z.literal("routine_run"),
    fromBotId: Id,
    routineId: Id,
    routineName: z.string(),
    /** The routine conversation (side thread) the run worked in. */
    taskId: Id,
    runId: Id,
    /** How the run ended. Kept as `status`, a key that stays queryable when blocks are sealed. */
    status: z.enum(ROUTINE_RUN_OUTCOMES),
  }),
]);
export type MessageBlock = z.infer<typeof MessageBlock>;

/**
 * Something the bot did on its computer, shown in the terminal's Activity view: a shell
 * command (with a redacted output tail) or a file/app action, whose `command` is the path or
 * app name.
 */
export const COMPUTER_COMMAND_OUTPUT_MAX_CHARS = 16_000;
export const ComputerCommandKind = z.enum([
  "shell",
  "write_file",
  "edit_file",
  "attach_file",
  "open_path",
  "launch_app",
]);
export type ComputerCommandKind = z.infer<typeof ComputerCommandKind>;
export const ComputerCommandSchema = z.object({
  executionId: z.string(),
  kind: ComputerCommandKind,
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "done"]),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  /** Size written by write_file. */
  bytes: z.number().int().nonnegative().optional(),
});
export type ComputerCommand = z.infer<typeof ComputerCommandSchema>;

/**
 * Collapse running/done events into one entry per command, in start order. A finished
 * command stays finished, so history and live events can be merged in either order.
 */
export function foldComputerCommands<T extends ComputerCommand>(events: T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of events) {
    if (byId.get(event.executionId)?.status === "done" && event.status === "running") continue;
    byId.set(event.executionId, event);
  }
  return [...byId.values()];
}

export const ProductEventSchema = z.object({
  id: Id,
  spaceId: Id,
  threadId: Id,
  botId: Id,
  seq: z.number().int().nonnegative(),
  type: ProductEventType,
  runId: Id.optional(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type ProductEvent = z.infer<typeof ProductEventSchema>;

export const ReplyPreviewSchema = z.object({
  role: MessageRole,
  botId: Id.optional(),
  text: z.string(),
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  blocks: z.array(MessageBlock),
  botId: Id.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  replyPreview: ReplyPreviewSchema.nullable().optional(),
  runId: Id.optional(),
  /** Set when the message was sent from a live voice call; groups one call's transcript. */
  callId: z.string().optional(),
  /** Set on a bot's durable mid-turn progress note: not the turn's answer, and it has no actions. */
  progress: z.literal(true).optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}
