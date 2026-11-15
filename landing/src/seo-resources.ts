import { canonicalUrl, INDEXABLE_SEO_PATHS, SEO_PAGES, seoLanguageLinks, seoMarkdownPath, type SeoPage } from "./seo.js";

const origin = "https://www.mycellios.com";
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function renderPageMarkdown(page: SeoPage): string {
  const content = page.staticContent!;
  return `# ${content.heading}\n\n${content.paragraphs.join("\n\n")}\n\n${(content.sections ?? []).map(section => `## ${section.title}\n\n${section.paragraphs.join("\n\n")}`).join("\n\n")}\n\n## ${page.language === "es" ? "Enlaces" : "Links"}\n\n${content.links.map(link => `- [${link.label}](${new URL(link.href, origin).href})`).join("\n")}\n\nSource: ${canonicalUrl(page)}\n`;
}

export function renderPublicSitemap(): string {
  const urls = INDEXABLE_SEO_PATHS.map(path => {
    const page = SEO_PAGES[path]!;
    return `<url><loc>${xml(canonicalUrl(page))}</loc>${seoLanguageLinks(page).map(item => `<xhtml:link rel="alternate" hreflang="${item.language}" href="${xml(item.href)}"/>`).join("")}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[...urls, `<url><loc>${origin}/downloads/desktop</loc></url>`, `<url><loc>${origin}/blog</loc></url>`].join("\n")}\n</urlset>\n`;
}

export function publicSeoResources(): Map<string, { type: string; body: string }> {
  const resources = new Map<string, { type: string; body: string }>();
  const pages = INDEXABLE_SEO_PATHS.map(path => SEO_PAGES[path]!);
  const llms = `# mycellios\n\n> Mycellios is an AI agent workspace with optional model connections and a distributed compute network.\n\nMicos are user agents. Use a supported personal provider or the optional Mycellios provider with AI Credits. One Credit corresponds to one USD for paid top-ups. Managed pricing is the complete upstream cost plus a 4% service fee. Availability depends on account, models, tools and operator configuration.\n\nApproved, independently verified contribution work can earn Credits. Connection time, animations and benchmarks do not imply earnings. Credits are not the proposed Spore token, cash payouts or a guaranteed return. Multi-host GPU performance and combined-memory execution are not established as general production capabilities; consult the evidence record.\n\nEach public page below has a Markdown version linked beside it. Spanish guides are full translations, not a separate product. [Full reference](${origin}/llms-full.txt).\n\n## Product, guides and comparisons\n\n${pages.map(page => `- [${page.title}](${canonicalUrl(page)}): ${page.description} [Markdown](${origin}${seoMarkdownPath(page)}).`).join("\n")}\n- [Desktop downloads](${origin}/downloads/desktop): Published platform installers and current availability.\n- [Journal](${origin}/blog): Published project notes.\n\n## Documentation and evidence\n\n- [Status and evidence](https://github.com/Mycellios/mycellios/blob/main/docs/STATUS_AND_EVIDENCE.md): Authoritative implementation and qualification record.\n- [Source](https://github.com/Mycellios/mycellios): Source code, setup and license.\n- [Security](https://github.com/Mycellios/mycellios/blob/main/SECURITY.md): Security reporting.\n`;
  resources.set("/llms.txt", { type: "text/plain; charset=utf-8", body: llms });
  resources.set("/llms-full.txt", { type: "text/plain; charset=utf-8", body: `${llms}\n---\n\n${pages.map(renderPageMarkdown).join("\n---\n\n")}` });
  resources.set("/sitemap.xml", { type: "application/xml; charset=utf-8", body: renderPublicSitemap() });
  for (const page of pages) resources.set(seoMarkdownPath(page), { type: "text/markdown; charset=utf-8", body: renderPageMarkdown(page) });
  return resources;
}
