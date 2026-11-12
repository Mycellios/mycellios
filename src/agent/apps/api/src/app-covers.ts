import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { APP_COVER_MAX_BYTES, AppCoverImageType } from "@rakazo/contracts";
import type { Actor, AppCoverWrite } from "@rakazo/contracts";
import type { ArtifactStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { IsolationError, Prisma } from "@rakazo/db";
import { getSpaceArtifactById } from "./artifacts.js";

type Deps = { prisma: PrismaClient; artifacts: ArtifactStore; maxUploadSizeBytes?: number };
const RESET = "mycellios-app-cover:default:v1";
const nameFor = (appId: string) => `mycellios-app-cover-${appId}`;
const whereFor = (actor: Actor, appId: string) => ({
  userId: actor.userId, spaceId: actor.spaceId, groupId: null, name: nameFor(appId),
});
const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
const placeholder = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

/** Browser uploads and agent artifacts both cross the same bounded raster gate. */
export function validateAppCover(bytes: Uint8Array, mimeType: string, maxBytes = APP_COVER_MAX_BYTES) {
  const b = Buffer.from(bytes);
  const matches = mimeType === "image/png" ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mimeType === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : mimeType === "image/webp" ? b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" : false;
  if (!b.length || b.length > Math.min(maxBytes, APP_COVER_MAX_BYTES) || !matches)
    throw new ORPCError("BAD_REQUEST", { message: "La carátula debe ser PNG, JPG o WebP y ocupar como máximo 8 MB." });
}

export async function getAppCover(deps: Deps, actor: Actor, appId: string) {
  const row = await deps.prisma.artifact.findFirst({ where: whereFor(actor, appId), orderBy });
  if (!row) return { revision: null, image: null };
  if (row.description === RESET) return { revision: row.id, image: null };
  const image = await getSpaceArtifactById(deps, actor, { artifactId: row.id });
  validateAppCover(Buffer.from(image.contentBase64, "base64"), image.mimeType);
  return { revision: row.id, image };
}

/** Personal per-user/per-Space image versions reuse private artifact storage.
 * The lock and revision check prevent a late generation overwriting another device's choice.
 */
export async function setAppCover(deps: Deps, actor: Actor, input: AppCoverWrite) {
  const nonce = `app-cover:${input.clientNonce}`;
  const replay = await deps.prisma.artifact.findFirst({ where: {
    userId: actor.userId, spaceId: actor.spaceId, clientNonce: nonce,
  } });
  if (replay) {
    if (replay.name !== nameFor(input.appId) || replay.botId !== input.botId) throw new IsolationError();
    return getAppCover(deps, actor, input.appId);
  }
  let mimeType: string = "image/png", bytes: Buffer;
  if (input.source.kind === "artifact") {
    // An artifact id alone never grants another member's or another Space's content.
    const image = await getSpaceArtifactById(deps, actor, { artifactId: input.source.artifactId });
    if (image.groupId !== null || image.botId !== input.botId) throw new IsolationError();
    const type = AppCoverImageType.safeParse(image.mimeType);
    if (!type.success) throw new ORPCError("BAD_REQUEST", { message: "El archivo no es una imagen compatible." });
    mimeType = type.data;
    bytes = Buffer.from(image.contentBase64, "base64");
  } else if (input.source.kind === "upload") {
    mimeType = input.source.mimeType;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.source.contentBase64))
      throw new ORPCError("BAD_REQUEST");
    bytes = Buffer.from(input.source.contentBase64, "base64");
  } else bytes = placeholder;
  validateAppCover(bytes, mimeType, deps.maxUploadSizeBytes);
  const storageContext = { operationId: nonce, traceId: nonce, userId: actor.userId,
    spaceId: actor.spaceId, botId: input.botId, signal: new AbortController().signal };
  const stored = await deps.artifacts.put({ name: nameFor(input.appId), mimeType, bytes }, storageContext);
  let retained = false;
  try {
    await deps.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.userId, actor.spaceId, input.appId])}, 0))::text AS "lock"`);
      const latest = await tx.artifact.findFirst({ where: whereFor(actor, input.appId), orderBy });
      const raced = await tx.artifact.findFirst({ where: { userId: actor.userId, spaceId: actor.spaceId, clientNonce: nonce } });
      if (raced) {
        if (raced.name !== nameFor(input.appId) || raced.botId !== input.botId) throw new IsolationError();
        return;
      }
      if ((latest?.id ?? null) !== input.expectedRevision)
        throw new ORPCError("CONFLICT", { message: "La carátula ha cambiado. Actualiza la vista antes de aplicar otra imagen." });
      await tx.artifact.create({ data: {
        ...whereFor(actor, input.appId), botId: input.botId, mimeType, size: bytes.length,
        hash: createHash("sha256").update(bytes).digest("hex"), storageKey: stored.id, clientNonce: nonce,
        description: input.source.kind === "default" ? RESET : `Carátula personal: ${input.appId}`,
        rootArtifactId: latest ? latest.rootArtifactId ?? latest.id : null,
        version: (latest?.version ?? 0) + 1,
      } });
      retained = true;
    });
  } finally {
    if (!retained) await deps.artifacts.remove(stored.id, storageContext).catch(() => undefined);
  }
  return getAppCover(deps, actor, input.appId);
}
