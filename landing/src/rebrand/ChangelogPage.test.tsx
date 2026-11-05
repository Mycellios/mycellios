import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogPage } from "./ChangelogPage";
import { CHANGELOG_RELEASES, releaseFilterFor, releasesFor } from "../../../src/contracts/marketing-changelog";

describe("Mycellios release history", () => {
  it("keeps product filters shareable and falls back for unknown query values", () => {
    expect(releaseFilterFor("?product=agent")).toBe("agent");
    expect(releaseFilterFor("?product=desktop&from=footer")).toBe("desktop");
    expect(releaseFilterFor("?product=mobile")).toBe("all");
    expect(releaseFilterFor("")).toBe("all");
    expect(releasesFor("all")).toEqual(CHANGELOG_RELEASES);
    for (const product of ["desktop", "agent"] as const) {
      const entries = releasesFor(product);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(entry => entry.product === product)).toBe(true);
    }
  });

  it("gives every dated publication a unique permalink and a first-party source", () => {
    const dates = CHANGELOG_RELEASES.map(entry => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(CHANGELOG_RELEASES.map(entry => entry.id)).size).toBe(CHANGELOG_RELEASES.length);
    for (const entry of CHANGELOG_RELEASES) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(Number.isFinite(Date.parse(entry.date))).toBe(true);
      expect(entry.sourceUrl).toMatch(/^https:\/\/github.com\/Mycellios\/mycellios\//);
      expect(entry.groups.every(group => group.items.length > 0)).toBe(true);
    }
  });

  it("renders complete notes, preserves the shared header and separates upcoming work", () => {
    const html = renderToStaticMarkup(<ChangelogPage />);
    expect(html).toContain('class="marketing-header"');
    expect(html).toContain('aria-label="Filter product updates"');
    expect(html).toContain('aria-label="Release archive"');
    for (const entry of CHANGELOG_RELEASES) {
      expect(html).toContain(`id="${entry.id}"`);
      expect(html).toContain(`href="#${entry.id}"`);
      expect(html).toMatch(new RegExp(`datetime="${entry.date}"`, "i"));
      expect(html).toContain(`href="${entry.sourceUrl}"`);
    }
    expect(html).toContain("Coming soon");
    expect(html).toContain("when published");
    expect(html).not.toMatch(/openbot|openbot\.run/i);
    expect(html).not.toContain("mobile release");
  });
});
