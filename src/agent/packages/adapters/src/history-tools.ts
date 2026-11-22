import {
  type HistoryReadInput,
  HistoryReadInputSchema,
  type HistorySearchInput,
  HistorySearchInputSchema,
} from "@mycellios/contracts";
import {
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR,
  HISTORY_LIST_NOT_AVAILABLE_ERROR,
} from "@mycellios/core";
import {
  findPinTarget,
  isMicoConversation,
  isOwnedAgentTask,
  listHistoryConversations,
  MessagePinError,
  micoConversationOfMessage,
  type PrismaClient,
  readHistory,
  readHistoryPage,
  searchHistory,
  searchHistoryAcross,
  setAgentMessagePin,
} from "@mycellios/db";

/**
 * How far a run's history tools reach: across the Mico's own conversations, into the
 * conversations it opened itself (a routine thread), or only the conversation it runs in.
 */
export type HistoryAccess = "across" | "own_tasks" | "current";

export interface HistoryToolRun {
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
}

/**
 * search_history and read_history for one turn. Scope (owner, Space, Mico, thread and the
 * current request's boundary) comes from the executor; arguments only pick within it.
 * Returns the untrusted result, or a refusal the model reads.
 */
export async function runHistoryTool(
  prisma: PrismaClient,
  input: {
    name: "search_history" | "read_history";
    args: Record<string, unknown>;
    run: HistoryToolRun;
    access: HistoryAccess;
    channelId?: string;
    searchBeforeSeq?: number;
  },
): Promise<Record<string, unknown>> {
  const { run, access } = input;
  const fence = { spaceId: run.spaceId, userId: run.userId, botId: run.botId };
  const parsed =
    input.name === "search_history"
      ? HistorySearchInputSchema.parse(input.args)
      : HistoryReadInputSchema.parse(input.args);
  let taskId = parsed.taskId && parsed.taskId !== run.threadId ? parsed.taskId : undefined;
  if (taskId) {
    const available =
      access === "across"
        ? await isMicoConversation(prisma, fence, taskId)
        : access === "own_tasks" && (await isOwnedAgentTask(prisma, fence, taskId));
    if (!available)
      return {
        untrusted: true,
        error: access === "own_tasks" ? AGENT_TASK_NOT_AVAILABLE_ERROR : HISTORY_CONVERSATION_NOT_AVAILABLE_ERROR,
      };
  }
  const readInput = input.name === "read_history" ? (parsed as HistoryReadInput) : undefined;
  // A message id from another of the Mico's conversations reads there.
  if (readInput?.messageId && !taskId && access === "across") {
    const owner = await micoConversationOfMessage(prisma, fence, readInput.messageId);
    if (owner && owner !== run.threadId) taskId = owner;
  }
  const scope = {
    ...fence,
    threadId: taskId ?? run.threadId,
    ...(taskId ? {} : { channelId: input.channelId, searchBeforeSeq: input.searchBeforeSeq }),
  };
  if (input.name === "search_history") {
    const search = parsed as HistorySearchInput;
    if (!search.query) {
      if (access !== "across" || taskId) return { untrusted: true, error: HISTORY_LIST_NOT_AVAILABLE_ERROR };
      return listHistoryConversations(prisma, { ...fence, currentThreadId: run.threadId }, search);
    }
    // A continuation (beforeSeq) or a taskId stays in one conversation.
    if (access === "across" && !taskId && search.beforeSeq === undefined)
      return searchHistoryAcross(prisma, scope, search);
    return searchHistory(prisma, scope, { ...search, ...(taskId ? { taskId } : {}) });
  }
  if (readInput?.messageId) return readHistory(prisma, scope, { ...readInput, messageId: readInput.messageId });
  return readHistoryPage(prisma, scope, readInput ?? {});
}

export const PIN_MESSAGE_INPUT_ERROR =
  "Give the messageId of a message in this conversation, or a quote of 1 to 500 characters from its text.";
export const PIN_MESSAGE_NOT_FOUND_ERROR =
  "No message in this conversation matches. Check the messageId, or quote text exactly as it appears in the message.";

/**
 * pin_message for one turn: pins or unpins a person or Mico message in the conversation the
 * run is in, marked as the Mico's. The executor offers it only in the Mico's own main chat
 * and side conversations; the database checks that again.
 */
export async function runPinMessageTool(
  prisma: PrismaClient,
  input: {
    run: HistoryToolRun;
    thread: { id: string; contextStartSeq: number };
    args: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const messageId = typeof input.args.messageId === "string" ? input.args.messageId.trim() : "";
  const quote = typeof input.args.quote === "string" ? input.args.quote.trim() : "";
  const pinned = input.args.pinned !== false;
  if ((!messageId && !quote) || quote.length > 500) return { error: PIN_MESSAGE_INPUT_ERROR };
  const target = await findPinTarget(prisma, input.thread, messageId ? { messageId } : { quote });
  if (!target) return { error: PIN_MESSAGE_NOT_FOUND_ERROR };
  try {
    const result = await setAgentMessagePin(
      prisma,
      { spaceId: input.run.spaceId, userId: input.run.userId, botId: input.run.botId },
      input.thread.id,
      target.messageId,
      pinned,
    );
    return {
      messageId: target.messageId,
      author: target.role === "user" ? "person" : "you",
      state: result.state,
      ...(result.pinnedBy ? { pinnedBy: result.pinnedBy } : {}),
    };
  } catch (error) {
    if (error instanceof MessagePinError) return { error: error.message };
    throw error;
  }
}
