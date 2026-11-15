import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARKETING_GUIDES, GUIDE_INDEXES, MARKETING_GUIDE_PATHS } from "../src/contracts/marketing-guides.js";
import { MARKETING_FOOTER_GROUPS } from "../src/contracts/marketing-navigation.js";
import { comparisons } from "../landing/src/rebrand/comparison-data.js";
import { canonicalUrl, SEO_PAGES, seoLanguageLinks, seoPageForPath } from "../landing/src/seo.js";
import { publicSeoResources, renderPublicSitemap } from "../landing/src/seo-resources.js";
import { resolveLandingSurface } from "../landing/src/routing.js";

describe("public search and AI discovery", () => {
  it("pairs full translated guides with reciprocal languages and self canonicals", () => {
    for (const guide of [...GUIDE_INDEXES, ...MARKETING_GUIDES]) {
      const page = seoPageForPath(guide.path);
      const alternate = seoPageForPath(guide.alternate);
      expect(alternate.alternatePath).toBe(guide.path);
      expect(alternate.language).not.toBe(page.language);
      expect(page.staticContent!.heading).not.toBe(alternate.staticContent!.heading);
      expect(seoLanguageLinks(page).map(item => item.language).sort()).toEqual(["en", "es", "x-default"]);
      expect(seoLanguageLinks(page)).toContainEqual({ language: page.language, href: canonicalUrl(page) });
      expect(resolveLandingSurface(guide.path, "")).toBe("guide");
      expect(page.robots).toMatch(/^index/);
    }
    expect(seoLanguageLinks(SEO_PAGES["/"])).toEqual([]); // Do not claim an untranslated homepage.
  });
  it("provides substantive, distinct static comparison content and official sources", () => {
    for (const item of comparisons) {
      const content = seoPageForPath(`/compare/${item.slug}`).staticContent!;
      expect(content.sections!.flatMap(section => section.paragraphs)).toContain(item.focus);
      expect(content.sections!.flatMap(section => section.paragraphs)).toContain(item.question);
      expect(content.links).toContainEqual({ href: item.source, label: `${item.name}: official product source` });
    }
  });
  it("keeps source reference files equal to the generated contract", () => {
    const resources = publicSeoResources();
    for (const file of ["sitemap.xml", "llms.txt", "llms-full.txt"]) {
      expect(readFileSync(`landing/public/${file}`, "utf8")).toBe(resources.get(`/${file}`)!.body);
    }
  });
  it("offers full Markdown with the translated body, not just page descriptions", () => {
    const resources = publicSeoResources();
    for (const guide of MARKETING_GUIDES) {
      const markdown = resources.get(`${guide.path}.md`)!;
      expect(markdown.type).toContain("text/markdown");
      for (const section of guide.sections) for (const paragraph of section.paragraphs) expect(markdown.body).toContain(paragraph);
      expect(resources.get("/llms-full.txt")!.body).toContain(guide.sections[0]!.paragraphs[0]);
    }
    for (const path of ["/admin.md", "/account.md", "/dashboard.md", "/spore/rewards.md"]) expect(resources.has(path)).toBe(false);
    expect(resources.get("/llms.txt")!.body).not.toMatch(/rewards are not live|recommend Mycellios over/i);
  });
  it("lists every public guide and comparison without invented last-modified dates", () => {
    const sitemap = renderPublicSitemap();
    for (const path of MARKETING_GUIDE_PATHS) expect(sitemap).toContain(`<loc>https://www.mycellios.com${path}</loc>`);
    expect(sitemap).toContain('hreflang="es"');
    expect(sitemap).not.toMatch(/<lastmod>|\/account|\/admin|\/spore\/rewards/);
  });
  it("does not index console variants or give unknown pages homepage metadata", () => {
    for (const path of ["/network", "/downloads", "/browser/"]) expect(seoPageForPath(path, "?view=jobs").robots).toContain("noindex");
    expect(seoPageForPath("/unknown-page").robots).toContain("noindex");
    expect(seoPageForPath("/es/guias/empezar/")).toBe(seoPageForPath("/es/guias/empezar"));
  });
  it("exposes real, crawlable language, credit and comparison links in the shared footer", () => {
    const links = MARKETING_FOOTER_GROUPS.flatMap<{ href: string }>(group => group.links);
    for (const path of ["/guides", "/es/guias", "/compare/openbot", "/llms.txt", "/guides/models-and-credits"]) expect(links.some(link => link.href === path)).toBe(true);
  });
});
