import type { BranchConversationOutput, MessageBlock, ThreadMessage } from "@mycellios/contracts";
import { isPeerReceiptBlocks, messageReaction } from "@mycellios/core";
import type { RpcClient } from "./rpc";
import {
  type ConversationRow,
  openTab,
  updateConversationTabs,
  writeConversationRows,
} from "./thread-tabs";

/**
 * Branching from the web: which messages offer "Branch in new conversation", the request id a
 * retry reuses, and where the new tab goes (right after the tab it was branched from).
 */

type BranchMessage = Pick<
  ThreadMessage,
  "id" | "role" | "blocks" | "replyToMessageId" | "progress"
>;

/** A divider or a message the person wrote (not a reaction) starts the next turn. */
function startsTurn(message: BranchMessage) {
  if (message.role === "system") return true;
  return message.role === "user" && !messageReaction(message);
}

/** A saved Mico message that carries its own hover actions (not a live row, note or receipt). */
function branchTarget(message: BranchMessage) {
  return (
    message.role === "bot" &&
    !message.id.includes(":") &&
    !message.progress &&
    message.blocks.length > 0 &&
    !isPeerReceiptBlocks(message.blocks)
  );
}

/**
 * The last Mico message of each turn in the loaded transcript. Older turns qualify too: a
 * branch can start from any finished turn. The caller disables them while a turn runs.
 */
export function branchableMessageIds(messages: readonly BranchMessage[]): Set<string> {
  const ids = new Set<string>();
  let last: string | null = null;
  for (const message of messages) {
    if (startsTurn(message)) {
      if (last) ids.add(last);
      last = null;
    } else if (branchTarget(message)) last = message.id;
  }
  if (last) ids.add(last);
  return ids;
}

export type BranchOriginBlock = Extract<MessageBlock, { kind: "branch_origin" }>;

export function branchOriginBlock(
  message: Pick<ThreadMessage, "role" | "blocks">,
): BranchOriginBlock | null {
  if (message.role !== "system") return null;
  const block = message.blocks.find((item) => item.kind === "branch_origin");
  return block?.kind === "branch_origin" ? block : null;
}

/** The source a branch divider names: the main chat, a conversation still there, or a gone one. */
export function branchSource(
  block: BranchOriginBlock,
  rows: readonly ConversationRow[],
  current: ConversationRow | undefined,
): { kind: "main" } | { kind: "conversation"; title: string } | { kind: "deleted" } {
  if (block.main) return { kind: "main" };
  // The server clears the link once the source is removed.
  if (current?.startedBy === "branch" && current.branchedFromThreadId === null)
    return { kind: "deleted" };
  const row = rows.find((item) => item.threadId === block.threadId);
  if (row?.deleteAfter) return { kind: "deleted" };
  return { kind: "conversation", title: row?.title || block.title };
}

// One id per message until its branch is made, so a retry after a lost answer gets the same branch.
const pendingRequests = new Map<string, string>();
const requestKey = (scope: string, source: string | undefined, messageId: string) =>
  JSON.stringify([scope, source ?? "main", messageId]);

export function branchRequestId(
  scope: string,
  source: string | undefined,
  messageId: string,
): string {
  const key = requestKey(scope, source, messageId);
  let id = pendingRequests.get(key);
  if (!id) {
    id = crypto.randomUUID();
    pendingRequests.set(key, id);
  }
  return id;
}

export function forgetBranchRequest(scope: string, source: string | undefined, messageId: string) {
  pendingRequests.delete(requestKey(scope, source, messageId));
}

/**
 * The new tab goes right after the tab it was branched from (first when that is the main
 * chat), with its title known at once, before the list is read again.
 */
export function openBranchTab(
  scope: string,
  source: string | undefined,
  branch: Pick<BranchConversationOutput, "threadId" | "title">,
) {
  updateConversationTabs(scope, (state) => {
    const ids = state.ids.filter((id) => id !== branch.threadId);
    const at = source ? ids.indexOf(source) : -1;
    const index = source ? (at < 0 ? ids.length : at + 1) : 0;
    return openTab({ ...state, ids }, branch.threadId, index);
  });
  const now = new Date().toISOString();
  writeConversationRows(scope, (rows) =>
    rows.some((row) => row.threadId === branch.threadId)
      ? rows
      : [
          ...rows,
          {
            threadId: branch.threadId,
            title: branch.title,
            kind: "conversation",
            startedBy: "branch",
            titleSource: "auto",
            state: "idle",
            archived: false,
            archivedAt: null,
            deleteAfter: null,
            unread: false,
            branchedFromThreadId: source ?? null,
            createdAt: now,
            updatedAt: now,
          },
        ],
  );
}

/** Asks the server for the branch and opens its tab; the caller then shows it. */
export async function branchConversation(options: {
  rpc: Pick<RpcClient, "development">;
  scope: string;
  botId: string;
  /** The side conversation shown, or nothing for the main chat. */
  source: string | undefined;
  messageId: string;
}): Promise<BranchConversationOutput> {
  const requestId = branchRequestId(options.scope, options.source, options.messageId);
  const result = await options.rpc.development.branch({
    botId: options.botId,
    ...(options.source ? { taskThreadId: options.source } : {}),
    messageId: options.messageId,
    requestId,
  });
  forgetBranchRequest(options.scope, options.source, options.messageId);
  openBranchTab(options.scope, options.source, result);
  return result;
}
