import { randomBytes, randomUUID } from "node:crypto";
import type { ArtifactStore } from "@mycellios/adapter-kit";
import type { Actor, ArtifactShare } from "@mycellios/contracts";
import { IsolationError, type PrismaClient, sharedArtifactByToken } from "@mycellios/db";
import { Hono } from "hono";

/**
 * Owner-created share links for artifacts (specs/artifact-share-links). Only the owner, from
 * the Library, creates or revokes one; a link shows the exact version shared.
 */

type Deps = { prisma: PrismaClient };

async function ownedArtifact(deps: Deps, actor: Actor, artifactId: string) {
  const row = await deps.prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true, rootArtifactId: true },
  });
  if (!row) throw new IsolationError();
  return { id: row.id, rootId: row.rootArtifactId ?? row.id };
}

function toShare(row: { token: string; artifactId: string; updatedAt: Date; artifact: { version: number } }): ArtifactShare {
  return { token: row.token, artifactId: row.artifactId, version: row.artifact.version, updatedAt: row.updatedAt.toISOString() };
}

const shareSelect = { token: true, artifactId: true, updatedAt: true, artifact: { select: { version: true } } } as const;

export async function getArtifactShare(deps: Deps, actor: Actor, artifactId: string): Promise<ArtifactShare | null> {
  const { rootId } = await ownedArtifact(deps, actor, artifactId);
  const row = await deps.prisma.artifactShare.findUnique({ where: { rootArtifactId: rootId }, select: shareSelect });
  return row ? toShare(row) : null;
}

/** Share this version. A family has one link: sharing again keeps its address and moves it here. */
export async function shareArtifact(deps: Deps, actor: Actor, artifactId: string): Promise<ArtifactShare> {
  const { id, rootId } = await ownedArtifact(deps, actor, artifactId);
  const row = await deps.prisma.artifactShare.upsert({
    where: { rootArtifactId: rootId },
    create: {
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      rootArtifactId: rootId,
      artifactId: id,
      spaceId: actor.spaceId,
      userId: actor.userId,
    },
    update: { artifactId: id },
    select: shareSelect,
  });
  return toShare(row);
}

export async function unshareArtifact(deps: Deps, actor: Actor, artifactId: string) {
  const { rootId } = await ownedArtifact(deps, actor, artifactId);
  await deps.prisma.artifactShare.deleteMany({ where: { rootArtifactId: rootId } });
  return { ok: true as const };
}

/** No network, no forms, an opaque origin: a shared page cannot read the session or send anything. */
export const SHARED_ARTIFACT_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; " +
  "base-uri 'none'; frame-ancestors 'none'";

const BASE_HEADERS = {
  "Content-Security-Policy": SHARED_ARTIFACT_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()",
};

/** How a shared file is shown. Everything not listed here is downloaded, never rendered. */
export function sharedContentType(mimeType: string): { type: string; inline: boolean } {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  if (base === "text/html") return { type: "text/html; charset=utf-8", inline: true };
  if (base === "application/pdf") return { type: base, inline: true };
  if (/^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|video\/(mp4|webm)|audio\/(mpeg|mp4|wav|ogg|webm))$/.test(base))
    return { type: base, inline: true };
  if (base.startsWith("text/") || base === "application/json")
    return { type: "text/plain; charset=utf-8", inline: true };
  return { type: "application/octet-stream", inline: false };
}

function disposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "file";
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function notFound() {
  return new Response("This link is not available.", {
    status: 404,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Public, sessionless route. Mounted before CORS and auth, like published webs. */
export function artifactShareHttp(db: PrismaClient, artifacts: ArtifactStore) {
  const app = new Hono();
  app.onError(() =>
    new Response("Temporarily unavailable. Try again later.", {
      status: 503,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    }),
  );
  app.on(["GET", "HEAD"], "/api/shared/:token", async (c) => {
    const share = await sharedArtifactByToken(db, c.req.param("token"));
    if (!share || share.artifact.spaceId !== share.spaceId) return notFound();
    const { artifact } = share;
    const bytes = await artifacts.get(artifact.storageKey, {
      operationId: `artifact-share:${artifact.id}`,
      traceId: `artifact-share:${artifact.id}`,
      spaceId: share.spaceId,
      userId: share.userId,
      botId: artifact.botId ?? artifact.groupId ?? artifact.id,
      signal: c.req.raw.signal,
    });
    const content = sharedContentType(artifact.mimeType);
    return new Response(c.req.method === "HEAD" ? null : Buffer.from(bytes), {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": content.type,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": disposition(artifact.name, content.inline),
      },
    });
  });
  return app;
}
