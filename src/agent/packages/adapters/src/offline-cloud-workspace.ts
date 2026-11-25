import type { AdapterContext, SandboxProvider } from "@mycellios/adapter-kit";
import { nativeWorkProjectSession } from "@mycellios/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  ensureComputerRecord,
  isOwnedRoutineThread,
  isOwnedWorkflowThread,
  parseComputerMode,
  type PrismaClient,
  withTransactionRetry,
} from "@mycellios/db";
import { DesktopUnreachableError } from "./computer-errors.js";
import { nativeHostAccess } from "./native-agent-runtime.js";

/** Shown in the chat when a This PC Mico's new message runs on the server instead. */
export const OFFLINE_CLOUD_NOTICE =
  "This PC is offline, so this message runs on the server, without this PC's files.";

const ENGINE_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", acp: "the PC's agent" };
/** Shown instead when the Mico's CLI lives on that PC and its saved model answers on the server. */
export function offlineEngineFallbackNotice(engine: string) {
  return `This PC is offline, so this message runs on the server with this Mico's saved model instead of ${ENGINE_NAMES[engine] ?? "the PC's agent"}, without this PC's files.`;
}

type Run = Pick<NonNullable<Awaited<ReturnType<PrismaClient["run"]["findUnique"]>>>,
  "id" | "spaceId" | "userId" | "botId" | "threadId" | "taskId" | "startedAt" | "checkpoint" | "cloudComputerId">;
type Assignment = { id: string; scope: string; kind: string } | null;

export async function selectOfflineCloudWorkspace(
  prisma: PrismaClient,
  sandbox: SandboxProvider | undefined,
  run: Run,
  assignment: Assignment,
  lease: { workerId: string; fence: number },
  /** The Mico's engine and the server data folder holding the operator's native-agent grants. */
  native: { agentEngine?: string | null; dataDir?: string; piFallback?: () => Promise<boolean> } = {},
) {
  const { spaceId, userId, botId } = run;
  // A native engine runs on the server only with the operator's grant for this user and
  // Space. Without it the turn answers with the Mico's saved Pi model there, and without
  // one either it keeps the PC's offline message instead of failing.
  const withoutGrant = async () => Boolean(native.agentEngine && native.agentEngine !== "pi") &&
    !(await nativeHostAccess(native.dataDir, { userId, spaceId }).catch(() => false));
  if (run.cloudComputerId) {
    const computer = await prisma.computer.findFirstOrThrow({
      where: { id: run.cloudComputerId, spaceId, userId, scopeKey: { startsWith: "cloud:" } },
    });
    // A turn moved before its engine was recorded resumes on the same server fallback.
    return { ...computer, piFallback: await withoutGrant() };
  }

  // A new message may choose a different host. An interrupted run must keep its host.
  if (!sandbox?.provisionKind || run.startedAt || run.checkpoint || (assignment && assignment.kind !== "desktop")) return;
  const provider = sandbox.describe().id;
  if (provider === "none" || provider === "desktop") return;
  const piFallback = await withoutGrant();
  if (piFallback && !(await native.piFallback?.().catch(() => false))) return;
  const signal = AbortSignal.timeout(5_000);
  const context: AdapterContext = {
    operationId: run.id, traceId: run.id, runId: run.id, spaceId, userId, botId, signal,
  };
  // Only a PC that is really offline moves the turn. A PC that is online without this
  // Mico (several PCs, none clearly its own) is the owner's choice, not an outage.
  const presence = await (sandbox.hostPresence
    ? sandbox.hostPresence(context)
    : sandbox.provisionKind(context).then((kind) => kind !== provider ? "connected" : "offline")
  ).catch((error: unknown) => {
    // Running out of time is no answer: the PC may be online, so this message must not move
    // to a server workspace. The caller retries it as a setup failure.
    throw signal.aborted && !(error instanceof DesktopUnreachableError)
      ? new DesktopUnreachableError({ cause: error })
      : error;
  });
  if (presence !== "offline") return;

  const [thread, task] = await Promise.all([
    prisma.thread.findUniqueOrThrow({ where: { id: run.threadId } }),
    prisma.task.findUniqueOrThrow({ where: { id: run.taskId } }),
  ]);
  if (task.resources.some((resource) => resource === "host" || resource.startsWith("workspace:"))) return;
  if (nativeWorkProjectSession(thread, task) &&
    !(await isOwnedRoutineThread(prisma, run, thread)) &&
    !(await isOwnedWorkflowThread(prisma, run, thread))) return;

  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    const computer = await ensureComputerRecord(tx, {
      mode: assignment ? parseComputerMode(assignment.scope) : "dedicated",
      spaceId, userId, botId, kind: provider, cloudFallback: true,
    });
    const selected = await tx.run.updateMany({
      where: {
        id: run.id, spaceId, userId, botId, status: "running",
        leaseOwner: lease.workerId, leaseFence: lease.fence, leaseExpiresAt: { gt: new Date() },
        cloudComputerId: null,
        bot: { archivedAt: null, computerSwitching: false, computerId: assignment?.id ?? null },
      },
      data: { cloudComputerId: computer.id },
    });
    if (selected.count !== 1) throw new Error("The run or its computer assignment changed");
    // The owner chose This PC; say in the chat that this message did not run there.
    const blocks = [{ kind: "meta" as const,
      text: piFallback ? offlineEngineFallbackNotice(native.agentEngine!) : OFFLINE_CLOUD_NOTICE }];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: run.threadId, botId, role: "system", blocks,
      clientNonce: `offline-cloud:${run.id}`, markUnread: false,
    });
    await appendEventInTransaction(tx, {
      spaceId, threadId: run.threadId, botId, type: "thread.message.created",
      payload: { messageId: message.id, role: "system", blocks },
    });
    return { ...computer, piFallback };
  }));
}
