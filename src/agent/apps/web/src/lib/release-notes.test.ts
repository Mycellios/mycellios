import { beforeEach, expect, it, vi } from "vitest";
import { LATEST_RELEASE, RELEASES, releaseEntry, releaseForBuild, selectReleases, summarizeReleases } from "./release-notes";

beforeEach(() => vi.resetModules());
function store() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
const old = "20261103211604",
  current = LATEST_RELEASE.minimumBuild;
it("keeps the editorial list newest first with valid builds and dates", () => {
  for (let i = 1; i < RELEASES.length; i++) expect(RELEASES[i - 1]!.minimumBuild > RELEASES[i]!.minimumBuild).toBe(true);
  for (const release of RELEASES) {
    expect(release.minimumBuild).toMatch(/^\d{14}$/);
    expect(release.minimumBuild.startsWith(release.date.replaceAll("-", ""))).toBe(true);
  }
});
it("collects every skipped release and names the version updated from", () => {
  const from = RELEASES[2]!;
  const releases = selectReleases(current, from.minimumBuild);
  expect(releases.map((release) => release.version)).toEqual([RELEASES[0]!.version, RELEASES[1]!.version]);
  expect(releaseForBuild(from.minimumBuild)?.version).toBe(from.version);
  expect(selectReleases(current, null)).toEqual([LATEST_RELEASE]);
});
it("summarizes skipped releases into one list per group", () => {
  const summary = summarizeReleases(RELEASES);
  expect(summary.groups.map((group) => group.type)).toEqual(["added", "changed", "fixed"]);
  const total = RELEASES.flatMap((release) => release.groups).reduce((n, group) => n + group.items.length, 0);
  expect(summary.groups.reduce((n, group) => n + group.items.length, 0)).toBe(total);
});
it("splits a note into a headline and its detail", () => {
  expect(releaseEntry("Create Mico teams. Micos in a team work together.")).toEqual({
    headline: "Create Mico teams.",
    detail: "Micos in a team work together.",
  });
  expect(releaseEntry("Publish your apps in Hifa Store.")).toEqual({ headline: "Publish your apps in Hifa Store.", detail: "" });
});
it("records the first visit without claiming an update", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  expect(observeRelease(current, s, null)?.show).toBe(false);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("shows a newer loaded build but not an ordinary reload", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  observeRelease(old, s, null);
  const shown = observeRelease(current, s, null);
  expect(shown?.show).toBe(true);
  expect(shown?.releases.length).toBe(RELEASES.length);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("recognizes the preexisting guarded update marker on the first upgraded load", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store(),
    session = store();
  session.setItem("rk:client-update-attempt", JSON.stringify({ from: old, to: current }));
  expect(observeRelease(current, s, session)).toMatchObject({ previousBuild: old, show: true });
});
it.each([
  "broken",
  '{"from":"fake","to":"20261102090000"}',
  '{"from":"20261101164621","to":"20990101000000"}',
])("rejects a malformed or not-yet-loaded update (%s)", async (marker) => {
  const { observeRelease } = await import("./release-notes");
  const session = store();
  session.setItem("rk:client-update-attempt", marker);
  expect(observeRelease(current, store(), session)?.show).toBe(false);
});
it("does not advertise unreleased notes or treat a rollback as a new version", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  observeRelease("20261001000000", s, null);
  expect(observeRelease(old, s, null)?.show).toBe(false);
  observeRelease(current, s, null);
  expect(observeRelease(old, s, null)?.show).toBe(false);
  expect(observeRelease(current, s, null)?.show).toBe(false);
});
it("consumes an update without new notes silently", async () => {
  const { observeRelease } = await import("./release-notes");
  const s = store();
  observeRelease(current, s, null);
  expect(observeRelease("20990101000000", s, null)).toMatchObject({ show: false, releases: [] });
});
it("acknowledges one notes edition without resetting it for hotfix builds", async () => {
  const { observeRelease, acknowledgeRelease } = await import("./release-notes");
  const s = store();
  observeRelease(old, s, null);
  expect(observeRelease(current, s, null)?.show).toBe(true);
  acknowledgeRelease(s);
  expect(observeRelease("20990101000000", s, null)?.show).toBe(false);
});
it("handles development and denied storage without breaking startup", async () => {
  const { observeRelease } = await import("./release-notes");
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  expect(observeRelease("", denied, null)).toBeNull();
  expect(() => observeRelease(current, denied, denied)).not.toThrow();
});
