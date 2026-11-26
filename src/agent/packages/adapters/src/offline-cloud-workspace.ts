import type { AdapterContext, SandboxProvider } from "@mycellios/adapter-kit";
import { nativeWorkProjectSession } from "@mycellios/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  ensureComputerRecord,
  isOwnedRoutineThread,
  isOwnedWorkflowThread,
  parseComputerMode,
  computerScopeKey,
  type ComputerKeyInput,
  type Prisma,
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
type Lease = { workerId: string; fence: number };
type RoutineRun = Run & { trigger: string; routineId: string | null; isolatedBrowser: boolean };
type NativeCloudFallback = {
  agentEngine?: string | null;
  dataDir?: string;
  piFallback?: () => Promise<boolean>;
};

export class RoutineBrowserComputerError extends Error {}

export async function selectRunCloudWorkspace(
  prisma: PrismaClient, sandbox: SandboxProvider, run: RoutineRun, assignment: Assignment,
  lease: Lease, native: NativeCloudFallback,
) {
  return await selectRoutineCloudWorkspace(prisma, sandbox, run, assignment, lease) ??
    selectOfflineCloudWorkspace(prisma, sandbox, run, assignment, lease, native);
}

function routineCloudKey(run: Run): ComputerKeyInput {
  return {
    mode: "isolated", spaceId: run.spaceId, userId: run.userId, botId: run.botId,
    cloudFallback: true,
  };
}

export async function selectRoutineCloudWorkspace(
  prisma: PrismaClient,
  sandbox: SandboxProvider,
  run: RoutineRun,
  assignment: Assignment,
  lease: Lease,
) {
  // Keep the recorded destination on resume, including runs made before this policy.
  if (!run.isolatedBrowser || run.trigger !== "routine" || !run.routineId ||
    run.cloudComputerId || run.startedAt || run.checkpoint)
    return;
  const routine = {
    id: run.routineId, spaceId: run.spaceId, userId: run.userId, botId: run.botId,
    isolatedBrowser: true,
  };
  const threadKey = `routine:${run.routineId}`;
  const thread = {
    id: run.threadId, spaceId: run.spaceId, userId: run.userId, taskBotId: run.botId,
    taskKey: threadKey, projectKey: threadKey, groupId: null,
    memberUserId: null, externalConversationId: null,
  };
  const [owned, task] = await Promise.all([
    prisma.routine.findFirst({ where: { ...routine, threadId: run.threadId, thread }, select: { id: true } }),
    prisma.task.findUniqueOrThrow({ where: { id: run.taskId }, select: { resources: true } }),
  ]);
  if (!owned || task.resources.some((resource) => resource === "host" || resource.startsWith("workspace:")))
    throw new RoutineBrowserComputerError("The separate browser needs this routine's own conversation and server workspace.");
  if (sandbox.describe().id !== "docker" || !sandbox.pageBrowser)
    throw new RoutineBrowserComputerError("A managed Docker browser is unavailable for this routine.");
  // Existing private Docker computers already meet the runtime boundary.
  if (assignment?.scope === "isolated" && assignment.kind === "docker") return;

  return pinCloudWorkspace(prisma, run, assignment, lease, {
    computer: { ...routineCloudKey(run), kind: "docker" },
    where: { routine: { ...routine, threadId: run.threadId, thread } },
    notice: "This routine uses a separate server computer with its own files.",
    noticeKey: "routine-cloud",
    piFallback: true,
  });
}

export async function selectOfflineCloudWorkspace(
  prisma: PrismaClient,
  sandbox: SandboxProvider | undefined,
  run: Run,
  assignment: Assignment,
  lease: Lease,
  /** The Mico's engine and the server data folder holding the operator's native-agent grants. */
  native: NativeCloudFallback = {},
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
    const routineWorkspace = computer.scopeKey === computerScopeKey(routineCloudKey(run));
    if (routineWorkspace && (computer.kind !== "docker" || sandbox?.describe().id !== "docker" || !sandbox.pageBrowser))
      throw new RoutineBrowserComputerError("A managed Docker browser is unavailable for this routine.");
    return { ...computer, piFallback: routineWorkspace || await withoutGrant() };
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

  return pinCloudWorkspace(prisma, run, assignment, lease, {
    computer: {
      mode: assignment ? parseComputerMode(assignment.scope) : "dedicated",
      spaceId, userId, botId, kind: provider, cloudFallback: true,
    },
    notice: piFallback ? offlineEngineFallbackNotice(native.agentEngine!) : OFFLINE_CLOUD_NOTICE,
    noticeKey: "offline-cloud",
    piFallback,
  });
}

async function pinCloudWorkspace(
  prisma: PrismaClient,
  run: Run,
  assignment: Assignment,
  lease: Lease,
  options: {
    computer: ComputerKeyInput & { kind: string };
    where?: Prisma.RunWhereInput;
    notice: string;
    noticeKey: string;
    piFallback: boolean;
  },
) {
  const { spaceId, userId, botId } = run;
  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    const computer = await ensureComputerRecord(tx, options.computer);
    const selected = await tx.run.updateMany({
      where: {
        ...options.where,
        id: run.id, spaceId, userId, botId, status: "running",
        leaseOwner: lease.workerId, leaseFence: lease.fence, leaseExpiresAt: { gt: new Date() },
        cloudComputerId: null,
        bot: { archivedAt: null, computerSwitching: false, computerId: assignment?.id ?? null },
      },
      data: { cloudComputerId: computer.id },
    });
    if (selected.count !== 1) throw new Error("The run or its computer assignment changed");
    const blocks = [{ kind: "meta" as const, text: options.notice }];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: run.threadId, botId, role: "system", blocks,
      clientNonce: `${options.noticeKey}:${run.id}`, markUnread: false,
    });
    await appendEventInTransaction(tx, {
      spaceId, threadId: run.threadId, botId, type: "thread.message.created",
      payload: { messageId: message.id, role: "system", blocks },
    });
    return { ...computer, piFallback: options.piFallback };
  }));
}
