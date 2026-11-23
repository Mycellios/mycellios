import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MODULE_ID = "virtual:agent-changelog";
const RESOLVED_ID = `\0${MODULE_ID}`;

/** The newest dated release sections of a Keep a Changelog file; Unreleased notes are left out. */
export function recentChangelogSections(markdown, releases, maximumCharacters = 30_000) {
  const sections = markdown.split(/^(?=## \[)/m).slice(1)
    .filter(section => /^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}/.test(section)).slice(0, releases);
  // Always keep the newest release; stop adding older ones once the page budget is used.
  let length = 0;
  return sections.filter((section, index) => (length += section.length) <= maximumCharacters || index === 0).join("");
}

/**
 * Exposes the latest Desktop releases from src/agent/CHANGELOG.md to the
 * changelog page, so the page follows each release without shipping the whole
 * history (the complete file stays linked on GitHub).
 */
export function agentChangelogRecent(root = process.cwd(), releases = 6) {
  const path = resolve(root, "src/agent/CHANGELOG.md");
  return {
    name: "mycellios:agent-changelog",
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(path);
      return `export default ${JSON.stringify(recentChangelogSections(readFileSync(path, "utf8"), releases))};`;
    },
  };
}
