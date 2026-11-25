import { runContinueJob } from "@mycellios/adapter-kit";
import type { Actor, MessageBlock, SharedMico, ThreadSnapshot } from "@mycellios/contracts";
import { attachmentMaxBytes, SHARED_MICO_UNAVAILABLE_ERROR } from "@mycellios/contracts";
import { AttachmentValidationError } from "@mycellios/core";
import type { SharedMicoAccess } from "@mycellios/db";
import {
  AnswerTooLongError,
  assertSharedMicoAllowanceLeft,
  IsolationError,
  listSideThreads,
  openSharedMicoConversation,
  runAsTenant,
  SharedMicoAllowanceError,
  sharedMicoAccess,
  sharedMicoConversationsWithActiveTurns,
  sharedMicosForMember,
  sideThreadRequestKind,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { ORPCError } from "@orpc/server";
import { assertMemberUploads, createOwnedArtifact, getMemberArtifact } from "../artifacts.js";
import type { RouterDeps } from "../router.js";
import { sideThreadRow } from "../side-threads.js";
import { assertTeachingSendAllowed } from "../taught-skills.js";
import { threadEventStream } from "../thread-event-stream.js";
import { loadMessagePage } from "../thread-message-pages.js";
import {
  markThreadRead,
  resolveThreadTarget,
  sendThreadMessage,
  stopThreadRuns,
  threadSnapshot,
} from "../thread-target.js";
import { asTenant } from "./context.js";
import type { RouterContext } from "./context.js";
import { THREAD_MESSAGE_PAGE_SIZE } from "./shared.js";

/** The Mico owner's tenant identity, which a member's procedures on it run with. */
function ownerActor(access: SharedMicoAccess): Actor {
  return {
    userId: access.owner.userId,
    spaceId: access.spaceId,
    email: access.owner.email,
    isDeploymentOwner: false,
  };
}

/** What a member sees of their conversation: never the Mico's computer or model settings. */
function memberSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  const { computer: _computer, ...rest } = snapshot;
  const hideModel = <T extends { modelProvider: string | null; modelId: string | null }>(run: T) => ({
    ...run,
    modelProvider: null,
    modelId: null,
  });
  return {
    ...rest,
    run: rest.run ? hideModel(rest.run) : null,
    ...(rest.activeRuns ? { activeRuns: rest.activeRuns.map(hideModel) } : {}),
  };
}

function allowanceRefusal(error: unknown): never {
  if (error instanceof SharedMicoAllowanceError)
    throw new ORPCError(error.paused ? "FORBIDDEN" : "TOO_MANY_REQUESTS", {
      message: error.message,
    });
  throw error;
}

/**
 * Stops the unfinished turns of members' conversations when people lose a Mico or the Space:
 * of the given people, of one Mico, or both. Their messages stay. Each stop is best effort: the
 * worker also checks access before every paid model call.
 */
export async function stopSharedMicoTurns(
  deps: Pick<RouterDeps, "prisma" | "sandbox" | "events" | "jobs">,
  input: { spaceId: string; memberUserIds?: string[]; botId?: string },
): Promise<void> {
  const threads = await sharedMicoConversationsWithActiveTurns(deps.prisma, input);
  for (const thread of threads) {
    if (!thread.taskBotId || !thread.memberUserId) continue;
    try {
      const owner = await deps.prisma.user.findUnique({
        where: { id: thread.userId },
        select: { email: true },
      });
      const actor: Actor = {
        userId: thread.userId,
        spaceId: input.spaceId,
        email: owner?.email ?? "",
        isDeploymentOwner: false,
      };
      await runAsTenant(actor, async () => {
        const target = await resolveThreadTarget(
          deps.prisma,
          actor,
          { botId: thread.taskBotId!, taskThreadId: thread.id },
          { includeArchived: true, memberConversation: { memberUserId: thread.memberUserId! } },
        );
        await stopThreadRuns(deps, actor, target);
      });
    } catch (error) {
      getLogger().error("stopping a former member's turns failed", error);
    }
  }
}

/**
 * `sharedMicos.*` (specs/space-members, phase 1b): what a person may do with the Micos shared
 * with them in a Space someone else owns. Access is resolved on every call; each procedure then
 * runs with the Mico owner's tenant identity, on the person's own conversation only.
 */
export function sharedMicoRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  /** A member of a Space someone else owns, while the deployment enables Space members. */
  const member = authed.use(({ context, next }) => {
    if (!deps.env.spaceMembers || !context.spaceRole || context.spaceRole === "owner")
      throw new ORPCError("NOT_FOUND");
    return next();
  });
  /** One Mico shared with them now; the procedure runs as its owner, naming the person. */
  const onSharedMico = member.use(async ({ context, next }, input) => {
    const botId = (input as { botId?: unknown }).botId;
    const found =
      typeof botId === "string"
        ? await sharedMicoAccess(deps.prisma, {
            spaceId: context.actor.spaceId,
            memberUserId: context.actor.userId,
            botId,
          })
        : null;
    if (!found) throw new ORPCError("NOT_FOUND", { message: SHARED_MICO_UNAVAILABLE_ERROR });
    const owner = ownerActor(found);
    const memberSession = context.stillAuthorized;
    return asTenant(owner, () =>
      next({
        context: {
          ...context,
          actor: owner,
          sharedMico: found,
          // A long stream also ends when the Mico stops being shared with them.
          stillAuthorized: async () =>
            (!memberSession || (await memberSession())) &&
            Boolean(
              await sharedMicoAccess(deps.prisma, {
                spaceId: found.spaceId,
                memberUserId: found.member.userId,
                botId: found.botId,
              }),
            ),
        },
      }),
    );
  });
  /** Their own conversation with that Mico: never its main chat or anyone else's. */
  const conversation = async (
    context: { actor: Actor; sharedMico: SharedMicoAccess },
    input: { botId: string; taskThreadId: string },
  ) => {
    const target = await resolveThreadTarget(deps.prisma, context.actor, input, {
      includeArchived: true,
      memberConversation: { memberUserId: context.sharedMico.member.userId },
    });
    if (target.kind !== "bot") throw new IsolationError();
    return target;
  };

  const sharedMicos = {
    list: member.sharedMicos.list.handler(async ({ context }) => {
      const micos = await sharedMicosForMember(deps.prisma, {
        spaceId: context.actor.spaceId,
        memberUserId: context.actor.userId,
      });
      const result: SharedMico[] = [];
      for (const mico of micos) {
        const rows = await runAsTenant(
          { spaceId: context.actor.spaceId, userId: mico.ownerUserId },
          () =>
            listSideThreads(
              deps.prisma,
              { spaceId: context.actor.spaceId, userId: mico.ownerUserId },
              { botId: mico.botId, memberUserId: context.actor.userId, limit: 200 },
            ),
        );
        result.push({
          botId: mico.botId,
          name: mico.name,
          title: mico.title,
          color: mico.color,
          ownerName: mico.ownerName,
          allowanceLeftMicros: mico.allowanceLeftMicros,
          conversations: rows.map((row) => {
            const thread = sideThreadRow(row);
            return {
              threadId: thread.threadId,
              title: thread.title,
              state: thread.state ?? "idle",
              unread: thread.unread ?? false,
              createdAt: thread.createdAt ?? row.createdAt.toISOString(),
              updatedAt: thread.updatedAt ?? row.updatedAt.toISOString(),
            };
          }),
        });
      }
      return { micos: result };
    }),
    open: onSharedMico.sharedMicos.open.handler(({ context, input }) =>
      openSharedMicoConversation(deps.prisma, context.sharedMico, input.requestKey),
    ),
    get: onSharedMico.sharedMicos.get.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      return memberSnapshot(await threadSnapshot(deps, target, input.history));
    }),
    messages: onSharedMico.sharedMicos.messages.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      return loadMessagePage(
        deps.prisma,
        target.threadId,
        input.before,
        THREAD_MESSAGE_PAGE_SIZE,
        input.around,
      );
    }),
    subscribe: onSharedMico.sharedMicos.subscribe.handler(async function* ({ context, input }) {
      const target = await conversation(context, input);
      yield* threadEventStream(deps, {
        spaceId: context.actor.spaceId,
        target,
        cursor: input.cursor,
        signal: context.signal,
        stillAuthorized: context.stillAuthorized,
      });
    }),
    send: onSharedMico.sharedMicos.send.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      const memberUserId = context.sharedMico.member.userId;
      // 0 stops their messages; once today's allowance is used up, sending waits for tomorrow.
      await assertSharedMicoAllowanceLeft(deps.prisma, context.sharedMico).catch(allowanceRefusal);
      await assertTeachingSendAllowed(deps.prisma, context.actor.spaceId, target.botId);
      await assertMemberUploads(deps.prisma, context.actor, {
        botId: target.botId,
        memberUserId,
        artifactIds: input.artifactIds,
      });
      return sendThreadMessage(deps, context.actor, target, {
        text: input.text,
        artifactIds: input.artifactIds,
        replyToMessageId: input.replyToMessageId,
        replyQuote: input.replyQuote,
        clientNonce: input.clientNonce,
        responseLocale: context.requestHeaders?.get("x-mycellios-ui-locale") ?? undefined,
        author: memberUserId,
      });
    }),
    answer: onSharedMico.sharedMicos.answer.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      // Only a question the Mico asked here: approvals, credentials and takeovers are never a
      // member's to answer, and their turns are given none.
      const asking = await deps.prisma.message.findFirst({
        where: { id: input.messageId, threadId: target.threadId, runId: input.runId, role: "bot" },
        select: { blocks: true },
      });
      const blocks = Array.isArray(asking?.blocks) ? (asking.blocks as MessageBlock[]) : [];
      const ask = [...blocks]
        .reverse()
        .find((block) => block.kind === "ask" && block.status !== "answered");
      if (!ask || sideThreadRequestKind(ask) !== "question")
        throw new ORPCError("CONFLICT", { message: "This prompt is no longer awaiting an answer" });
      const answered = await deps.events
        .answerRunInput({
          spaceId: context.actor.spaceId,
          threadId: target.threadId,
          runId: input.runId,
          messageId: input.messageId,
          answeredByUserId: context.sharedMico.member.userId,
          answer: input.answer,
          clientNonce: input.clientNonce,
        })
        .catch((error: unknown) => {
          if (error instanceof AnswerTooLongError)
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          throw error;
        });
      if (!answered)
        throw new ORPCError("CONFLICT", { message: "This prompt is no longer awaiting an answer" });
      await deps.jobs.enqueue(runContinueJob(input.runId)).catch((error) => {
        // The answer and queued run are durable; the reconciler repairs a missed immediate wake.
        getLogger().error("shared Mico answer enqueue", error);
      });
      return { ok: true as const };
    }),
    stop: onSharedMico.sharedMicos.stop.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      await stopThreadRuns(deps, context.actor, target);
      return { ok: true as const };
    }),
    markRead: onSharedMico.sharedMicos.markRead.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      return { ok: true as const, unreadAfterSeq: await markThreadRead(deps.prisma, context.actor, target) };
    }),
    upload: onSharedMico.sharedMicos.upload.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      const memberUserId = context.sharedMico.member.userId;
      try {
        return await createOwnedArtifact(
          { ...deps, maxUploadSizeBytes: attachmentMaxBytes(deps.env) },
          context.actor,
          {
            botId: target.botId,
            name: input.name,
            mimeType: input.mimeType,
            contentBase64: input.contentBase64,
            // Their nonces never meet the owner's or another member's.
            clientNonce: input.clientNonce ? `member:${memberUserId}:${input.clientNonce}` : undefined,
            memberUserId,
          },
        );
      } catch (error) {
        if (error instanceof AttachmentValidationError)
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        throw error;
      }
    }),
    file: onSharedMico.sharedMicos.file.handler(async ({ context, input }) => {
      const target = await conversation(context, input);
      try {
        return await getMemberArtifact(deps, context.actor, {
          botId: target.botId,
          artifactId: input.artifactId,
          memberUserId: context.sharedMico.member.userId,
        });
      } catch (error) {
        if (error instanceof IsolationError) throw new ORPCError("NOT_FOUND");
        throw error;
      }
    }),
  };
  return { sharedMicos };
}
