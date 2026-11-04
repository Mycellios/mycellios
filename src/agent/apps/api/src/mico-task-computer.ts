import { ORPCError } from "@orpc/server";
import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { Actor } from "@rakazo/contracts";
import type { ThreadTarget } from "./thread-target.js";
/** Fail before creating a task run if the native executor cannot prove its task/worktree binding. */
export async function admitMicoTaskComputer(
  sandbox: SandboxProvider,
  actor: Actor,
  target: ThreadTarget,
) {
  if (target.kind !== "bot" || !target.projectSessionId) return;
  const context = {
    operationId: "mico-task-admission",
    traceId: "mico-task-admission",
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: target.botId,
    projectSessionId: target.projectSessionId,
    signal: AbortSignal.timeout(10000),
  };
  const kind = (await sandbox.provisionKind?.(context)) ?? target.bot.computer?.kind;
  if (kind !== "desktop")
    throw new ORPCError("CONFLICT", {
      message: "Connect this Mico to the project's local PC before starting its task.",
    });
  const environment = await sandbox.environment?.(
    {
      id: target.bot.computer?.id ?? "task",
      botId: target.botId,
      kind: "desktop",
      providerRef: target.bot.computer?.providerRef ?? "",
    },
    context,
  );
  if (environment?.projectSessionId !== target.projectSessionId)
    throw new ORPCError("CONFLICT", {
      message:
        "Update or reconnect the native task executor before starting this task. Its isolated worktree was not verified.",
    });
}
