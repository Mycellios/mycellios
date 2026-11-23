import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogPage } from "./ChangelogPage";
import { desktopReleasesFromChangelog, releaseFilterFor, releasesFor } from "../../../src/contracts/marketing-changelog";
import { CHANGELOG_RELEASES } from "./changelog-releases";
import { recentChangelogSections } from "../../../scripts/agent-changelog-recent.mjs";

describe("Mycellios release history", () => {
  it("keeps product filters shareable and falls back for unknown query values", () => {
    expect(releaseFilterFor("?product=agent")).toBe("agent");
    expect(releaseFilterFor("?product=desktop&from=footer")).toBe("desktop");
    expect(releaseFilterFor("?product=mobile")).toBe("all");
    expect(releaseFilterFor("")).toBe("all");
    expect(releasesFor(CHANGELOG_RELEASES, "all")).toEqual(CHANGELOG_RELEASES);
    for (const product of ["desktop", "agent"] as const) {
      const entries = releasesFor(CHANGELOG_RELEASES, product);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(entry => entry.product === product)).toBe(true);
    }
  });

  it("lists Desktop releases from the Agent CHANGELOG, newest first and without unreleased notes", () => {
    const releases = desktopReleasesFromChangelog([
      "# Changelog", "", "## [Unreleased]", "", "### Added", "", "- Not shipped yet.", "",
      "## [0.10.0] - 2026-11-22", "", "### Added", "", "- A new panel that", "  spans two lines with `code` and [a link](https://example.com).", "- Second.", "",
      "### Fixed", "", "- A fix.", "", "### Self-host upgrade notes", "", "- Run the migration.", "",
      "## [0.9.1] - 2026-11-21", "", "### Fixed", "", "- Older fix.",
    ].join("\n"));
    expect(releases.map(release => release.version)).toEqual(["0.10.0", "0.9.1"]);
    expect(releases[0]!.groups).toEqual([
      { kind: "New", items: ["A new panel that spans two lines with code and a link.", "Second."] },
      { kind: "Fixed", items: ["A fix."] },
    ]);
    expect(releases[0]!.sourceUrl).toBe("https://github.com/Mycellios/mycellios/blob/main/src/agent/CHANGELOG.md#0100---2026-11-22");
    const file = "# Changelog\n\n## [Unreleased]\n\n- Soon.\n\n## [3.0.0] - 2026-11-23\n\n- C.\n\n## [2.0.0] - 2026-11-22\n\n- B.\n\n## [1.0.0] - 2026-11-21\n\n- A.\n";
    expect(recentChangelogSections(file, 2)).toBe("## [3.0.0] - 2026-11-23\n\n- C.\n\n## [2.0.0] - 2026-11-22\n\n- B.\n\n");
    expect(recentChangelogSections(file, 3, 10)).toBe("## [3.0.0] - 2026-11-23\n\n- C.\n\n");
    // The page's latest Desktop entry is the newest version in the real CHANGELOG.
    const latestDesktop = CHANGELOG_RELEASES.find(release => release.product === "desktop")!;
    expect(latestDesktop.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(latestDesktop.version).not.toBe("0.3.11");
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
    // The shared footer intentionally links to the researched comparisons.
    expect(html).toContain('href="/compare/openclaw"');
    expect(html).not.toContain("mobile release");
  });
});
