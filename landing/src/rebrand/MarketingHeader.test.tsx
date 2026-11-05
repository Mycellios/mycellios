import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingHeader } from "./MarketingHeader";
import { renderJournalNavigation } from "../../../src/coordinator/content-hub-navigation";
import { MARKETING_BRAND_PATHS, MARKETING_EXPLORE_LINKS, MARKETING_PRIMARY_LINKS, MARKETING_SOCIAL_LINKS, marketingDestination } from "../../../src/contracts/marketing-navigation";

function navigationLinks(markup: string, className: string) {
  const section = markup.match(new RegExp(`<nav class="${className}"[^>]*>([\\s\\S]*?)</nav>`))![1]!;
  return [...section.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({ href: match[1], label: match[2]!.replace(/<[^>]+>/g, "") }));
}

describe("shared public marketing navigation", () => {
  it("keeps desktop and mobile destinations identical in React and the server-rendered journal", () => {
    const react = renderToStaticMarkup(<MarketingHeader active="journal" />), journal = renderJournalNavigation();
    const expected = [...MARKETING_PRIMARY_LINKS, ...MARKETING_EXPLORE_LINKS].map(({ href, label }) => ({ href, label }));
    for (const markup of [react, journal]) {
      expect(navigationLinks(markup, "marketing-desktop-nav")).toEqual(expected);
      expect(navigationLinks(markup, "marketing-mobile-nav").slice(0, expected.length)).toEqual(expected);
      expect(markup).toContain('class="marketing-mobile-menu"');
      expect(markup).toContain('aria-label="Open Explore menu"');
      expect(markup).toContain('data-variant="navigation"');
      expect(markup).toContain('href="/dashboard"');
      expect(markup).not.toContain('>Login</a>');
      expect(markup).not.toContain('href="/create"');
    }
  });

  it("uses the same official social marks and accessible link labels on both surfaces", () => {
    for (const markup of [renderToStaticMarkup(<MarketingHeader />), renderJournalNavigation()]) {
      for (const social of MARKETING_SOCIAL_LINKS) {
        expect(markup).toContain(`href="${social.href}"`);
        expect(markup).toContain(`aria-label="${social.label}"`);
        expect(markup).toContain(`d="${MARKETING_BRAND_PATHS[social.icon]}"`);
      }
    }
  });

  it("preserves first-party destinations from the stats subdomain without rewriting external links", () => {
    expect(marketingDestination("/blog", "stats.mycellios.com")).toBe("https://www.mycellios.com/blog");
    expect(marketingDestination("/earn", "127.0.0.1")).toBe("/earn");
    expect(marketingDestination("https://x.com/mycellios", "stats.mycellios.com")).toBe("https://x.com/mycellios");
  });
});
