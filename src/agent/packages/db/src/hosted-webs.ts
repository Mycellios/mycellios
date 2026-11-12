import type { Actor, HostedWebCard } from "@rakazo/contracts";
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
      COALESCE(r."createdAt",w."updatedAt") AS "updatedAt", w."forkedFrom"
    FROM hosted_webs w LEFT JOIN hosted_web_revisions r ON r.id=w."publishedRevisionId" AND r."siteId"=w.id
    WHERE (r.id IS NOT NULL OR (${filter} IN ('mine','pinned') AND w."userId"=${user} AND w."spaceId"=${space}))
      AND (${filter}<>'mine' OR (w."userId"=${user} AND w."spaceId"=${space}))
      AND (${filter}<>'pinned' OR EXISTS(SELECT 1 FROM hosted_web_pins p WHERE p."siteId"=w.id AND p."userId"=${user} AND p."spaceId"=${space}))
      AND (position(lower(${query}) in lower(COALESCE(r.title,w.title)||' '||COALESCE(r.summary,w.summary)))>0)
    ORDER BY CASE WHEN ${filter}='trending' THEN (SELECT count(*) FROM hosted_web_views v WHERE v."siteId"=w.id AND v."createdAt">CURRENT_TIMESTAMP-INTERVAL '7 days') ELSE 0 END DESC,
      COALESCE(r."createdAt",w."updatedAt") DESC,w.id LIMIT 100
  `),
  );
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
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
