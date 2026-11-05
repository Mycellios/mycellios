import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

/** Only an owned project AND its current native binding can acquire a task-scoped lease.
 * The existing lease table still serializes each conversation; other conversations
 * keep their own fences. Ordinary/shared-screen runs retain their original key. */
export async function projectExecutionLeaseKey(
  prisma: PrismaClient,
  sandbox: SandboxProvider,
  run: { id: string; botId: string; threadId: string; userId: string; spaceId: string },
  computer: { id: string; kind: string; scope: string; providerRef: string | null; homeKey: string },
): Promise<string | undefined> {
  if (computer.scope !== "team") return;
  const scope = { userId: run.userId, spaceId: run.spaceId };
  const thread = await prisma.thread.findFirst({ where: { ...scope, id: run.threadId, taskBotId: run.botId,
    projectKey: { startsWith: "project:" } }, select: { projectKey: true } });
  if (!thread?.projectKey || !(await prisma.developmentProject.findFirst({
    where: { ...scope, id: thread.projectKey.slice(8) }, select: { id: true },
  }))) return;
  const context = {
    operationId: run.id, traceId: run.id, runId: run.id, botId: run.botId, ...scope,
    projectSessionId: run.threadId, signal: AbortSignal.timeout(5_000),
  };
  // A newly linked PC has no persisted native reference yet. Resolve its current
  // provider read-only; never provision or infer isolation from stored metadata.
  if ((computer.kind !== "desktop" || !computer.providerRef) &&
      await sandbox.provisionKind?.(context).catch(() => undefined) !== "desktop") return;
  const environment = await sandbox.environment?.({ id: computer.providerRef ?? computer.id, botId: computer.homeKey,
    kind: "desktop", providerRef: computer.providerRef ?? computer.id }, {
    ...context,
  }).catch(() => undefined);
  if (environment?.projectSessionId !== run.threadId || environment.taskIsolation !== "worktree-v1" || !environment.projectPath) return;
  // This is a lease key, never a bot identity or filesystem path.
  return projectTaskLeaseKey(run.botId, run.threadId);
}

export const projectTaskLeaseKey = (botId: string, threadId: string) => `task-worktree:${botId}:${threadId}`;

export const PROJECT_SHARED_SCREEN_TOOLS = [
  "computer_observe", "computer_act", "open_path", "launch_app", "request_takeover", "call_user",
] as const;

/** Stored computer lease keys are not Mico identities. Crash/Stop cleanup reads
 * those keys from the DB; recover the native destination only for teardown. */
export function projectLeaseOwner(key: string) {
  const match = /^task-worktree:([A-Za-z0-9_-]{1,256}):([A-Za-z0-9_-]{1,256})$/.exec(key);
  return match ? { botId: match[1]!, projectSessionId: match[2]! } : undefined;
}
