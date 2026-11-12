import { createHash, randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
  type Actor,
  HOSTED_WEB_LIMITS,
  HostedWebBundle,
  type HostedWebDraft,
  type HostedWebSave,
} from "@rakazo/contracts";
import {
  listHostedWebs,
  type PrismaClient,
  publishedHostedWeb,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import type * as z from "zod";
import { admitStaticBundle } from "./bundle.js";

type Save = z.infer<typeof HostedWebSave>;
export function hostedWebService(db: PrismaClient) {
  const where = (actor: Actor, id?: string) => ({
    userId: actor.userId,
    spaceId: actor.spaceId,
    ...(id ? { id } : {}),
  });
  const admitted = (bundle: unknown) => {
    try {
      return admitStaticBundle(bundle);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Invalid website.",
      });
    }
  };
  const scoped = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
    runAsTenant(actor, async () => {
      if (
        !(await db.spaceMember.findUnique({
          where: {
            spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId },
          },
        }))
      )
        throw new ORPCError("FORBIDDEN");
      return fn();
    });
  const draft = async (actor: Actor, id: string): Promise<HostedWebDraft> => {
    const row = await db.hostedWeb.findFirst({ where: where(actor, id) });
    if (!row) throw new ORPCError("NOT_FOUND");
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      bundle: HostedWebBundle.parse(row.draftBundle),
      version: row.version,
      published: row.publishedRevisionId !== null,
    };
  };
  return {
    agent: (actor: Actor, id: string) =>
      scoped(actor, async () => {
        await draft(actor, id);
        const binding = await db.hostedWebAgent.findFirst({
          where: { siteId: id, ...where(actor), bot: { archivedAt: null } },
          include: { bot: true },
        });
        return binding
          ? {
              botId: binding.botId,
              threadId: binding.threadId,
              name: binding.bot.name,
              color: binding.bot.color,
            }
          : null;
      }),
    revision: (actor: Actor, id: string) =>
      scoped(actor, async () => {
        const row = await db.hostedWeb.findFirst({
          where: where(actor, id),
          select: { version: true },
        });
        if (!row) throw new ORPCError("NOT_FOUND");
        return row.version;
      }),
    assignAgent: (actor: Actor, id: string, botId: string | null) =>
      scoped(actor, async () => {
        return db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM hosted_webs WHERE id=${id} AND "userId"=${actor.userId} AND "spaceId"=${actor.spaceId} FOR UPDATE`;
          if (!locked.length) throw new ORPCError("NOT_FOUND");
          if (!botId) {
            await tx.hostedWebAgent.deleteMany({
              where: {
                siteId: id,
                userId: actor.userId,
                spaceId: actor.spaceId,
              },
            });
            return null;
          }
          const bot = await tx.bot.findFirst({
            where: {
              id: botId,
              userId: actor.userId,
              spaceId: actor.spaceId,
              archivedAt: null,
            },
          });
          if (!bot) throw new ORPCError("NOT_FOUND");
          const taskKey = `mico-task:${botId}:app:${id}`;
          const thread = await tx.thread.upsert({
            where: {
              spaceId_userId_taskKey: {
                spaceId: actor.spaceId,
                userId: actor.userId,
                taskKey,
              },
            },
            create: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              taskBotId: botId,
              taskKey,
              projectKey: `mico:${botId}`,
              title: "App",
            },
            update: {},
          });
          await tx.hostedWebAgent.upsert({
            where: { siteId: id },
            create: {
              siteId: id,
              userId: actor.userId,
              spaceId: actor.spaceId,
              botId,
              threadId: thread.id,
            },
            update: { botId, threadId: thread.id },
          });
          return {
            botId,
            threadId: thread.id,
            name: bot.name,
            color: bot.color,
          };
        });
      }),
    list: (
      actor: Actor,
      filter: "discover" | "trending" | "pinned" | "mine",
      query: string,
    ) => scoped(actor, () => listHostedWebs(db, actor, filter, query)),
    draft: (actor: Actor, id: string) => scoped(actor, () => draft(actor, id)),
    async save(actor: Actor, input: Save, forkedFrom: string | null = null) {
      const { bundle } = admitted(input.bundle);
      return scoped(actor, async () => {
        try {
          await db.$transaction(async (tx) => {
            // Serialize owner quota admission; only this feature's writes use this lock.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.spaceId + ":" + actor.userId}, 0))::text`;
            const previous = await tx.hostedWeb.findFirst({
              where: where(actor, input.id),
            });
            if (!previous) {
              if (input.version !== 0) throw new ORPCError("NOT_FOUND");
              if (
                (await tx.hostedWeb.count({ where: where(actor) })) >=
                HOSTED_WEB_LIMITS.sites
              )
                throw new ORPCError("BAD_REQUEST", {
                  message: "Website limit reached (20 per Space/account).",
                });
              await tx.hostedWeb.create({
                data: {
                  id: input.id,
                  userId: actor.userId,
                  spaceId: actor.spaceId,
                  slug: input.slug,
                  title: input.title,
                  summary: input.summary,
                  draftBundle: bundle,
                  forkedFrom,
                },
              });
            } else {
              if (previous.publishedRevisionId && previous.slug !== input.slug)
                throw new ORPCError("BAD_REQUEST", {
                  message: "Unpublish before changing the website address.",
                });
              const changed = await tx.hostedWeb.updateMany({
                where: { ...where(actor, input.id), version: input.version },
                data: {
                  slug: input.slug,
                  title: input.title,
                  summary: input.summary,
                  draftBundle: bundle,
                  version: { increment: 1 },
                },
              });
              if (changed.count !== 1)
                throw new ORPCError("CONFLICT", {
                  message:
                    "This draft changed elsewhere. Reload it before saving.",
                });
            }
          });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "P2002"
          )
            throw new ORPCError("CONFLICT", {
              message:
                "That website address is already in use. Choose another.",
            });
          throw error;
        }
        return draft(actor, input.id);
      });
    },
    publish: (actor: Actor, id: string, version: number) =>
      scoped(actor, async () => {
        await db.$transaction(async (tx) => {
          const lock = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM hosted_webs WHERE id=${id} AND "userId"=${actor.userId} AND "spaceId"=${actor.spaceId} FOR UPDATE`;
          if (!lock.length) throw new ORPCError("NOT_FOUND");
          const row = await tx.hostedWeb.findFirstOrThrow({
            where: where(actor, id),
          });
          if (row.version !== version)
            throw new ORPCError("CONFLICT", {
              message:
                "The draft changed. Review the current version before publishing.",
            });
          const { bundle, digest: sourceDigest } = admitted(row.draftBundle);
          const digest = createHash("sha256")
            .update(
              JSON.stringify({
                sourceDigest,
                title: row.title,
                summary: row.summary,
              }),
            )
            .digest("hex");
          const previous = await tx.hostedWebRevision.findFirst({
            where: { siteId: id },
            orderBy: { number: "desc" },
          });
          if (previous?.digest === digest) {
            await tx.hostedWeb.update({
              where: { id },
              data: { publishedRevisionId: previous.id },
            });
            return;
          }
          if ((previous?.number ?? 0) >= HOSTED_WEB_LIMITS.revisions)
            throw new ORPCError("BAD_REQUEST", {
              message: "Revision limit reached (100).",
            });
          const revision = await tx.hostedWebRevision.create({
            data: {
              id: randomUUID(),
              siteId: id,
              userId: actor.userId,
              spaceId: actor.spaceId,
              number: (previous?.number ?? 0) + 1,
              digest,
              title: row.title,
              summary: row.summary,
              bundle,
            },
          });
          await tx.hostedWeb.update({
            where: { id },
            data: { publishedRevisionId: revision.id },
          });
        });
        const result = (await listHostedWebs(db, actor, "mine")).find(
          (row) => row.id === id,
        );
        if (!result) throw new ORPCError("NOT_FOUND");
        return result;
      }),
    unpublish: (actor: Actor, id: string) =>
      scoped(actor, async () => {
        const result = await db.hostedWeb.updateMany({
          where: where(actor, id),
          data: { publishedRevisionId: null },
        });
        if (result.count !== 1) throw new ORPCError("NOT_FOUND");
        return { ok: true as const };
      }),
    pin: (actor: Actor, id: string, pinned: boolean) =>
      scoped(actor, async () => {
        const visible = await runAsSystem(
          "hosted webs: check exact public-or-owned visibility before saving a personal pin",
          () =>
            db.hostedWeb.findFirst({
              where: {
                id,
                OR: [{ publishedRevisionId: { not: null } }, where(actor)],
              },
              select: { id: true },
            }),
        );
        if (!visible) throw new ORPCError("NOT_FOUND");
        const key = {
          siteId: id,
          userId: actor.userId,
          spaceId: actor.spaceId,
        };
        if (pinned)
          await db.hostedWebPin.upsert({
            where: { siteId_userId_spaceId: key },
            create: key,
            update: {},
          });
        else await db.hostedWebPin.deleteMany({ where: key });
        return { ok: true as const };
      }),
    async clone(actor: Actor, id: string, newId: string) {
      return scoped(actor, async () => {
        const slug = await runAsSystem(
          "hosted webs: resolve a published source for an explicit clone",
          async () =>
            (
              await db.hostedWeb.findFirst({
                where: { id, publishedRevisionId: { not: null } },
                select: { slug: true },
              })
            )?.slug,
        );
        const source = slug ? await publishedHostedWeb(db, slug) : null;
        if (!source) throw new ORPCError("NOT_FOUND");
        return this.save(
          actor,
          {
            id: newId,
            version: 0,
            slug: `web-${newId}`,
            title: `${source.title.slice(0, 65)} (copia)`,
            summary: source.summary,
            bundle: HostedWebBundle.parse(source.bundle),
          },
          slug!,
        );
      });
    },
  };
}
