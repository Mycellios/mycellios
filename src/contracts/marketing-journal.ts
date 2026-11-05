export interface MarketingJournalEntry {
  title: string;
  excerpt: string;
  category: string;
  path: string;
  publishedAt: string;
  image: { url: string; alt: string } | null;
}

export interface MarketingJournal { items: MarketingJournalEntry[]; total: number }

/** Small public boundary validator; no editorial HTML or server dependencies enter the landing. */
export function parseMarketingJournal(value: unknown): MarketingJournal {
  if (!value || typeof value !== "object") throw new Error("Invalid journal response");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items) || data.items.length > 3 || typeof data.total !== "number" || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("Invalid journal response");
  const text = (input: unknown, maximum: number): string => {
    if (typeof input !== "string" || !input.trim() || input.length > maximum) throw new Error("Invalid journal text");
    return input;
  };
  const items = data.items.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid journal entry");
    const item = value as Record<string, unknown>;
    const path = text(item.path, 226), publishedAt = text(item.publishedAt, 40);
    if (!/^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path) || !/^\d{4}-\d{2}-\d{2}T/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) throw new Error("Invalid journal destination or date");
    let image: MarketingJournalEntry["image"] = null;
    if (item.image !== null) {
      if (!item.image || typeof item.image !== "object") throw new Error("Invalid journal image");
      const source = item.image as Record<string, unknown>, url = new URL(text(source.url, 4096));
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid journal image URL");
      image = { url: url.href, alt: text(source.alt, 300) };
    }
    return { title: text(item.title, 240), excerpt: text(item.excerpt, 600), category: text(item.category, 100), path, publishedAt, image };
  });
  return { items, total: data.total };
}
