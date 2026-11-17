import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareRelease } from "./prepare-release.mjs";
import {
  assembleSection,
  bumpVersion,
  chooseIncrement,
  fragmentProblems,
  releasedChangelog,
  releaseNotesProblems,
} from "./release-notes.mjs";

test("a bump adds one to the chosen part and resets the lower ones", () => {
  assert.equal(bumpVersion("0.12.3", "patch"), "0.12.4");
  assert.equal(bumpVersion("0.12.3", "minor"), "0.13.0");
  assert.equal(bumpVersion("0.12.3", "major"), "1.0.0");
  assert.throws(() => bumpVersion("0.12", "minor"), /not semver/);
  assert.throws(() => bumpVersion("0.12.3", "huge"), /Unknown increment/);
});

test("a release section needs a real date, known groups and items", () => {
  assert.deepEqual(
    releaseNotesProblems("## [1.0.0] - 2026-11-17\n\n### Fixed\n\n- A fix.\n", "1.0.0"),
    [],
  );
  assert.match(releaseNotesProblems("## [0.9.0] - 2026-11-17\n", "1.0.0")[0], /no "## \[1.0.0\]"/);
  const problems = releaseNotesProblems(
    "## [1.0.0] - 2026-13-45\n\n### Misc\n\n- TODO\n\n### Fixed\n",
    "1.0.0",
  ).join("\n");
  assert.match(problems, /real date/);
  assert.match(problems, /"### Misc" .* is not one of/);
  assert.match(problems, /placeholder/);
  assert.match(problems, /"### Fixed" in 1.0.0 has no entries/);
});

test("a fragment holds only groups and items", () => {
  assert.deepEqual(fragmentProblems("### Added\n\n- A thing.\n  More about it.\n"), []);
  assert.match(
    fragmentProblems("Some text\n### Added\n\n- A thing.\n").join("\n"),
    /not in a "- " item/,
  );
  assert.match(fragmentProblems("## Added\n\n- A thing.\n").join("\n"), /only "### "/);
  assert.match(fragmentProblems("").join("\n"), /no entries/);
});

test("the release merges Unreleased and fragments by group, in order", () => {
  assert.equal(
    assembleSection([
      "### Fixed\n\n- First fix.",
      "### Added\n\n- Feature.\n  Continued.\n\n### Fixed\n\n- Second fix.",
      "### Security\n\n- Patch.",
    ]),
    "### Security\n\n- Patch.\n\n### Added\n\n- Feature.\n  Continued.\n\n### Fixed\n\n- First fix.\n- Second fix.",
  );
  const changelog =
    "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Old fix.\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- Start.\n";
  assert.equal(
    releasedChangelog(changelog, "0.2.0", "2026-11-17", ["### Added\n\n- New.\n"]),
    "# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-11-17\n\n### Added\n\n- New.\n\n### Fixed\n\n- Old fix.\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- Start.\n",
  );
  assert.throws(() => releasedChangelog(changelog, "0.1.0", "2026-11-17", []), /already contains/);
});

function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "prepare-release-"));
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, ...env } });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  Object.entries(files).forEach(([file, text], index) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
    // One commit per file, a day apart, so the fragments have a merge order.
    git(["add", file]);
    git(["commit", "-q", "-m", file], { GIT_COMMITTER_DATE: `2026-11-0${index + 1}T00:00:00Z` });
  });
  return dir;
}

const LOCK = (version) =>
  `${JSON.stringify({ packages: { "apps/desktop": { version }, "apps/web": { version: "0.1.0" } } }, null, 2)}\n`;
const json = (dir, file) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));

test("prepare bumps Desktop and its lockfile entry, writes the section and deletes the fragments", async () => {
  const dir = repo({
    "apps/desktop/package.json": '{\n  "version": "0.3.61"\n}\n',
    "package-lock.json": LOCK("0.3.61"),
    "CHANGELOG.md":
      "# Changelog\n\n## [Unreleased]\n\n## [0.3.61] - 2026-11-16\n\n### Added\n\n- Old.\n",
    "changelog.d/README.md": "# Unreleased notes\n",
    "changelog.d/b-first.md": "### Fixed\n\n- First merged.\n",
    "changelog.d/a-second.md": "### Fixed\n\n- Second merged.\n",
  });
  try {
    const result = await prepareRelease({ increment: "minor", cwd: dir, date: "2026-11-17" });
    assert.equal(result.version, "0.4.0");
    assert.equal(json(dir, "apps/desktop/package.json").version, "0.4.0");
    assert.equal(json(dir, "package-lock.json").packages["apps/desktop"].version, "0.4.0");
    assert.equal(json(dir, "package-lock.json").packages["apps/web"].version, "0.1.0");
    assert.match(
      readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"),
      /## \[Unreleased\]\n\n## \[0\.4\.0\] - 2026-11-17\n\n### Fixed\n\n- First merged\.\n- Second merged\.\n\n## \[0\.3\.61\]/,
    );
    assert.equal(existsSync(path.join(dir, "changelog.d/b-first.md")), false);
    assert.equal(existsSync(path.join(dir, "changelog.d/README.md")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare changes nothing when there are no notes", async () => {
  const dir = repo({
    "apps/desktop/package.json": '{\n  "version": "0.3.61"\n}\n',
    "package-lock.json": LOCK("0.3.61"),
    "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n",
    "changelog.d/README.md": "# Unreleased notes\n",
  });
  try {
    await assert.rejects(
      prepareRelease({ increment: "patch", cwd: dir }),
      /Write the release notes for 0\.3\.62/,
    );
    assert.equal(json(dir, "apps/desktop/package.json").version, "0.3.61");
    assert.equal(json(dir, "package-lock.json").packages["apps/desktop"].version, "0.3.61");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the automatic release picks patch only for fixes, minor otherwise, and nothing when empty", () => {
  assert.equal(chooseIncrement(["", "\n"]), undefined);
  assert.equal(chooseIncrement(["### Fixed\n\n- A fix.", "### Security\n\n- A patch."]), "patch");
  assert.equal(chooseIncrement(["### Fixed\n\n- A fix.", "### Added\n\n- A feature."]), "minor");
  assert.equal(chooseIncrement(["### Changed\n"]), undefined);
  assert.equal(chooseIncrement(["### Self-host upgrade notes\n\n- Set X."]), "minor");
});

test("auto releases a fix-only patch and does nothing when no notes wait", async () => {
  const dir = repo({
    "apps/desktop/package.json": '{\n  "version": "0.3.61"\n}\n',
    "package-lock.json": LOCK("0.3.61"),
    "CHANGELOG.md":
      "# Changelog\n\n## [Unreleased]\n\n## [0.3.61] - 2026-11-16\n\n### Added\n\n- Old.\n",
    "changelog.d/README.md": "# Unreleased notes\n",
    "changelog.d/fix.md": "### Fixed\n\n- A fix.\n",
  });
  try {
    const release = await prepareRelease({ increment: "auto", cwd: dir, date: "2026-11-17" });
    assert.deepEqual([release.version, release.increment], ["0.3.62", "patch"]);
    assert.equal(json(dir, "package-lock.json").packages["apps/desktop"].version, "0.3.62");
    assert.equal(await prepareRelease({ increment: "auto", cwd: dir }), undefined);
    assert.equal(json(dir, "apps/desktop/package.json").version, "0.3.62");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
