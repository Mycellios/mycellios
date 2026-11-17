// The release gate for CHANGELOG.md and the changelog.d fragments. No package imports:
// changelog.yml runs this before any install. Paths are relative to src/agent.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

/** The groups a release section may have, in the order a release writes them. */
export const RELEASE_GROUPS = [
  "Security",
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Self-host upgrade notes",
  "Messaging upgrade notes",
];
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export const UNRELEASED = "Unreleased";
/** Where each pull request writes its own notes. The release moves them into CHANGELOG.md. */
export const FRAGMENT_DIR = "changelog.d";
export const CHANGELOG = "CHANGELOG.md";
/** The file that holds the released version. The desktop app's updater compares against it. */
export const VERSION_FILE = "apps/desktop/package.json";

const isDay = (text) => DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));

/** What stops `version` from being released. Empty when its section is ready. */
export function releaseNotesProblems(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return [`CHANGELOG.md has no "## [${version}]" section.`];

  const problems = [];
  if (lines.filter((line) => line.startsWith(`## [${version}]`)).length > 1) {
    problems.push(`CHANGELOG.md has more than one "## [${version}]" section.`);
  }
  const heading = lines[start] ?? "";
  const date = /^## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})$/.exec(heading)?.[1];
  if (version !== UNRELEASED && (date === undefined || !isDay(date))) {
    problems.push(`"${heading}" must be "## [${version}] - YYYY-MM-DD" with a real date.`);
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  let group;
  let groupEntries = 0;
  let entries = 0;
  const closeGroup = () => {
    if (group !== undefined && groupEntries === 0) {
      problems.push(`"### ${group}" in ${version} has no entries.`);
    }
  };

  for (const line of section) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      closeGroup();
      group = groupHeading[1].trim();
      groupEntries = 0;
      if (!RELEASE_GROUPS.includes(group)) {
        problems.push(`"### ${group}" in ${version} is not one of ${RELEASE_GROUPS.join(", ")}.`);
      }
      continue;
    }
    if (line.startsWith("- ")) {
      if (group === undefined)
        problems.push(`"${line}" in ${version} is not under a "### " group.`);
      if (line.slice(2).trim() === "") problems.push(`An item in ${version} has no text.`);
      groupEntries += 1;
      entries += 1;
    }
    if (PLACEHOLDER.test(line)) problems.push(`"${line.trim()}" in ${version} is a placeholder.`);
  }
  closeGroup();

  if (entries === 0) {
    problems.push(
      `${version} has no entries. Add "- " items under "### Added", "### Changed" or "### Fixed".`,
    );
  }
  return problems;
}

/** What stops one fragment in `changelog.d` from being released. Empty when it is ready. */
export function fragmentProblems(fragment) {
  const problems = releaseNotesProblems(`## [${UNRELEASED}]\n${fragment}`, UNRELEASED);
  if (/^##? /m.test(fragment)) problems.push(`Use only "### " group headings in a fragment.`);
  for (const line of collectGroups(fragment, new Map())) {
    problems.push(`"${line.trim()}" is not in a "- " item.`);
  }
  return problems;
}

/** The items under `## [Unreleased]`. A release moves them into its section. */
export function unreleasedItems(changelog) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.startsWith("- "));
}

/** The fragments in `directory`, oldest commit first. A fragment with no commit is last. */
export function releaseFragments(directory, cwd = process.cwd()) {
  // Recursive, as the workflow checks a fragment in a subdirectory too.
  const names = readdirSync(path.join(cwd, directory), { recursive: true, encoding: "utf8" })
    .map((name) => name.split(path.sep).join("/"))
    .filter((name) => name.endsWith(".md") && name !== "README.md");
  const added = (file) => {
    const time = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "-1", "--", file], {
      cwd,
      encoding: "utf8",
    }).trim();
    return time === "" ? Number.POSITIVE_INFINITY : Number(time);
  };
  return names
    .map((name) => `${directory}/${name}`)
    .map((file) => ({ file, time: added(file) }))
    .sort((a, b) => a.time - b.time || a.file.localeCompare(b.file))
    .map(({ file }) => file);
}

/**
 * The section body that holds every item of `bodies`. The groups follow the order of
 * `RELEASE_GROUPS`, and the items in a group keep the order of `bodies`.
 */
export function assembleSection(bodies) {
  const groups = new Map();
  // The release deletes the fragments after it writes this section, so a line that would be left
  // out stops the release instead.
  const stray = bodies.flatMap((body) => collectGroups(body, groups));
  if (stray.length > 0) {
    throw new Error(`These release notes lines are not in a "- " item:\n${stray.join("\n")}`);
  }
  const rank = (group) => {
    const index = RELEASE_GROUPS.indexOf(group);
    return index === -1 ? RELEASE_GROUPS.length : index;
  };
  return [...groups]
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([group, items]) => `### ${group}\n\n${items.join("\n")}`)
    .join("\n\n");
}

/** Adds the items of `body` to `groups`, with their continuation lines. Returns the other lines. */
function collectGroups(body, groups) {
  const stray = [];
  let items;
  let open = false;
  for (const line of body.split(/\r?\n/)) {
    const groupHeading = /^### (.+)$/.exec(line);
    if (groupHeading) {
      const group = groupHeading[1].trim();
      items = groups.get(group) ?? [];
      groups.set(group, items);
      open = false;
    } else if (line.trim() === "") {
      open = false;
    } else if (items && line.startsWith("- ")) {
      items.push(line);
      open = true;
    } else if (items && open) {
      items[items.length - 1] += `\n${line}`;
    } else {
      stray.push(line);
    }
  }
  return stray;
}

/** `version` with `increment` (major, minor or patch) added and the lower parts reset. */
export function bumpVersion(version, increment) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Desktop version is not semver: ${version}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (increment === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (increment === "minor") {
    minor += 1;
    patch = 0;
  } else if (increment === "patch") {
    patch += 1;
  } else {
    throw new Error(`Unknown increment: ${increment}`);
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * The changelog with the Unreleased items, then each fragment body in order, moved under a new
 * `## [version] - date` section. Unreleased stays as an empty heading.
 */
export function releasedChangelog(changelog, version, date, fragmentBodies) {
  if (changelog.includes(`## [${version}]`)) {
    throw new Error(`${CHANGELOG} already contains ${version}`);
  }
  const lines = changelog.split("\n");
  const unreleased = lines.findIndex((line) => line.startsWith(`## [${UNRELEASED}]`));
  if (unreleased === -1) throw new Error(`${CHANGELOG} has no "## [${UNRELEASED}]" section.`);
  const nextRelease = lines.findIndex(
    (line, index) => index > unreleased && line.startsWith("## "),
  );
  const unreleasedEnd = nextRelease === -1 ? lines.length : nextRelease;
  const section = assembleSection([
    lines.slice(unreleased + 1, unreleasedEnd).join("\n"),
    ...fragmentBodies,
  ]);
  return [
    ...lines.slice(0, unreleased + 1),
    "",
    `## [${version}] - ${date}`,
    "",
    section,
    "",
    ...lines.slice(unreleasedEnd),
  ].join("\n");
}

const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/;

/** The top-level version of a package.json. */
export function fileVersion(source, file) {
  const version = VERSION_FIELD.exec(source)?.[2];
  if (version === undefined || version !== JSON.parse(source).version) {
    throw new Error(`${file} has no valid version.`);
  }
  return version;
}
