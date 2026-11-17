// Stops a release whose CHANGELOG.md section is missing, empty or malformed.
//
// Run from src/agent:
//   node apps/desktop/scripts/check-release-notes.mjs                       the Desktop version
//   node apps/desktop/scripts/check-release-notes.mjs --fragments <file>...  changelog.d fragments
//   --no-pending also stops when notes wait for a version: in changelog.d or under Unreleased
//
// No package imports: changelog.yml runs this before any install.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANGELOG,
  FRAGMENT_DIR,
  fileVersion,
  fragmentProblems,
  releaseFragments,
  releaseNotesProblems,
  unreleasedItems,
  VERSION_FILE,
} from "./release-notes.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file) => readFileSync(path.resolve(agentRoot, file), "utf8");
const args = process.argv.slice(2);

function fail(title, problems, hint) {
  console.error([title, ...problems.map((problem) => `- ${problem}`), "", hint].join("\n"));
  process.exit(1);
}

const fragmentsFlag = args.indexOf("--fragments");
if (fragmentsFlag !== -1) {
  const problems = args
    .slice(fragmentsFlag + 1)
    .flatMap((file) => fragmentProblems(read(file)).map((problem) => `${file}: ${problem}`));
  if (problems.length > 0) {
    fail(
      "These release notes are not ready:",
      problems,
      "See docs/DEVELOPMENT.md#desktop-release-notes at the repository root.",
    );
  }
  process.exit(0);
}

const version = fileVersion(read(VERSION_FILE), VERSION_FILE);
const changelog = read(CHANGELOG);
const problems = releaseNotesProblems(changelog, version);
if (problems.length > 0) {
  fail(
    `The release notes for Mycellios Desktop ${version} are not ready:`,
    problems,
    "Prepare the release with npm run release:minor (or patch, major). See docs/DEVELOPMENT.md#desktop-release-notes at the repository root.",
  );
}

if (args.includes("--no-pending")) {
  const pending = [
    ...releaseFragments(FRAGMENT_DIR, agentRoot),
    ...(unreleasedItems(changelog).length > 0
      ? [`${unreleasedItems(changelog).length} items under "## [Unreleased]" in ${CHANGELOG}`]
      : []),
  ];
  if (pending.length > 0) {
    fail(
      `These notes have no version. Mycellios Desktop ${version} is already prepared:`,
      pending,
      "Run npm run release:minor (or patch, major) first.",
    );
  }
}
