import { runContinueJob, runJobKey } from "@mycellios/adapter-kit";
import {
  AGENT_TASK_INPUT_ERROR,
  AGENT_TASK_MESSAGE_INPUT_ERROR,
  AGENT_TASK_NOT_AVAILABLE_ERROR,
  AGENT_TASK_QUEUE_ERROR,
  AGENT_TASK_STILL_RUNNING_ERROR,
  parseAgentTaskText,
  parseAgentTaskTitle,
  startTaskNote,
  THREAD_ARCHIVE_SETTLE_MS,
  taskThreadKind,
} from "@mycellios/core";
import {
  AgentTaskError,
  type AgentTaskSource,
  archiveSideThreadInTransaction,
  controlWorkTree,
  isOwnedRoutineThread,
  messageAgentTask,
  type PrismaClient,
  startAgentTask,
  stopAgentTaskRuns,
  ThreadLifecycleError,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { loadBotMessageContext, settleAgentTaskTeammateReply } from "./bot-messages.js";
import type { ExecutorDeps } from "./executor.js";
import { reconcileWorkStops } from "./work-stop-reconciler.js";

export const AGENT_TASK_TOOL_NAMES = ["start_task", "message_task", "close_task"] as const;
export type AgentTaskToolName = (typeof AGENT_TASK_TOOL_NAMES)[number];

export function isAgentTaskToolName(name: string): name is AgentTaskToolName {
  return (AGENT_TASK_TOOL_NAMES as readonly string[]).includes(name);
}

type TaskDeps = Pick<ExecutorDeps, "prisma" | "events" | "jobs"> & Partial<Pick<ExecutorDeps, "sandbox">>;

/**
 * Tasks are started, messaged and closed only from the Mico's own main chat or one of its
 * own routine conversations: never a side conversation, a group, an outside messaging chat,
 * background work or the creation intro.
 */
export async function agentTaskToolsAllowed(
  prisma: PrismaClient,
  run: { spaceId: string; userId: string; botId: string; trigger: string },
  thread: {
    id: string;
    botId: string | null;
    groupId: string | null;
    externalConversationId: string | null;
    taskBotId: string | null;
    projectKey: string | null;
    taskKey: string | null;
  },
  options: { messagingChannelRun: boolean; backgroundRun: boolean },
): Promise<boolean> {
  if (options.messagingChannelRun || options.backgroundRun || run.trigger === "created") return false;
  if (thread.groupId || thread.externalConversationId) return false;
  if (thread.botId === run.botId) return true;
  return (
    thread.taskBotId === run.botId &&
    taskThreadKind(thread) === "routine" &&
    (await isOwnedRoutineThread(prisma, run, thread))
  );
}

async function teammateNames(prisma: PrismaClient, source: { trigger: string; sourceMessageId?: string | null }) {
  if (source.trigger !== "bot_message") return [];
  const context = await loadBotMessageContext(prisma, source.sourceMessageId);
  const intent = context?.intent ?? "request";
  return context && (intent === "request" || intent === "question") ? [context.fromBotName] : [];
}

async function wake(deps: TaskDeps, threadId: string, queued: { runId: string | null; eventSeq: number | null }) {
  if (queued.eventSeq !== null)
    await deps.events.notify(threadId, queued.eventSeq).catch((error) => getLogger().error("task realtime notification", error));
  // The queued run is durable; the job reconciler starts it if this enqueue is lost.
  if (queued.runId)
    await deps.jobs.enqueue(runContinueJob(queued.runId)).catch((error) => getLogger().error("task enqueue", error));
}

/** Runs start_task, message_task or close_task for the executing turn; returns the tool result. */
export async function runAgentTaskTool(
  deps: TaskDeps,
  source: AgentTaskSource & { trigger: string; sourceMessageId?: string | null },
  bot: { id: string; name: string },
  name: AgentTaskToolName,
  args: Record<string, unknown>,
  key: string,
): Promise<Record<string, unknown>> {
  if (name === "start_task") {
    const title = parseAgentTaskTitle(args.title);
    const brief = parseAgentTaskText(args.brief);
    if (!title || !brief) return { error: AGENT_TASK_INPUT_ERROR };
    let started: Awaited<ReturnType<typeof startAgentTask>>;
    try {
      started = await startAgentTask(deps.prisma, source, { key, title, brief, botName: bot.name });
    } catch (error) {
      if (error instanceof AgentTaskError) return { error: error.message };
      // Nothing was committed: the task does not exist, so the work stays in this turn.
      getLogger().error("start_task", error);
      return { error: AGENT_TASK_QUEUE_ERROR };
    }
    await wake(deps, started.taskId, started);
    return {
      taskId: started.taskId,
      title: started.title,
      // The work moved to the task; nothing here should keep the turn going for it.
      waitingForTasks: true,
      note: startTaskNote({ teammateNames: await teammateNames(deps.prisma, source) }),
    };
  }
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!taskId) return { error: AGENT_TASK_NOT_AVAILABLE_ERROR };
  if (name === "message_task") {
    const text = parseAgentTaskText(args.text);
    if (!text) return { error: AGENT_TASK_MESSAGE_INPUT_ERROR };
    try {
      const sent = await messageAgentTask(deps.prisma, source, { key, taskId, text, botName: bot.name });
      await wake(deps, sent.taskId, sent);
      return { taskId: sent.taskId, state: sent.state, waitingForTasks: true };
    } catch (error) {
      if (error instanceof AgentTaskError || error instanceof ThreadLifecycleError) return { error: error.message };
      throw error;
    }
  }
  return closeAgentTask(deps, source, taskId);
}

/** Cancels work the task delegated to other Micos, best effort; its own runs stop separately. */
async function stopDelegatedWork(prisma: PrismaClient, scope: { spaceId: string; userId: string }, threadId: string) {
  const tasks = await prisma.task.findMany({
    where: { ...scope, threadId, delegationState: { in: ["queued", "running", "waiting", "waiting_event"] } },
    select: { id: true, delegationRevision: true },
    take: 25,
  });
  for (const task of tasks) {
    await controlWorkTree(prisma, scope, { taskId: task.id, expectedRevision: task.delegationRevision, action: "cancel" })
      .catch((error) => getLogger().error("close_task delegated work", error));
  }
}

/**
 * close_task: drop the task's queue and stop its runs (their computer work goes through the
 * durable teardown outbox), then archive it. Work that starts again meanwhile is stopped
 * again for up to 15 seconds; after that the close fails and says the task still runs. A task
 * the Mico closes sends no report; a teammate waiting on it still gets what exists.
 */
export async function closeAgentTask(
  deps: TaskDeps,
  source: AgentTaskSource,
  taskId: string,
  options: { settleMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<Record<string, unknown>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.settleMs ?? THREAD_ARCHIVE_SETTLE_MS);
  const scope = { spaceId: source.spaceId, userId: source.userId };
  let requestRunId: string | null = null;
  for (;;) {
    let stopped: Awaited<ReturnType<typeof stopAgentTaskRuns>>;
    try {
      stopped = await stopAgentTaskRuns(deps.prisma, source, taskId);
    } catch (error) {
      if (error instanceof AgentTaskError) return { error: error.message };
      throw error;
    }
    requestRunId = stopped.startedByRunId;
    if (stopped.eventSeq !== null)
      await deps.events.notify(taskId, stopped.eventSeq).catch((error) => getLogger().error("close_task notification", error));
    await Promise.allSettled(stopped.runIds.map((runId) => deps.jobs.cancel(runJobKey(runId))));
    await stopDelegatedWork(deps.prisma, scope, taskId);
    let tornDown = true;
    if (stopped.teardownTaskIds.length && deps.sandbox) {
      try {
        await reconcileWorkStops(
          { prisma: deps.prisma, sandbox: deps.sandbox, jobs: deps.jobs, events: deps.events },
          { ...scope, taskIds: stopped.teardownTaskIds },
        );
      } catch (error) {
        // The outbox keeps the teardown; the reconciler retries it.
        getLogger().warn("close_task teardown pending", { error: String(error) });
        tornDown = false;
      }
    }
    if (tornDown) {
      try {
        await deps.prisma.$transaction((tx) =>
          archiveSideThreadInTransaction(tx, scope, { botId: source.botId, threadId: taskId }),
        );
        break;
      } catch (error) {
        if (!(error instanceof ThreadLifecycleError)) throw error;
        if (error.code !== "busy") return { error: AGENT_TASK_NOT_AVAILABLE_ERROR };
      }
    }
    if (now() >= deadline) return { error: AGENT_TASK_STILL_RUNNING_ERROR };
    await sleep(options.pollMs ?? 500);
  }
  if (requestRunId)
    await settleAgentTaskTeammateReply(deps, requestRunId).catch((error) =>
      getLogger().error("close_task teammate reply", error),
    );
  return {
    taskId,
    closed: true,
    note: "The task is stopped and archived. No report will come from it; the person can still read it.",
  };
}
