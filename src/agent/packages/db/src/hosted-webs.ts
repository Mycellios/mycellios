import { randomUUID } from "node:crypto";
import { type Actor, HOSTED_WEB_CAPABILITIES, type HostedWebCard } from "@rakazo/contracts";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";
import { runAsSystem } from "./row-security.js";

/** Public projection deliberately excludes draft source and all account/Space identity. */
export async function listHostedWebs(
  db: PrismaClient,
  actor: Pick<Actor, "userId" | "spaceId"> | null,
  filter: "discover" | "trending" | "pinned" | "mine",
  query = "",
): Promise<HostedWebCard[]> {
  const user = actor?.userId ?? "",
    space = actor?.spaceId ?? "";
  const rows = await runAsSystem(
    "hosted webs: published public projection plus exact requesting owner metadata",
    () =>
      db.$queryRaw<
        Array<{
          id: string;
          slug: string;
          title: string;
          summary: string;
          published: boolean;
          revision: number;
          views: number;
          recentViews: number;
          pinned: boolean;
          owned: boolean;
          updatedAt: Date;
          forkedFrom: string | null;
          coverPath:Exclude<HostedWebCard["coverPath"],undefined>; coverRevisionId:string|null;
          capabilities: unknown;
        }>
      >(Prisma.sql`
    SELECT w.id,w.slug,
      CASE WHEN w."userId"=${user} AND w."spaceId"=${space} THEN w.title ELSE r.title END AS title,
      CASE WHEN w."userId"=${user} AND w."spaceId"=${space} THEN w.summary ELSE r.summary END AS summary,
      (r.id IS NOT NULL) AS published, COALESCE(r.number,0) AS revision,
      (SELECT count(*)::int FROM hosted_web_views v WHERE v."siteId"=w.id) AS views,
      (SELECT count(*)::int FROM hosted_web_views v WHERE v."siteId"=w.id AND v."createdAt">CURRENT_TIMESTAMP-INTERVAL '7 days') AS "recentViews",
      EXISTS(SELECT 1 FROM hosted_web_pins p WHERE p."siteId"=w.id AND p."userId"=${user} AND p."spaceId"=${space}) AS pinned,
      (w."userId"=${user} AND w."spaceId"=${space}) AS owned,
      COALESCE(r."createdAt",w."updatedAt") AS "updatedAt", w."forkedFrom",
      (SELECT f->>'path' FROM jsonb_array_elements(r.bundle->'files') f WHERE f->>'path' IN ('mycellios-cover.png','mycellios-cover.jpg','mycellios-cover.webp') ORDER BY f->>'path' LIMIT 1) AS "coverPath",
      r.id AS "coverRevisionId",
      COALESCE(r.bundle->'capabilities','[]'::jsonb) AS capabilities
    FROM hosted_webs w LEFT JOIN hosted_web_revisions r ON r.id=w."publishedRevisionId" AND r."siteId"=w.id
    WHERE (r.id IS NOT NULL OR (${filter} IN ('mine','pinned') AND w."userId"=${user} AND w."spaceId"=${space}))
      AND (${filter}<>'mine' OR (w."userId"=${user} AND w."spaceId"=${space}))
      AND (${filter}<>'pinned' OR EXISTS(SELECT 1 FROM hosted_web_pins p WHERE p."siteId"=w.id AND p."userId"=${user} AND p."spaceId"=${space}))
      AND (position(lower(${query}) in lower(COALESCE(r.title,w.title)||' '||COALESCE(r.summary,w.summary)))>0)
    ORDER BY CASE WHEN ${filter}='trending' THEN (SELECT count(*) FROM hosted_web_views v WHERE v."siteId"=w.id AND v."createdAt">CURRENT_TIMESTAMP-INTERVAL '7 days') ELSE 0 END DESC,
      COALESCE(r."createdAt",w."updatedAt") DESC,w.id LIMIT 100
  `),
  );
  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    // Only the published revision's grants are public; unknown values grant nothing.
    capabilities: Array.isArray(row.capabilities)
      ? HOSTED_WEB_CAPABILITIES.filter((name) => (row.capabilities as unknown[]).includes(name))
      : [],
  }));
}

export async function publishedHostedWeb(db: PrismaClient, slug: string, revisionId?: string) {
  return runAsSystem(
    "hosted webs: read only the immutable revision selected by the publication pointer",
    async () => {
      const [row] = await db.$queryRaw<
        Array<{
          siteId: string;
          id: string;
          bundle: unknown;
          title: string;
          summary: string;
          number: number;
        }>
      >`
      SELECT r."siteId",r.id,r.bundle,r.title,r.summary,r.number FROM hosted_webs w
      JOIN hosted_web_revisions r ON r."siteId"=w.id AND r.id=COALESCE(${revisionId ?? null},w."publishedRevisionId")
      WHERE w.slug=${slug} AND w."publishedRevisionId" IS NOT NULL LIMIT 1`;
      return row ?? null;
    },
  );
}

export const HOSTED_WEB_HISTORY = { snapshots: 50, bytes: 64 * 1024 * 1024 } as const;
export type HostedWebSnapshotSource = "manual" | "mico" | "restore";

/**
 * Records the draft as saved at `version`, inside the caller's transaction (after
 * its CAS update), then prunes the oldest snapshots beyond 50 or 64 MiB. An
 * unchanged bundle/title/summary is not recorded again.
 */
export async function recordHostedWebSnapshot(
  tx: Pick<Prisma.TransactionClient, "hostedWebSnapshot">,
  snapshot: {
    siteId: string;
    userId: string;
    spaceId: string;
    version: number;
    source: HostedWebSnapshotSource;
    title: string;
    summary: string;
    bundle: unknown;
    digest: string;
    bytes: number;
  },
) {
  const latest = await tx.hostedWebSnapshot.findFirst({
    where: { siteId: snapshot.siteId },
    orderBy: { version: "desc" },
    select: { digest: true, title: true, summary: true },
  });
  if (
    latest?.digest === snapshot.digest &&
    latest.title === snapshot.title &&
    latest.summary === snapshot.summary
  )
    return;
  await tx.hostedWebSnapshot.create({
    data: { id: randomUUID(), ...snapshot, bundle: snapshot.bundle as Prisma.InputJsonValue },
  });
  const rows = await tx.hostedWebSnapshot.findMany({
    where: { siteId: snapshot.siteId },
    orderBy: { version: "desc" },
    select: { id: true, bytes: true },
  });
  let kept = 0;
  let bytes = 0;
  const drop: string[] = [];
  for (const row of rows) {
    // The newest snapshot is always kept, even if it alone is large.
    if (kept > 0 && (kept >= HOSTED_WEB_HISTORY.snapshots || bytes + row.bytes > HOSTED_WEB_HISTORY.bytes))
      drop.push(row.id);
    else {
      kept++;
      bytes += row.bytes;
    }
  }
  if (drop.length) await tx.hostedWebSnapshot.deleteMany({ where: { id: { in: drop } } });
}
