// Prepares a Desktop release: bumps the version and moves the release notes into CHANGELOG.md.
//
//   node apps/desktop/scripts/prepare-release.mjs auto   (desktop-auto-release.yml, every day)
//   npm run release:patch | release:minor | release:major   (from src/agent, by hand)
//
// `auto` picks patch when every waiting item is under Fixed or Security, minor otherwise, and
// does nothing when no notes wait. The new section holds the items still written under
// Unreleased, then each changelog.d fragment in the order that its pull request merged. The
// fragments are deleted once the section holds them. Preparation only: merging the version
// change to main is what publishes the installers.
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDesktopVersion } from "./prepare-desktop-version.mjs";
import {
  bumpVersion,
  CHANGELOG,
  chooseIncrement,
  FRAGMENT_DIR,
  fileVersion,
  releasedChangelog,
  releaseFragments,
  releaseNotesProblems,
  unreleasedBody,
  VERSION_FILE,
} from "./release-notes.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The prepared release, or undefined when `auto` finds no notes waiting. */
export async function prepareRelease({ increment, cwd = agentRoot, date = today() }) {
  if (!["auto", "major", "minor", "patch"].includes(increment)) {
    throw new Error("Usage: prepare-release.mjs <auto|major|minor|patch>");
  }
  const at = (file) => path.join(cwd, file);
  const currentChangelog = readFileSync(at(CHANGELOG), "utf8");
  const fragments = releaseFragments(FRAGMENT_DIR, cwd);
  const fragmentBodies = fragments.map((file) => readFileSync(at(file), "utf8"));
  const chosen =
    increment === "auto"
      ? chooseIncrement([unreleasedBody(currentChangelog), ...fragmentBodies])
      : increment;
  if (chosen === undefined) return undefined;

  const nextVersion = bumpVersion(
    fileVersion(readFileSync(at(VERSION_FILE), "utf8"), VERSION_FILE),
    chosen,
  );
  const changelog = releasedChangelog(currentChangelog, nextVersion, date, fragmentBodies);
  const problems = releaseNotesProblems(changelog, nextVersion);
  if (problems.length > 0) {
    throw new Error(
      [
        `Write the release notes for ${nextVersion} in src/agent/${FRAGMENT_DIR}/ first:`,
        ...problems.map((problem) => `- ${problem}`),
        "See docs/DEVELOPMENT.md#desktop-release-notes at the repository root.",
      ].join("\n"),
    );
  }

  // The notes are ready, so the version and the lockfile change, then the changelog.
  const { version } = await prepareDesktopVersion(cwd, chosen);
  if (version !== nextVersion) throw new Error(`Expected ${nextVersion}, prepared ${version}.`);
  writeFileSync(at(CHANGELOG), changelog);
  // Only after the changelog holds their items.
  for (const file of fragments) rmSync(at(file));
  return { version, increment: chosen, fragments };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = await prepareRelease({ increment: process.argv[2] });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${release?.version ?? ""}\nincrement=${release?.increment ?? ""}\n`,
      );
    }
    console.log(
      release === undefined
        ? "No release notes wait for a version: nothing to release."
        : `Prepared Mycellios Desktop ${release.version} (${release.increment}) from ` +
            `${release.fragments.length} fragments. Merging the change to main publishes the installers.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
