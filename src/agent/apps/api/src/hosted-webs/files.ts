import { createHash, randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { ArtifactStore } from "@mycellios/adapter-kit";
import { type Actor, HOSTED_WEB_FILE_DEFAULTS } from "@mycellios/contracts";
import { type PrismaClient, runAsSystem, runAsTenant } from "@mycellios/db";
import { type AppTarget, requireAppCapability } from "./data.js";

export type HostedWebFilesConfig = {
  /** Operator switch AND object storage; never the server's local disk. */
  available: boolean;
  fileBytes: number;
  quotaBytes: number;
  files: number;
};
const MB = 1024 * 1024;

/**
 * Off unless MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true and the artifact store is the
 * object store. Limits can only be lowered below the contract defaults and the
 * deployment's request body limit.
 */
export function hostedWebFilesConfig(
  env: Record<string, string | undefined>,
  artifacts: Pick<ArtifactStore, "describe"> | undefined,
  maxUploadSizeBytes = HOSTED_WEB_FILE_DEFAULTS.fileBytes,
): HostedWebFilesConfig {
  const megabytes = (raw: string | undefined, fallback: number) => {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? Math.min(value * MB, fallback) : fallback;
  };
  return {
    available:
      env.MYCELLIOS_HOSTED_WEB_FILES_ENABLED === "true" &&
      artifacts?.describe().id === "object-artifacts",
    fileBytes: Math.min(
      megabytes(env.MYCELLIOS_HOSTED_WEB_FILE_MAX_MB, HOSTED_WEB_FILE_DEFAULTS.fileBytes),
      maxUploadSizeBytes,
    ),
    quotaBytes: megabytes(
      env.MYCELLIOS_HOSTED_WEB_FILES_QUOTA_MB,
      HOSTED_WEB_FILE_DEFAULTS.quotaBytes,
    ),
    files: HOSTED_WEB_FILE_DEFAULTS.files,
  };
}

/**
 * Removes sealed objects whose file rows are gone, whatever deleted them (file
 * delete/replace, app, user or Space cascade). Best effort; failures stay queued.
 */
export async function sweepHostedWebFiles(
  db: PrismaClient,
  artifacts: Pick<ArtifactStore, "remove">,
  limit = 50,
) {
  const rows = await runAsSystem("hosted web files: read pending object removals", () =>
    db.hostedWebFileTombstone.findMany({ orderBy: { createdAt: "asc" }, take: limit }),
  );
  let removed = 0;
  for (const row of rows) {
    try {
      await artifacts.remove(row.storageKey, {
        operationId: `web-file-sweep:${row.storageKey}`,
        traceId: `web-file-sweep:${row.storageKey}`,
        userId: row.userId,
        spaceId: row.spaceId,
        signal: new AbortController().signal,
      });
      await runAsSystem("hosted web files: forget a removed object", () =>
        db.hostedWebFileTombstone.deleteMany({ where: { storageKey: row.storageKey } }),
      );
      removed++;
    } catch {
      // Kept for the next sweep.
    }
  }
  return removed;
}

const UNAVAILABLE = "Guardar archivos no está disponible por ahora.";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Per-user files for Hifa Store apps (`files` capability). Metadata rows are scoped
 * like app data; bytes are sealed in the artifact store under the caller's Space.
 * When unavailable, uploads are refused but existing files stay readable/deletable.
 */
export function hostedWebFilesService(
  db: PrismaClient,
  artifacts: ArtifactStore,
  config: HostedWebFilesConfig,
) {
  const scope = (actor: Actor, target: AppTarget) => ({
    siteId: target.id,
    userId: actor.userId,
    spaceId: actor.spaceId,
    preview: target.preview,
  });
  const context = (actor: Actor, operation: string) => ({
    operationId: operation,
    traceId: operation,
    userId: actor.userId,
    spaceId: actor.spaceId,
    signal: new AbortController().signal,
  });
  const scoped = <T>(actor: Actor, target: AppTarget, fn: () => Promise<T>) =>
    runAsTenant(actor, async () => {
      const member = await db.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      });
      if (!member) throw new ORPCError("FORBIDDEN");
      await requireAppCapability(db, actor, target, "files");
      return fn();
    });
  const usage = async (actor: Actor, target: AppTarget) => {
    const total = await db.hostedWebFile.aggregate({
      where: scope(actor, target),
      _count: { _all: true },
      _sum: { bytes: true },
    });
    return { files: total._count._all, bytes: total._sum.bytes ?? 0 };
  };
  const sweep = (limit?: number) => sweepHostedWebFiles(db, artifacts, limit);
  return {
    status: () => ({
      available: config.available,
      fileBytes: config.fileBytes,
      quotaBytes: config.quotaBytes,
      files: config.files,
    }),
    sweep,
    async put(
      actor: Actor,
      input: AppTarget & { name: string; mimeType: string; contentBase64: string },
    ) {
      if (!config.available) throw new ORPCError("PRECONDITION_FAILED", { message: UNAVAILABLE });
      if (!BASE64.test(input.contentBase64)) throw new ORPCError("BAD_REQUEST");
      const bytes = Buffer.from(input.contentBase64, "base64");
      if (bytes.length > config.fileBytes)
        throw new ORPCError("BAD_REQUEST", {
          message: `El archivo supera ${Math.floor(config.fileBytes / MB)} MB.`,
        });
      // Check access and quota before storing anything.
      await scoped(actor, input, async () => {
        const total = await usage(actor, input);
        const previous = await db.hostedWebFile.findFirst({
          where: { ...scope(actor, input), name: input.name },
          select: { bytes: true },
        });
        if (!previous && total.files >= config.files)
          throw new ORPCError("BAD_REQUEST", {
            message: "Esta app ya guarda el máximo de archivos.",
          });
        if (total.bytes - (previous?.bytes ?? 0) + bytes.length > config.quotaBytes)
          throw new ORPCError("BAD_REQUEST", {
            message: `Esta app ya usa sus ${Math.floor(config.quotaBytes / MB)} MB de archivos.`,
          });
      });
      const operation = `web-file:${randomUUID()}`;
      const stored = await artifacts.put(
        { name: `app-file-${input.id}`, mimeType: input.mimeType, bytes },
        context(actor, operation),
      );
      let retained = false;
      try {
        const result = await scoped(actor, input, () =>
          db.$transaction(async (tx) => {
            // Serialize this user's file writes to one app so quota checks cannot race.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`web-files:${input.id}:${actor.spaceId}:${actor.userId}`}, 0))::text`;
            const where = scope(actor, input);
            const total = await tx.hostedWebFile.aggregate({
              where,
              _count: { _all: true },
              _sum: { bytes: true },
            });
            const previous = await tx.hostedWebFile.findFirst({
              where: { ...where, name: input.name },
              select: { bytes: true },
            });
            const files = total._count._all + (previous ? 0 : 1);
            const used = (total._sum.bytes ?? 0) - (previous?.bytes ?? 0) + bytes.length;
            if (files > config.files || used > config.quotaBytes)
              throw new ORPCError("BAD_REQUEST", {
                message: "Se ha alcanzado el límite de archivos de esta app.",
              });
            // The replaced row's object is queued for removal by the delete trigger.
            await tx.hostedWebFile.deleteMany({ where: { ...where, name: input.name } });
            await tx.hostedWebFile.create({
              data: {
                id: randomUUID(),
                ...where,
                name: input.name,
                mimeType: input.mimeType,
                bytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                storageKey: stored.id,
              },
            });
            return { files, bytes: used };
          }),
        );
        retained = true;
        return result;
      } finally {
        if (!retained)
          await artifacts.remove(stored.id, context(actor, operation)).catch(() => undefined);
        void sweep().catch(() => undefined);
      }
    },
    get: (actor: Actor, input: AppTarget & { name: string }) =>
      scoped(actor, input, async () => {
        const row = await db.hostedWebFile.findFirst({
          where: { ...scope(actor, input), name: input.name },
        });
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Ese archivo no existe." });
        const bytes = await artifacts.get(row.storageKey, context(actor, `web-file-get:${row.id}`));
        if (createHash("sha256").update(bytes).digest("hex") !== row.sha256)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "El archivo no se pudo verificar.",
          });
        return { mimeType: row.mimeType, contentBase64: Buffer.from(bytes).toString("base64") };
      }),
    async delete(actor: Actor, input: AppTarget & { name: string }) {
      const result = await scoped(actor, input, async () => {
        await db.hostedWebFile.deleteMany({ where: { ...scope(actor, input), name: input.name } });
        return usage(actor, input);
      });
      void sweep().catch(() => undefined);
      return result;
    },
    list: (actor: Actor, input: AppTarget) =>
      scoped(actor, input, async () => {
        const rows = await db.hostedWebFile.findMany({
          where: scope(actor, input),
          select: { name: true, mimeType: true, bytes: true, createdAt: true },
          orderBy: { name: "asc" },
        });
        return {
          entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          usage: await usage(actor, input),
        };
      }),
  };
}
