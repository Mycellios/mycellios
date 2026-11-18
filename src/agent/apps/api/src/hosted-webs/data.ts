import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { type Actor, HOSTED_WEB_DATA_LIMITS, type HostedWebCapability } from "@rakazo/contracts";
import { type PrismaClient, runAsSystem, runAsTenant } from "@rakazo/db";
import { bundleCapabilities } from "./bundle.js";

export type AppTarget = { id: string; preview: boolean };
type Target = AppTarget;
const DENIED: Record<HostedWebCapability, string> = {
  downloads: "Esta app no tiene permiso para descargar archivos.",
  storage: "Esta app no tiene permiso para guardar datos.",
  files: "Esta app no tiene permiso para guardar archivos.",
};

/**
 * The grant comes from the exact published revision (visitors) or the caller's own
 * saved draft (owner preview); never from the request. Call inside runAsTenant.
 */
export async function requireAppCapability(
  db: PrismaClient,
  actor: Actor,
  target: AppTarget,
  capability: HostedWebCapability,
) {
  const granted = target.preview
    ? await db.hostedWeb
        .findFirst({
          where: { id: target.id, userId: actor.userId, spaceId: actor.spaceId },
          select: { draftBundle: true },
        })
        .then((row) => (row ? bundleCapabilities(row.draftBundle) : null))
    : await runAsSystem(
        "hosted web data: read the capabilities of the exact published revision",
        async () => {
          const [row] = await db.$queryRaw<Array<{ bundle: unknown }>>`
            SELECT r.bundle FROM hosted_webs w
            JOIN hosted_web_revisions r ON r.id=w."publishedRevisionId" AND r."siteId"=w.id
            WHERE w.id=${target.id} LIMIT 1`;
          return row ? bundleCapabilities(row.bundle) : null;
        },
      );
  if (!granted) throw new ORPCError("NOT_FOUND");
  if (!granted.includes(capability)) throw new ORPCError("FORBIDDEN", { message: DENIED[capability] });
}
/** Stored as `{ v }` so arrays, null and primitives seal as one encrypted value. */
type Stored = { v: unknown };

/**
 * Per-user data for Hifa Store apps. Rows belong to the caller (user + Space), never
 * to the app owner, and exist only while the app grants `storage`: the published
 * revision for visitors, the owner's draft for private previews.
 */
export function hostedWebDataService(db: PrismaClient) {
  const scope = (actor: Actor, target: Target) => ({
    siteId: target.id,
    userId: actor.userId,
    spaceId: actor.spaceId,
    preview: target.preview,
  });
  // Same membership fence as the app service, then RLS on every statement.
  const scoped = async <T>(actor: Actor, target: Target, fn: () => Promise<T>) =>
    runAsTenant(actor, async () => {
      const member = await db.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      });
      if (!member) throw new ORPCError("FORBIDDEN");
      await requireAppCapability(db, actor, target, "storage");
      return fn();
    });
  const usage = async (actor: Actor, target: Target) => {
    const total = await db.hostedWebData.aggregate({
      where: scope(actor, target),
      _count: { _all: true },
      _sum: { bytes: true },
    });
    return { keys: total._count._all, bytes: total._sum.bytes ?? 0 };
  };
  return {
    get: (actor: Actor, target: Target & { key: string }) =>
      scoped(actor, target, async () => {
        const row = await db.hostedWebData.findFirst({
          where: { ...scope(actor, target), key: target.key },
          select: { id: true, userId: true, spaceId: true, value: true },
        });
        return row
          ? { found: true, value: ((row.value as Stored | null)?.v ?? null) as never }
          : { found: false, value: null };
      }),
    set: async (actor: Actor, target: Target & { key: string; value: unknown }) => {
      const bytes = Buffer.byteLength(JSON.stringify(target.value), "utf8");
      if (bytes > HOSTED_WEB_DATA_LIMITS.valueBytes)
        throw new ORPCError("BAD_REQUEST", { message: "El valor supera 1 MB." });
      return scoped(actor, target, () =>
        db.$transaction(async (tx) => {
          // Serialize this user's writes to one app so quota checks cannot race.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`web-data:${target.id}:${actor.spaceId}:${actor.userId}`}, 0))::text`;
          const where = scope(actor, target);
          const previous = await tx.hostedWebData.findFirst({
            where: { ...where, key: target.key },
            select: { bytes: true },
          });
          const total = await tx.hostedWebData.aggregate({
            where,
            _count: { _all: true },
            _sum: { bytes: true },
          });
          const keys = total._count._all + (previous ? 0 : 1);
          const used = (total._sum.bytes ?? 0) - (previous?.bytes ?? 0) + bytes;
          if (keys > HOSTED_WEB_DATA_LIMITS.keys)
            throw new ORPCError("BAD_REQUEST", {
              message: "Esta app ya guarda el máximo de 1.000 elementos.",
            });
          if (used > HOSTED_WEB_DATA_LIMITS.totalBytes)
            throw new ORPCError("BAD_REQUEST", { message: "Esta app ya usa sus 5 MB de datos." });
          // Replace instead of update: each sealed value gets a fresh row id and AAD.
          await tx.hostedWebData.deleteMany({ where: { ...where, key: target.key } });
          await tx.hostedWebData.create({
            data: {
              id: randomUUID(),
              ...where,
              key: target.key,
              value: { v: target.value } as never,
              bytes,
            },
          });
          return { keys, bytes: used };
        }),
      );
    },
    delete: (actor: Actor, target: Target & { key: string }) =>
      scoped(actor, target, async () => {
        await db.hostedWebData.deleteMany({ where: { ...scope(actor, target), key: target.key } });
        return usage(actor, target);
      }),
    list: (actor: Actor, target: Target & { prefix: string }) =>
      scoped(actor, target, async () => {
        // At most 1,000 small rows: filter in memory so "_" and "%" stay literal.
        const rows = await db.hostedWebData.findMany({
          where: scope(actor, target),
          select: { key: true, bytes: true, updatedAt: true },
          orderBy: { key: "asc" },
        });
        return {
          entries: rows
            .filter((row) => row.key.startsWith(target.prefix))
            .slice(0, HOSTED_WEB_DATA_LIMITS.listPage)
            .map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
          usage: await usage(actor, target),
        };
      }),
  };
}
