// Prepares a Desktop release: bumps the version and moves the release notes into CHANGELOG.md.
//
//   npm run release:patch | release:minor | release:major   (from src/agent)
//
// The new section holds the items still written under Unreleased, then each changelog.d fragment
// in the order that its pull request merged. The fragments are deleted once the section holds them.
// Preparation only: merging the release pull request to main is what publishes the installers.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDesktopVersion } from "./prepare-desktop-version.mjs";
import {
  bumpVersion,
  CHANGELOG,
  FRAGMENT_DIR,
  fileVersion,
  releasedChangelog,
  releaseFragments,
  releaseNotesProblems,
  VERSION_FILE,
} from "./release-notes.mjs";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export async function prepareRelease({ increment, cwd = agentRoot, date = today() }) {
  if (!["major", "minor", "patch"].includes(increment)) {
    throw new Error("Usage: npm run release:<major|minor|patch>");
  }
  const at = (file) => path.join(cwd, file);
  const nextVersion = bumpVersion(
    fileVersion(readFileSync(at(VERSION_FILE), "utf8"), VERSION_FILE),
    increment,
  );
  const fragments = releaseFragments(FRAGMENT_DIR, cwd);
  const changelog = releasedChangelog(
    readFileSync(at(CHANGELOG), "utf8"),
    nextVersion,
    date,
    fragments.map((file) => readFileSync(at(file), "utf8")),
  );

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
  const { version } = await prepareDesktopVersion(cwd, increment);
  if (version !== nextVersion) throw new Error(`Expected ${nextVersion}, prepared ${version}.`);
  writeFileSync(at(CHANGELOG), changelog);
  // Only after the changelog holds their items.
  for (const file of fragments) rmSync(at(file));
  return { version, fragments };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { version, fragments } = await prepareRelease({ increment: process.argv[2] });
    console.log(
      `Prepared Mycellios Desktop ${version} from ${fragments.length} fragments. Review, then commit ` +
        `apps/desktop/package.json, package-lock.json, ${CHANGELOG} and ${FRAGMENT_DIR} and open ` +
        `the release pull request. Merging it to main publishes the installers.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
