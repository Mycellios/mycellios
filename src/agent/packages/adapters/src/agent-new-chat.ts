import { z } from "zod";
import { effectiveMicoSettings } from "@rakazo/contracts";
import { resetThreadContext, ThreadContextBusyError, type PrismaClient } from "@rakazo/db";
import type { ConnectorTool } from "@rakazo/adapter-kit";

export const AgentChatNotes = z.object({ notes: z.string().trim().min(20).max(12000) }).strict();
export const agentNewChatTool: ConnectorTool = {
  name: "start_new_chat",
  description: "Request fresh context after completing this task in a long personal chat. Supply concise handoff notes with decisions, constraints, relevant files, results and unfinished work. The host saves notes before changing context, waits for an idle chat and preserves history. This does not launch a new task.",
  inputSchema: z.toJSONSchema(AgentChatNotes),
};
type Target = { userId: string; spaceId: string; botId: string; threadId: string };
const requestSchema = AgentChatNotes.extend({ runId: z.string() });

/** Persist the handoff atomically with the request. A lost lease cannot rotate context. */
export function requestAgentNewChat(db: PrismaClient, target: Target, lease: { runId: string; owner: string; fence: number }, raw: unknown) {
  const { notes } = AgentChatNotes.parse(raw);
  return db.$transaction(async tx => {
    const thread = await tx.thread.update({ where: { id: target.threadId, userId: target.userId, spaceId: target.spaceId, botId: target.botId, AND: [{ groupId: null }] },
      data: { nextMessageSeq: { increment: 0 } }, select: { nextMessageSeq: true, contextStartSeq: true } });
    const [bot, user, run] = await Promise.all([
      tx.bot.findFirst({ where: { id: target.botId, userId: target.userId, spaceId: target.spaceId, archivedAt: null }, select: { micoPreferences: true } }),
      tx.user.findUniqueOrThrow({ where: { id: target.userId }, select: { micoDefaults: true } }),
      tx.run.updateMany({ where: { id: lease.runId, threadId: target.threadId, botId: target.botId, userId: target.userId, spaceId: target.spaceId,
        status: "running", leaseOwner: lease.owner, leaseFence: lease.fence, trigger: "user" }, data: { leaseFence: { increment: 0 } } }),
    ]);
    if (!bot || run.count !== 1 || !effectiveMicoSettings(user.micoDefaults, bot.micoPreferences).agentNewChat) throw new Error("Starting new chats is not enabled for this Mico or run.");
    if (thread.nextMessageSeq - thread.contextStartSeq < 40) throw new Error("This chat is still short. Continue in the current context.");
    await tx.thread.update({ where: { id: target.threadId }, data: { agentContextReset: { runId: lease.runId, notes } } });
    return { scheduled: true, message: "Notes saved. Fresh context will begin after this task completes and the chat is idle. No new run is started." };
  });
}

/** Best effort only after successful completion; queued/pending tasks keep their context. */
export async function finishAgentNewChat(db: PrismaClient, target: Target) {
  const thread = await db.thread.findFirst({ where: { id: target.threadId, userId: target.userId, spaceId: target.spaceId, botId: target.botId }, select: { agentContextReset: true } });
  const parsed = requestSchema.safeParse(thread?.agentContextReset);
  if (!parsed.success) return null;
  try {
    const result = await resetThreadContext(db, target, { threadId: target.threadId, botId: target.botId,
      clientNonce: `agent:${parsed.data.runId}`, agentRequest: parsed.data });
    return result.eventSeq === null ? null : result;
  } catch (error) {
    if (error instanceof ThreadContextBusyError) return null;
    throw error;
  }
}
