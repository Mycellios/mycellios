import { ORPCError } from "@orpc/server";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@mycellios/adapter-kit";
import { isScratchpadStatus, listScratchpadItems, mapScratchpadItem } from "@mycellios/adapters";
import { isDeletableMemoryDocument, memoryNotePath } from "@mycellios/contracts";
import { findSpaceMemoryConfig, IsolationError } from "@mycellios/db";
import {
  disconnectMemoryProvider,
  persistMemoryProviderConfig,
  serializeSpaceMemoryConfig,
  updateMemoryProviderDefaultScope,
} from "../memory-provider-config.js";
import { createMemoryGrants } from "../memory-grants.js";
import type { RouterContext } from "./context.js";

export function memoryRoutes(ctx: RouterContext) {
  const { deps, repos, taughtSkills, agentSkills, authed, memoryConnections } = ctx;
  const memoryGrants = createMemoryGrants(deps);
  return {
    memory: {
      reviewStatus: authed.memory.reviewStatus.handler(async({context})=>{
        const day=new Date();day.setUTCHours(0,0,0,0);const owner={userId:context.actor.userId,spaceId:context.actor.spaceId};
        const [totals,pending]=await Promise.all([deps.prisma.localMemoryReview.aggregate({where:{...owner,createdAt:{gte:day}},_sum:{maximumMicrounits:true,chargedMicrounits:true}}),deps.prisma.localMemoryReview.count({where:{...owner,status:{in:["reserved","submitted","pending","ready"]}}})]);
        return {reservedMicrounits:totals._sum.maximumMicrounits??0,chargedMicrounits:totals._sum.chargedMicrounits??0,pending};
      }),
      list: authed.memory.list.handler(async ({ context, input }) => {
        const withTasks = Boolean(input.includeTasks) && !input.taskThreadId;
        const docs = await deps.prisma.memoryDocument.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            ...(input.botId ? { botId: input.botId } : {}),
            ...(input.scope ? { scope: input.scope } : {}),
            // Task notes leave with their conversation, so one being deleted is not listed.
            ...(withTasks
              ? { OR: [{ taskThreadId: null }, { taskThread: { deleteAfter: null } }] }
              : { taskThreadId: input.taskThreadId ?? null }),
          },
          ...(withTasks ? { include: { taskThread: { select: { title: true } } } } : {}),
        });
        return docs.map((doc) => ({
          id: doc.id,
          scope: doc.scope as "bot" | "user",
          inclusion:doc.inclusion as "essential"|"searchable",userControlled:doc.userControlled,taskThreadId:doc.taskThreadId,
          ...(withTasks && doc.taskThreadId
            ? { taskThreadTitle: (doc as { taskThread?: { title: string | null } | null }).taskThread?.title ?? null }
            : {}),
          botId: doc.botId,
          path: doc.path,
          content: doc.content,
          revision: doc.revision,
          updatedAt: doc.updatedAt.toISOString(),
        }));
      }),
      update: authed.memory.update.handler(async ({ context, input }) => {
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: {
            id: input.documentId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!doc) throw new IsolationError();
        if(input.inclusion && input.expectedRevision===undefined)throw new ORPCError("BAD_REQUEST",{message:"Reopen this memory before changing its inclusion."});
        const updated = await deps.memory
          .commit(
            {
              scope: doc.scope as "bot" | "user",
              botId: doc.botId ?? undefined,
              path: doc.path,
              content: input.content,
              expectedRevision: input.expectedRevision,
              taskThreadId:doc.taskThreadId,
              selectionByUser:true,
              ...(input.inclusion ? {inclusion:input.inclusion} : {}),
            },
            {
              operationId: "mem",
              traceId: "mem",
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              signal: new AbortController().signal,
            },
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            if(error instanceof Error && error.message.startsWith("Essential memory limit"))throw new ORPCError("BAD_REQUEST",{message:error.message});
            throw error;
          });
        return {
          id: updated.id,
          inclusion:(input.inclusion??doc.inclusion) as "essential"|"searchable",userControlled:true,taskThreadId:doc.taskThreadId,
          scope: doc.scope as "bot" | "user",
          botId: doc.botId,
          path: updated.path,
          content: updated.content,
          revision: updated.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
      remove: authed.memory.remove.handler(async ({ context, input }) => {
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: {
            id: input.documentId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!doc) throw new IsolationError();
        if (!isDeletableMemoryDocument(doc.path)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `${doc.path} cannot be deleted; edit its content instead.`,
          });
        }
        await deps.memory.remove(
          {
            id: doc.id,
            scope: doc.scope as "bot" | "user",
            botId: doc.botId ?? undefined,
            path: doc.path,
          },
          {
            operationId: "mem",
            traceId: "mem",
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            signal: new AbortController().signal,
          },
        );
        return { ok: true as const };
      }),
      create: authed.memory.create.handler(async ({ context, input }) => {
        const path = memoryNotePath(input.path);
        if (!path) throw new ORPCError("BAD_REQUEST", { message: "Choose a note name without special folders." });
        if (input.botId) await repos.getBot(context.actor, input.botId);
        const created = await deps.memory
          .commit(
            {
              scope: input.scope,
              botId: input.botId,
              path,
              content: input.content,
              // Revision 0 only matches a note that does not exist yet.
              expectedRevision: 0,
              selectionByUser: true,
              inclusion: "searchable",
            },
            {
              operationId: "mem",
              traceId: "mem",
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              signal: new AbortController().signal,
            },
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: "A note with this name already exists." });
            }
            throw error;
          });
        return {
          id: created.id,
          inclusion: "searchable" as const,
          userControlled: true,
          taskThreadId: null,
          scope: input.scope,
          botId: input.botId ?? null,
          path: created.path,
          content: created.content,
          revision: created.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
      recall: authed.memory.recall.handler(async ({ context, input }) => {
        const owner = { spaceId: context.actor.spaceId, userId: context.actor.userId };
        const message = await deps.prisma.message.findFirst({
          where: { id: input.messageId, role: "bot", thread: { ...owner, memberUserId: null } },
          select: { runId: true },
        });
        if (!message) throw new IsolationError();
        const receipt = message.runId
          ? await deps.prisma.runMemoryRecall
              .findFirst({ where: { runId: message.runId, ...owner }, select: { documentIds: true } })
              .catch(() => null)
          : null;
        if (!receipt) return { recorded: false, notes: [], removed: 0 };
        const docs = await deps.prisma.memoryDocument.findMany({
          where: { id: { in: receipt.documentIds }, ...owner },
          select: { id: true, path: true, scope: true, botId: true },
        });
        const order = new Map(receipt.documentIds.map((id, index) => [id, index]));
        docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        return {
          recorded: true,
          notes: docs.map((doc) => ({ id: doc.id, path: doc.path, scope: doc.scope as "bot" | "user", botId: doc.botId })),
          removed: receipt.documentIds.length - docs.length,
        };
      }),
      recallCounts: authed.memory.recallCounts.handler(async ({ context, input }) => {
        const owner = { spaceId: context.actor.spaceId, userId: context.actor.userId };
        const asked = await deps.prisma.message.findMany({
          where: { id: { in: input.messageIds }, role: "bot", runId: { not: null }, thread: { ...owner, memberUserId: null } },
          select: { threadId: true, runId: true },
        });
        const runIds = [...new Set(asked.flatMap((message) => (message.runId ? [message.runId] : [])))];
        if (!runIds.length) return { counts: {} };
        const [receipts, latest] = await Promise.all([
          deps.prisma.runMemoryRecall
            .findMany({ where: { runId: { in: runIds }, ...owner }, select: { runId: true, documentIds: true } })
            .catch(() => []),
          // A turn can post several messages; the count belongs on its last one.
          deps.prisma.message.findMany({
            where: { threadId: { in: [...new Set(asked.map((message) => message.threadId))] }, runId: { in: runIds }, role: "bot" },
            orderBy: { seq: "desc" },
            distinct: ["runId"],
            select: { id: true, runId: true },
          }),
        ]);
        const byRun = new Map(receipts.map((receipt) => [receipt.runId, receipt.documentIds.length]));
        const wanted = new Set(input.messageIds);
        const counts: Record<string, number> = {};
        for (const message of latest) {
          const count = message.runId ? byRun.get(message.runId) : undefined;
          if (count !== undefined && wanted.has(message.id)) counts[message.id] = count;
        }
        return { counts };
      }),
      sources: authed.memory.sources.handler(async ({ context, input }) => {
        const owner = { spaceId: context.actor.spaceId, userId: context.actor.userId };
        const doc = await deps.prisma.memoryDocument.findFirst({ where: { id: input.documentId, ...owner }, select: { id: true } });
        if (!doc) throw new IsolationError();
        const revisions = await deps.prisma.memoryRevision.findMany({
          where: { documentId: doc.id, sourceThreadId: { not: null } },
          orderBy: { revision: "desc" },
          take: 200,
          select: { sourceThreadId: true, createdAt: true },
        });
        const newest = new Map<string, Date>();
        for (const revision of revisions)
          if (revision.sourceThreadId && !newest.has(revision.sourceThreadId)) newest.set(revision.sourceThreadId, revision.createdAt);
        const threadIds = [...newest.keys()].slice(0, 20);
        if (!threadIds.length) return { sources: [] };
        // Only the person's own conversations that still exist; others are not theirs to open.
        const threads = await deps.prisma.thread.findMany({
          where: { id: { in: threadIds }, ...owner, memberUserId: null, deleteAfter: null },
          select: { id: true, title: true, botId: true, taskBotId: true, groupId: true, archivedAt: true },
        });
        const byId = new Map(threads.map((thread) => [thread.id, thread]));
        return {
          sources: threadIds.flatMap((id) => {
            const thread = byId.get(id);
            if (!thread) return [];
            const kind = thread.groupId ? ("group" as const) : thread.botId ? ("main" as const) : ("conversation" as const);
            return [{
              threadId: thread.id,
              kind,
              title: thread.title ?? null,
              botId: thread.botId ?? thread.taskBotId ?? null,
              groupId: thread.groupId ?? null,
              archived: Boolean(thread.archivedAt),
              at: newest.get(id)!.toISOString(),
            }];
          }),
        };
      }),
      exportMarkdown: authed.memory.exportMarkdown.handler(async ({ context, input }) => {
        const docs = await deps.prisma.memoryDocument.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            ...(input.botId ? { botId: input.botId } : {}),
          },
        });
        return docs.map((d) => `# ${d.path}\n\n${d.content}`).join("\n\n");
      }),
      providerConfig: authed.memory.providerConfig.handler(async ({ context }) => {
        const config = await findSpaceMemoryConfig(deps.prisma, context.actor.spaceId);
        return config ? serializeSpaceMemoryConfig(config) : null;
      }),
      connectProvider: authed.memory.connectProvider.handler(async ({ context, input }) =>
        persistMemoryProviderConfig(deps, context.actor, input),
      ),
      setDefaultScope: authed.memory.setDefaultScope.handler(async ({ context, input }) =>
        updateMemoryProviderDefaultScope(deps, context.actor, input.defaultMemoryScope),
      ),
      disconnectProvider: authed.memory.disconnectProvider.handler(async ({ context }) =>
        disconnectMemoryProvider(deps, context.actor),
      ),
      connections: {
        list: authed.memory.connections.list.handler(({ context }) =>
          memoryConnections.list(context.actor),
        ),
        create: authed.memory.connections.create.handler(({ context, input }) =>
          memoryConnections.create(context.actor, input),
        ),
        check: authed.memory.connections.check.handler(({ context, input }) =>
          memoryConnections.check(context.actor, input.id),
        ),
        remove: authed.memory.connections.remove.handler(({ context, input }) =>
          memoryConnections.remove(context.actor, input.id),
        ),
      },
      grants: {
        list: authed.memory.grants.list.handler(({ context }) => memoryGrants.list(context.actor)),
        set: authed.memory.grants.set.handler(({ context, input }) =>
          memoryGrants.set(context.actor, input),
        ),
      },
    },
    scratchpad: {
      list: authed.scratchpad.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return listScratchpadItems(
          { prisma: deps.prisma },
          {
            spaceId: context.actor.spaceId,
            botId: input.botId,
            status: input.status,
            includeDone: input.includeDone ?? false,
          },
        );
      }),
      create: authed.scratchpad.create.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        const row = await deps.prisma.scratchpadItem.create({
          data: {
            spaceId: context.actor.spaceId,
            botId: input.botId,
            userId: context.actor.userId,
            title: input.title.trim(),
            status: input.status,
            notes: input.notes.trim(),
          },
        });
        return mapScratchpadItem(row);
      }),
      update: authed.scratchpad.update.handler(async ({ context, input }) => {
        const existing = await deps.prisma.scratchpadItem.findFirst({
          where: {
            id: input.itemId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!existing) throw new IsolationError();
        if (input.status !== undefined && !isScratchpadStatus(input.status)) {
          throw new ORPCError("BAD_REQUEST", { message: "Invalid scratchpad status." });
        }
        const row = await deps.prisma.scratchpadItem.update({
          where: { id: existing.id },
          data: {
            ...(input.title !== undefined ? { title: input.title.trim() } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
          },
        });
        return mapScratchpadItem(row);
      }),
      remove: authed.scratchpad.remove.handler(async ({ context, input }) => {
        const existing = await deps.prisma.scratchpadItem.findFirst({
          where: {
            id: input.itemId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!existing) throw new IsolationError();
        await deps.prisma.scratchpadItem.delete({ where: { id: existing.id } });
        return { ok: true as const };
      }),
    },
    skills: {
      list: authed.skills.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return taughtSkills.list(context.actor, input.botId);
      }),
      get: authed.skills.get.handler(async ({ context, input }) =>
        taughtSkills.get(context.actor, input.skillId),
      ),
      start: authed.skills.start.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return taughtSkills.start(context.actor, input.botId, input.goal);
      }),
      appendEvent: authed.skills.appendEvent.handler(async ({ context, input }) =>
        taughtSkills.appendEvent(context.actor, input.skillId, input.event),
      ),
      snapshot: authed.skills.snapshot.handler(async ({ context, input }) =>
        taughtSkills.snapshot(context.actor, input.skillId),
      ),
      stop: authed.skills.stop.handler(async ({ context, input }) =>
        taughtSkills.stop(context.actor, input.skillId),
      ),
      updateDraft: authed.skills.updateDraft.handler(async ({ context, input }) =>
        taughtSkills.updateDraft(context.actor, input.skillId, {
          name: input.name,
          playbook: input.playbook,
        }),
      ),
      save: authed.skills.save.handler(async ({ context, input }) =>
        taughtSkills.save(context.actor, input.skillId, input.name),
      ),
      testRun: authed.skills.testRun.handler(async ({ context, input }) =>
        taughtSkills.testRun(context.actor, input.skillId, input.prompt),
      ),
      remove: authed.skills.remove.handler(async ({ context, input }) =>
        taughtSkills.remove(context.actor, input.skillId),
      ),
    },
    agentSkills: {
      pin: authed.agentSkills.pin.handler(async ({ context, input }) =>
        agentSkills.pin(context.actor, input),
      ),
      history: authed.agentSkills.history.handler(async ({ context, input }) =>
        agentSkills.history(context.actor, input),
      ),
      restore: authed.agentSkills.restore.handler(async ({ context, input }) =>
        agentSkills.restore(context.actor, input),
      ),
      list: authed.agentSkills.list.handler(async ({ context }) => agentSkills.list(context.actor)),
      get: authed.agentSkills.get.handler(async ({ context, input }) =>
        agentSkills.get(context.actor, input),
      ),
      create: authed.agentSkills.create.handler(async ({ context, input }) =>
        agentSkills.create(context.actor, input),
      ),
      update: authed.agentSkills.update.handler(async ({ context, input }) =>
        agentSkills.update(context.actor, input),
      ),
      remove: authed.agentSkills.remove.handler(async ({ context, input }) =>
        agentSkills.remove(context.actor, input.skillId),
      ),
    },
  };
}
