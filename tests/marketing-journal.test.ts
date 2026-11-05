import { describe, expect, it } from "vitest";
import { parseMarketingJournal } from "../src/contracts/marketing-journal.js";

const entry = { title: "A project with context", excerpt: "How to prepare useful project notes.", category: "Guides", path: "/blog/project-context", publishedAt: "2026-11-04T10:00:00.000Z", image: null };

describe("Public journal boundary", () => {
  it("rejects off-site destinations, malformed entries and credential-bearing images", () => {
    for (const change of [{ path: "https://elsewhere.example/post" }, { path: "/blog/../private" }, { publishedAt: "invalid" }, { title: "" }, { image: { url: "javascript:alert(1)", alt: "Unsafe" } }, { image: { url: "https://user:secret@example.com/image.png", alt: "Unsafe" } }]) {
      expect(() => parseMarketingJournal({ items: [{ ...entry, ...change }], total: 1 })).toThrow();
    }
    expect(() => parseMarketingJournal({ items: Array(4).fill(entry), total: 4 })).toThrow();
  });

  it("retains plain text while discarding unknown editorial and script fields", () => {
    const result = parseMarketingJournal({ items: [{ ...entry, title: "<script>example</script>", contentHtml: "private body" }], total: 1, token: "must not propagate" });
    expect(result.items[0]?.title).toBe("<script>example</script>");
    expect(JSON.stringify(result)).not.toContain("contentHtml");
    expect(JSON.stringify(result)).not.toContain("must not propagate");
  });
});
