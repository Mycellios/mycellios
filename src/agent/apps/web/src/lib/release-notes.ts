import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { compareBuilds, isBuildId } from "@rakazo/contracts/client-build";

export type ReleaseGroupType = "added" | "changed" | "fixed";
export interface ReleaseGroup {
  type: ReleaseGroupType;
  items: readonly MessageDescriptor[];
}
export interface Release {
  /** The version people see, as Desktop names it. */
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The first web build that contains this release (`YYYYMMDDHHMMSS`, UTC). */
  minimumBuild: string;
  /** Steps a reader must take after updating. */
  notices: readonly MessageDescriptor[];
  groups: readonly ReleaseGroup[];
}

/**
 * Editorial notes, newest first. Each entry is written for people, never a commit
 * title: the first sentence says what changed, the next ones say why or how.
 */
export const RELEASES: readonly Release[] = [
  {
    version: "0.3.61", date: "2026-11-17", minimumBuild: "20261117213645", notices: [],
    groups: [
      { type: "changed", items: [
        msg`Signing in is simpler, with fewer fields and less text.`,
        msg`The chat list on narrow screens is lighter and easier to scan.`,
      ] },
      { type: "fixed", items: [
        msg`Signing in from Desktop works again. It no longer says that the sign-in request has expired.`,
      ] },
    ],
  },
  {
    version: "0.3.60", date: "2026-11-17", minimumBuild: "20261117174327", notices: [],
    groups: [
      { type: "changed", items: [
        msg`Searches adapt their time to the task. A search that keeps finding new results can run for up to three minutes, and scans of your whole home folder are refused before they start.`,
      ] },
    ],
  },
  {
    version: "0.3.59", date: "2026-11-17", minimumBuild: "20261117113928", notices: [],
    groups: [
      { type: "added", items: [
        msg`Micos can wait for an event and continue the same conversation when it arrives. You no longer need to ask again after a long wait.`,
        msg`Copy a link to the current conversation to share it when you report a problem. It is in the Mico menu when Developer mode is on.`,
      ] },
      { type: "changed", items: [
        msg`Status replies are shorter. A Mico leads with the result, what blocks it and the next step.`,
      ] },
      { type: "fixed", items: [
        msg`A command without its own time limit no longer waits for up to an hour. Searches stop after 45 seconds and suggest a narrower folder.`,
        msg`Desktop keeps the reason when it is interrupted, so a problem can be diagnosed.`,
      ] },
    ],
  },
  {
    version: "0.3.58", date: "2026-11-16", minimumBuild: "20261116141249", notices: [],
    groups: [
      { type: "fixed", items: [
        msg`Typing in the chat keeps its focus while the dock or another window updates in the background.`,
        msg`Windows keep their position after an update.`,
      ] },
    ],
  },
  {
    version: "0.3.57", date: "2026-11-16", minimumBuild: "20261116093129", notices: [],
    groups: [
      { type: "fixed", items: [
        msg`The floating dock no longer opens empty.`,
        msg`Windows show the Mycellios icon in the taskbar.`,
      ] },
    ],
  },
  {
    version: "0.3.56", date: "2026-11-16", minimumBuild: "20261116052228", notices: [],
    groups: [
      { type: "added", items: [
        msg`Create Mico teams. Micos in a team work together on the same request.`,
        msg`Each new Mico gets its own isolated computer on the server.`,
        msg`Publish your apps in Hifa Store.`,
      ] },
      { type: "changed", items: [
        msg`Your provider and chat stay selected while you look at Credit and provider options.`,
      ] },
    ],
  },
  {
    version: "0.3.55", date: "2026-11-15", minimumBuild: "20261115210513", notices: [],
    groups: [
      { type: "added", items: [
        msg`Tasks gathers the separate conversations of your Micos, with pins and reminders. Reminders do not run a model or use Credits.`,
        msg`Micos keep essential notes and can save memory for one Mico or one conversation only.`,
      ] },
      { type: "changed", items: [
        msg`Desktop updates on macOS and Linux arrive as soon as they are ready.`,
      ] },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0]!;

/**
 * The releases a reader has not seen: newer than the build they ran before and
 * no newer than the one that runs now. Several when the update skipped versions.
 * Without a previous build (opened by hand) only the current release.
 */
export function selectReleases(current: string, previous: string | null, releases = RELEASES): Release[] {
  const contained = releases.filter((release) => compareBuilds(release.minimumBuild, current)! <= 0);
  if (previous === null) return contained.slice(0, 1);
  return contained.filter((release) => compareBuilds(release.minimumBuild, previous)! > 0);
}

/** The release a build belongs to, to name the version someone updated from. */
export function releaseForBuild(build: string | null, releases = RELEASES): Release | null {
  if (!isBuildId(build)) return null;
  return releases.find((release) => compareBuilds(release.minimumBuild, build)! <= 0) ?? null;
}

const GROUP_ORDER: readonly ReleaseGroupType[] = ["added", "changed", "fixed"];

/** One list per group across releases. Someone who skipped versions wants what they can do now. */
export function summarizeReleases(releases: readonly Release[]) {
  return {
    notices: releases.flatMap((release) => release.notices),
    groups: GROUP_ORDER.map((type) => ({
      type,
      items: releases.flatMap((release) => release.groups.filter((group) => group.type === type)).flatMap((group) => group.items),
    })).filter((group) => group.items.length > 0),
  };
}

/** The first sentence is the headline; the rest is detail. Notes avoid abbreviations such as "e.g.". */
export function releaseEntry(text: string) {
  const match = /^(.+?[.!?。！？])\s+(\S.*)$/su.exec(text.trim());
  return match ? { headline: match[1]!, detail: match[2]! } : { headline: text.trim(), detail: "" };
}

const SEEN_BUILD = "mycellios.release-notes.last-build.v1";
const ACKNOWLEDGED = "mycellios.release-notes.acknowledged.v1";
const UPDATE_ATTEMPT = "rk:client-update-attempt";
type StorageAccess = Pick<Storage, "getItem" | "setItem"> | null;
const memoryAcknowledged = new Set<string>();

function read(storage: StorageAccess, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(storage: StorageAccess, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* Storage cannot block the app. */
  }
}

/** Observe only the bundle that actually loaded, not a server's proposed update. */
export function observeRelease(build: string, storage: StorageAccess, session: StorageAccess) {
  if (!isBuildId(build)) return null;
  const lastBuild = read(storage, SEEN_BUILD);
  let previous = isBuildId(lastBuild) ? lastBuild : null;
  if (!previous) {
    try {
      const attempt: unknown = JSON.parse(read(session, UPDATE_ATTEMPT) ?? "null");
      if (attempt && typeof attempt === "object") {
        const { from, to } = attempt as { from?: unknown; to?: unknown };
        if (
          isBuildId(from) &&
          isBuildId(to) &&
          compareBuilds(from, to)! < 0 &&
          compareBuilds(to, build)! <= 0
        )
          previous = from;
      }
    } catch {
      /* A corrupt old update marker is not an update. */
    }
  }
  // Never replace a newer observed version after a rollback.
  if (!isBuildId(lastBuild) || compareBuilds(lastBuild, build)! < 0)
    write(storage, SEEN_BUILD, build);
  const upgraded = previous !== null && compareBuilds(previous, build)! < 0;
  const releases = upgraded ? selectReleases(build, previous) : [];
  // A first install or an update without notes is consumed silently.
  const newest = releases[0];
  const acknowledged = newest
    ? read(storage, ACKNOWLEDGED) === newest.version || memoryAcknowledged.has(newest.version)
    : true;
  return { previousBuild: previous, releases, show: releases.length > 0 && !acknowledged };
}

export function acknowledgeRelease(storage: StorageAccess, version = LATEST_RELEASE.version) {
  memoryAcknowledged.add(version);
  write(storage, ACKNOWLEDGED, version);
}

export function browserStorage(kind: "localStorage" | "sessionStorage"): StorageAccess {
  try {
    return window[kind];
  } catch {
    return null;
  }
}
