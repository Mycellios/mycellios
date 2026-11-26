import { ACTIVE_RUN_STATUSES, DELEGATED_RESULT_FORMAT, escapePromptData, isInterruptedRunError, isMicoTaskThread, normalizeRunError, normalizeWorkResources, workResourcesConflict } from "@mycellios/core";
import { micoTurnLimit, nativeConcurrencyEnabled, slotRunsWhere } from "./mico-concurrency.js";
import type { PrismaClient, Prisma } from "./client.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";
import { eventWaitReceipt, eventWaitState, eventWaitWakeNote, INTERRUPTED_TURN_RECOVERY_DELAYS_MS, INTERRUPTED_TURN_RECOVERY_NOTE,
  resolveEventWaitTasks, WORK_RECOVERY_MARKER, WORK_RETURN_MARKER } from "./event-waits.js";
import { reopenThreadForWakeInTransaction } from "./thread-lifecycle.js";

type Scope = { spaceId: string; userId: string };
type Source = Scope & { id: string; taskId: string; botId: string; threadId: string; leaseOwner: string; leaseFence: number };

const RECOVERY_NONCE = "work-recovery:";
const RUN_ERROR_LIMIT = 500;

/** Why a delegated execution failed, as the person would read it; never a prompt or raw payload. */
function runFailure(error: string | null | undefined): string | undefined {
  if (!error?.trim()) return undefined;
  const summary = normalizeRunError(error).summary.trim();
  return summary.length > RUN_ERROR_LIMIT ? `${summary.slice(0, RUN_ERROR_LIMIT)}…` : summary;
}

type ReturnTask = { id: string; spaceId: string; userId: string; botId: string; threadId: string;
  returnRunId: string | null; paused: boolean; workStopPending: boolean };
type ReturnRun = { id: string; trigger: string; status: string; error: string | null; completedAt: Date | null };

/** When an interrupted work return starts again, or undefined when it ends as it is. */
async function interruptedReturnWakeAt(db: Pick<Prisma.TransactionClient, "run" | "bot" | "thread">,
  task: ReturnTask, run: ReturnRun, now: Date): Promise<Date | undefined> {
  if (run.id !== task.returnRunId || run.trigger !== "task_return" || run.status !== "failed" ||
      task.paused || task.workStopPending || !isInterruptedRunError(run.error)) return undefined;
  const recent = await db.run.findMany({ where: { taskId: task.id, trigger: "task_return" },
    orderBy: { createdAt: "desc" }, take: INTERRUPTED_TURN_RECOVERY_DELAYS_MS.length + 1, select: { clientNonce: true } });
  const leading = recent.findIndex(row => !row.clientNonce?.startsWith(RECOVERY_NONCE));
  const delay = INTERRUPTED_TURN_RECOVERY_DELAYS_MS[leading < 0 ? recent.length : leading];
  if (delay === undefined) return undefined;
  const scope = { spaceId: task.spaceId, userId: task.userId };
  const [bot, thread] = await Promise.all([
    db.bot.findFirst({ where: { id: task.botId, ...scope, archivedAt: null }, select: { id: true } }),
    db.thread.findFirst({ where: { id: task.threadId, ...scope, deleteAfter: null }, select: { id: true } }),
  ]);
  if (!bot || !thread) return undefined;
  return new Date(Math.max(now.getTime(), (run.completedAt ?? now).getTime() + delay));
}

/** Whether the work reconciler will start this failed work return again, so it need not alert yet. */
export async function workReturnWillRecover(prisma: PrismaClient, runId: string, now = new Date()): Promise<boolean> {
  const run = await prisma.run.findUnique({ where: { id: runId },
    select: { id: true, trigger: true, status: true, error: true, completedAt: true, taskId: true } });
  if (!run || run.trigger !== "task_return") return false;
  const task = await prisma.task.findUnique({ where: { id: run.taskId } });
  if (!task || task.delegationState !== "running") return false;
  const children = await prisma.task.findMany({ where: { parentTaskId: task.id, spaceId: task.spaceId, userId: task.userId },
    select: { delegationState: true } });
  if (children.some(child => !["completed", "failed", "cancelled", "paused"].includes(child.delegationState ?? ""))) return false;
  return Boolean(await interruptedReturnWakeAt(prisma, task, run, now));
}
export async function saveWorkState(prisma: PrismaClient, source: Source, state: unknown) {
  const saved = await prisma.task.updateMany({ where: { id: source.taskId, spaceId: source.spaceId,
    userId: source.userId, botId: source.botId, paused: false, runs: { some: { id: source.id,
      status: "running", leaseOwner: source.leaseOwner, leaseFence: source.leaseFence } } },
    data: { workPlan: state as Prisma.InputJsonValue } });
  if (saved.count !== 1) throw new IsolationError("Work state lost its execution owner");
}
async function lock(tx: Prisma.TransactionClient, scope: Scope) {
  // One scoped admission transaction serializes dependency/resource changes across workers.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`work:${scope.spaceId}:${scope.userId}`}, 0))`;
}

export async function delegateWork(prisma: PrismaClient, source: Source, input: {
  key: string; botId: string; instruction: string; expectedResult: string;
  resources?: string[]; dependencies?: string[];
}) {
  if (!input.key || input.instruction.length > 32000 || !input.instruction.trim() ||
      !input.expectedResult.trim() || input.expectedResult.length > 8000)
    throw new Error("A delegation needs a bounded instruction and expected result");
  const resources = normalizeWorkResources(input.resources?.length ? input.resources : ["host"]);
  const dependencies = [...new Set(input.dependencies ?? [])];
  if (dependencies.length > 16) throw new Error("At most 16 dependencies are supported");
  return withTransactionRetry(() => prisma.$transaction(async tx => {
    await lock(tx, source);
    const existing = await tx.task.findFirst({ where: { delegationKey: input.key, spaceId: source.spaceId, userId: source.userId } });
    if (existing) return { taskId: existing.id, replayed: true, waitingForTasks: true };
    await tx.$queryRaw`SELECT id FROM runs WHERE id = ${source.id} AND "spaceId" = ${source.spaceId} AND "userId" = ${source.userId} FOR UPDATE`;
    const run = await tx.run.findFirst({ where: { id: source.id, taskId: source.taskId, botId: source.botId,
      threadId: source.threadId, spaceId: source.spaceId, userId: source.userId, status: "running",
      leaseOwner: source.leaseOwner, leaseFence: source.leaseFence } });
    if (!run) throw new IsolationError("The source execution no longer owns this task");
    const unsettled = await tx.externalEffect.findFirst({ where: { runId: source.id, kind: "shell", OR: [
      { status: { in: ["executing", "uncertain"] } },
      { status: "completed", result: { path: ["running"], equals: true } },
      { status: "completed", result: { path: ["uncertain"], equals: true } },
    ] }, select: { id: true } });
    if (unsettled) throw new Error("A command still runs or has no confirmed outcome. Inspect command_status and settle its result before delegating overlapping work");
    const parent = await tx.task.findFirst({ where: { id: source.taskId, spaceId: source.spaceId, userId: source.userId, paused: false } });
    const bot = await tx.bot.findFirst({ where: { id: input.botId, spaceId: source.spaceId, userId: source.userId, archivedAt: null }, include: { thread: true } });
    if (!parent || !bot?.thread || bot.id === source.botId) throw new IsolationError("Choose another available Mico in this Space");
    const root = parent.delegationRootId ?? parent.id;
    const parentThread=await tx.thread.findFirst({where:{id:parent.threadId,spaceId:source.spaceId,userId:source.userId},include:{group:{include:{members:true}}}});
    if(!parentThread)throw new IsolationError();
    if(parentThread.group&&!parentThread.group.members.some(member=>member.botId===bot.id))
      throw new IsolationError("The receiving Mico must belong to this shared conversation");
    const siblings = await tx.task.findMany({ where: { delegationRootId: root, spaceId: source.spaceId, userId: source.userId } });
    if (siblings.length >= 24) throw new Error("Delegation budget reached; inspect results and change approach");
    const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    if (siblings.some(task => task.botId === bot.id && normalized(task.expectedResult ?? "") === normalized(input.expectedResult) &&
      normalized(task.prompt.split("\n\nExpected result:")[0]!) === normalized(input.instruction)))
      throw new Error("This work was already assigned in this request. Read work_status and its result; do not delegate the same unchanged work again");
    // A new child cannot depend on its parent/root or unrelated tasks. Existing dependencies
    // are immutable, so adding only edges to existing siblings cannot create a cycle.
    if (dependencies.some(id => id === parent.id || id === root || !siblings.some(task => task.id === id)))
      throw new Error("Dependencies must name existing sibling tasks, never a parent or another request");
    const childThread=parentThread.group?parentThread:await tx.thread.create({data:{spaceId:source.spaceId,userId:source.userId,
      taskBotId:bot.id,projectKey:isMicoTaskThread(parentThread)?`work:${root}`:parentThread.projectKey??`work:${root}`,taskKey:`delegation:${input.key}`,title:input.instruction.slice(0,100),
      titleSource:"auto",startedBy:"delegation",startedByRunId:source.id}});
    const child = await tx.task.create({ data: { spaceId: source.spaceId, userId: source.userId,
      botId: bot.id, threadId: childThread.id, prompt: input.instruction, status: "queued",
      parentTaskId: parent.id, delegationRootId: root, delegationKey: input.key,
      delegationState: "queued", expectedResult: input.expectedResult, resources, dependencies } });
    await tx.task.update({ where: { id: parent.id }, data: { delegationState: "waiting", delegationRevision: { increment: 1 } } });
    return { taskId: child.id, replayed: false, waitingForTasks: true };
  }, { maxWait: 5000, timeout: 20000 }));
}

/** Settle only the exact observed native action under the current execution fence. */
export async function settleObservedShell(prisma: PrismaClient, source: Source, receipt: {
  commandId: string; runId: string; code: number; stdout: string; stderr: string;
}) {
  if(receipt.runId!==source.id||!receipt.commandId.startsWith(source.id+":"))throw new IsolationError();
  const idempotencyKey=receipt.commandId.slice(source.id.length+1);
  const effect=await prisma.externalEffect.findFirst({where:{idempotencyKey,runId:source.id,spaceId:source.spaceId,kind:'shell'}});
  if(!effect)return null;
  const changed=await prisma.externalEffect.updateMany({where:{id:effect.id,runId:source.id,
    run:{status:'running',leaseOwner:source.leaseOwner,leaseFence:source.leaseFence},status:{in:['executing','uncertain','completed']}},
    data:{status:'completed',result:{stdout:receipt.stdout,stderr:receipt.stderr,code:receipt.code,commandId:receipt.commandId,recovered:true}}});
  return changed.count===1?effect:null;
}

export async function workStatus(prisma: PrismaClient, source: Scope & { taskId: string }) {
  const parent = await prisma.task.findFirst({ where: { id: source.taskId, spaceId: source.spaceId, userId: source.userId } });
  if (!parent) throw new IsolationError();
  const tasks = await prisma.task.findMany({ where: { spaceId: source.spaceId, userId: source.userId,
    OR: [{ id: parent.delegationRootId ?? parent.id }, { delegationRootId: parent.delegationRootId ?? parent.id }] },
    select: { id: true, botId: true, parentTaskId: true, delegationState: true, expectedResult: true,
      resources: true, dependencies: true, delegatedRunId: true, updatedAt: true, threadId: true,
      delegationRevision: true, paused: true, workStopPending: true, workPlan: true }, take: 25, orderBy: { createdAt: "asc" } });
  return Promise.all(tasks.map(async task => {
    const execution = await prisma.run.findFirst({ where: { taskId: task.id, spaceId: source.spaceId, userId: source.userId }, orderBy: { createdAt: "desc" }, select: { status: true, error: true } });
    const error = execution?.status === "failed" ? runFailure(execution.error) : undefined;
    const messages = task.delegatedRunId ? await prisma.message.findMany({
      where: { runId: task.delegatedRunId, threadId: task.threadId, role: "bot", thread: { spaceId: source.spaceId, userId: source.userId } },
      select: { blocks: true }, orderBy: { seq: "desc" }, take: 2,
    }) : [];
    const result = messages.flatMap(message => Array.isArray(message.blocks) ? message.blocks : [])
      .flatMap(block => block && typeof block === "object" && !Array.isArray(block) && typeof block.text === "string" ? [block.text] : [])
      .join("\n").slice(0, 4000);
    const {workPlan, ...visible} = task;
    return { ...visible, wait: eventWaitReceipt(workPlan) || undefined, executionStatus: execution?.status ?? null,
      ...(error ? { executionError: error } : {}), updatedAt: task.updatedAt.toISOString(), result, resultIsUntrustedData: true };
  }));
}

/** DB rows are the outbox: missed enqueue is repaired by the ordinary queued-Run scan. */
export async function reconcileWork(prisma: PrismaClient, batchSize = 50): Promise<string[]> {
  const scopes = await prisma.task.findMany({ where: { delegationState: { in: ["queued", "running", "waiting"] } },
    select: { spaceId: true, userId: true }, distinct: ["spaceId", "userId"], orderBy: { delegationCheckedAt: { sort: "asc", nulls: "first" } }, take: batchSize });
  const published: string[] = [];
  for (const scope of scopes) {
    published.push(...await withTransactionRetry(() => prisma.$transaction(async tx => {
      await lock(tx, scope);
      const open = await tx.task.findMany({ where: { ...scope, delegationState: { in: ["queued", "running", "waiting"] } },
        orderBy: { delegationCheckedAt: { sort: "asc", nulls: "first" } }, take: 100 });
      const roots = [...new Set(open.map(task => task.delegationRootId ?? task.id))];
      const tasks = await tx.task.findMany({ where: { ...scope, OR: [{ id: { in: roots } }, { delegationRootId: { in: roots } }] }, orderBy: { createdAt: "asc" }, take: 2500 });
      await tx.task.updateMany({ where: { id: { in: open.map(task => task.id) } }, data: { delegationCheckedAt: new Date() } });
      const reservations = await tx.task.findMany({ where: { ...scope, delegationState: "running" }, select: { id: true, resources: true } });
      const queued: string[] = [];
      const now = new Date();
      await resolveEventWaitTasks(tx, tasks, now);
      for (const task of tasks) {
        const currentRun = task.delegatedRunId ?? task.returnRunId;
        if (!currentRun || task.delegationState !== "running") continue;
        const run = await tx.run.findFirst({ where: { id: currentRun, ...scope, taskId: task.id } });
        if (!run || !["completed", "failed", "cancelled"].includes(run.status) ||
            (run.leaseOwner && run.leaseExpiresAt && run.leaseExpiresAt > new Date())) continue;
        const children = tasks.filter(child => child.parentTaskId === task.id);
        if (children.some(child => !["completed", "failed", "cancelled", "paused"].includes(child.delegationState ?? ""))) {
          task.delegationState = "waiting";
        } else {
          // The turn taking this work back was cut off: a fresh turn checks what already
          // happened and answers, instead of the request ending without a word.
          const wakeAt = await interruptedReturnWakeAt(tx, task, run, now);
          if (wakeAt) {
            const recovery = await tx.run.create({ data: { ...scope, botId: task.botId, threadId: task.threadId,
              taskId: task.id, status: "queued", trigger: "task_return", clientNonce: `${RECOVERY_NONCE}${run.id}`, wakeAt } });
            await tx.task.update({ where: { id: task.id }, data: { status: "queued", returnRunId: recovery.id,
              ...(task.parentTaskId ? { delegatedRunId: recovery.id } : {}), delegationRevision: { increment: 1 },
              prompt: `${task.prompt}${WORK_RECOVERY_MARKER}${INTERRUPTED_TURN_RECOVERY_NOTE}` } });
            queued.push(recovery.id);
            continue;
          }
          task.delegationState = run.status;
        }
        await tx.task.update({ where: { id: task.id }, data: { delegationState: task.delegationState, delegationRevision: { increment: 1 } } });
        const released = reservations.findIndex(reservation => reservation.id === task.id);
        if (released >= 0) reservations.splice(released, 1);
      }
      for (const parent of tasks.filter(task => task.delegationState === "waiting")) {
        const children = tasks.filter(child => child.parentTaskId === parent.id);
        if (!children.length || children.some(child => !["completed", "failed", "cancelled", "paused"].includes(child.delegationState ?? ""))) continue;
        if (parent.paused || parent.workStopPending || await tx.run.count({ where: { taskId: parent.id, OR: [
          { status: { in: [...ACTIVE_RUN_STATUSES] } }, { leaseOwner: { not: null }, leaseExpiresAt: { gt: new Date() } },
        ] } })) continue;
        const bot = await tx.bot.findFirst({ where: { id: parent.botId, ...scope, archivedAt: null } });
        const last = await tx.run.findFirst({ where: { taskId: parent.id }, orderBy: { createdAt: "desc" } });
        if (!bot || (last?.status === "cancelled" && parent.status !== "queued")) {
          await tx.task.update({ where: { id: parent.id }, data: { delegationState: "cancelled" } });
          parent.delegationState = "cancelled"; continue;
        }
        // The return includes identifiers, verified terminal states and why a child failed, as
        // data: the Mico can tell the person what stopped a teammate without guessing.
        const failedRuns = await tx.run.findMany({ where: { ...scope, id: { in: children.flatMap(child =>
          child.delegationState === "failed" && child.delegatedRunId ? [child.delegatedRunId] : []) } },
          select: { id: true, error: true } });
        const receipt = children.map(child => {
          const failure = runFailure(failedRuns.find(row => row.id === child.delegatedRunId)?.error);
          return `${child.id}: ${child.delegationState}; run=${child.delegatedRunId ?? "none"}; ${eventWaitReceipt(child.workPlan)}` +
            (failure ? `; error (data): <run_error>${escapePromptData(failure)}</run_error>` : "");
        }).join("\n");
        // Waits that woke now: their saved notes go into this turn, and an archived conversation comes back.
        const woken = children.filter(child => !child.returnedToParentAt && ["completed", "failed"].includes(child.delegationState ?? "") &&
          eventWaitState(child.workPlan));
        const notes = woken.map(eventWaitWakeNote).filter(Boolean).map(note => `\n${note}`).join("");
        if (woken.length) await reopenThreadForWakeInTransaction(tx, scope, parent.threadId);
        await tx.task.update({ where: { id: parent.id }, data: { status: "queued", delegationState: "running", prompt:
          `${parent.prompt}${WORK_RETURN_MARKER}\n${receipt}${notes}\nInspect child results with thread/history tools, verify the expected outcomes and continue the authorized request. A completed provider turn alone is not evidence of acceptance.` } });
        const run = await tx.run.create({ data: { ...scope, botId: parent.botId, threadId: parent.threadId, taskId: parent.id,
          status: "queued", trigger: "task_return", clientNonce: `work-return:${parent.id}:${parent.delegationRevision}` } });
        await tx.task.update({ where: { id: parent.id }, data: { returnRunId: run.id, ...(parent.parentTaskId ? { delegatedRunId: run.id } : {}) } });
        parent.delegationState = "running";
        reservations.push({ id: parent.id, resources: parent.resources });
        for (const child of children) await tx.task.update({ where: { id: child.id }, data: { returnedToParentAt: new Date() } });
        queued.push(run.id);
      }
      for (const task of tasks.filter(task => task.parentTaskId && task.delegationState === "queued" && !task.delegatedRunId)) {
        const root = await tx.task.findFirst({ where: { id: task.delegationRootId!, ...scope } });
        const parent = await tx.task.findFirst({ where: { id: task.parentTaskId!, ...scope } });
        if (!root || !parent || root.status === "cancelled" || parent.status === "cancelled" || root.paused || parent.paused || task.paused || task.workStopPending || ["cancelled", "paused"].includes(root.delegationState ?? "")) {
          await tx.task.update({ where: { id: task.id }, data: { delegationState: "paused" } }); continue;
        }
        if (task.dependencies.some(id => tasks.some(dependency => dependency.id === id && ["failed", "cancelled", "paused"].includes(dependency.delegationState ?? "")))) {
          task.delegationState = "paused";
          await tx.task.update({ where: { id: task.id }, data: { delegationState: "paused" } });
          continue;
        }
        if (task.dependencies.some(id => !tasks.some(dependency => dependency.id === id && dependency.delegationState === "completed"))) continue;
        const destination = await tx.bot.findFirst({ where: { id: task.botId, ...scope, archivedAt: null }, select: { agentEngine: true, taskConcurrency: true, thread: { select: { id: true } }, computer: { select: { scope: true, kind: true } } } });
        // Delegated work uses the Mico's conversation slots; with lanes, its main chat has one of its own.
        const nativeConcurrency = nativeConcurrencyEnabled();
        if (!destination || await tx.run.count({ where: { botId: task.botId, ...scope, status: { in: ["queued", "leased", "running"] },
          ...slotRunsWhere({ agentEngine: destination.agentEngine, mainThreadId: destination.thread?.id, computer: destination.computer }, nativeConcurrency) } }) >= micoTurnLimit(destination, nativeConcurrency)) continue;
        if (reservations.some(other => other.id !== task.id && workResourcesConflict(task.resources, other.resources))) continue;
        const bot = await tx.bot.findFirst({ where: { id: task.botId, ...scope, archivedAt: null } });
        if (!bot) { await tx.task.update({ where: { id: task.id }, data: { delegationState: "paused" } }); continue; }
        const run = await tx.run.create({ data: { ...scope, botId: task.botId, threadId: task.threadId,
          taskId: task.id, status: "queued", trigger: "delegated_task", clientNonce: `work-start:${task.id}:${task.delegationRevision}` } });
        await tx.task.update({ where: { id: task.id }, data: { delegatedRunId: run.id, delegationState: "running",
          prompt: `${task.prompt}\n\nExpected result: ${task.expectedResult}\nCoordination resources (not a permission grant): ${JSON.stringify(task.resources)}\nThis is a delegated part of an existing request. Verify your result, preserve other agents' changes and do not expand authorization. ${DELEGATED_RESULT_FORMAT}` } });
        task.delegationState = "running";
        reservations.push({ id: task.id, resources: task.resources });
        queued.push(run.id);
      }
      return queued;
    }, { maxWait: 5000, timeout: 20000 })));
  }
  return published;
}
