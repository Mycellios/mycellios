import type { FastifyInstance } from "fastify";
import { parseMarketingJournal, type MarketingJournalEntry } from "../contracts/marketing-journal.js";

interface JournalReader {
  getPosts(page: number, pageSize: number): Promise<{ items: Array<Omit<MarketingJournalEntry, "path"> & { slug: string }>; total: number }>;
}

/** Homepage excerpts only; complete articles remain server-rendered by Content Hub. */
export function registerMarketingJournalRoute(app: FastifyInstance, client: JournalReader | null) {
  app.get("/public/v1/journal", async (request, reply) => {
    if (!client) return reply.code(503).header("Cache-Control", "no-store").send({ error: "Journal is not configured" });
    try {
      const posts = await client.getPosts(1, 3);
      const items = posts.items.filter(post => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)).slice(0, 3).map(post => ({
        title: post.title.slice(0, 240), excerpt: post.excerpt.slice(0, 600), category: post.category.slice(0, 100),
        path: `/blog/${post.slug}`, publishedAt: post.publishedAt,
        image: post.image?.url.startsWith("https://") ? { url: post.image.url, alt: post.image.alt.slice(0, 300) } : null,
      }));
      return reply.header("Cache-Control", "public, max-age=60, stale-if-error=300").send(parseMarketingJournal({ items, total: posts.total }));
    } catch (error) {
      request.log.warn({ err: error }, "Journal summaries unavailable");
      return reply.code(503).header("Cache-Control", "no-store").send({ error: "Journal temporarily unavailable" });
    }
  });
}
