import { compareBuilds, isBuildId } from "@rakazo/contracts/client-build";

export const RELEASE_NOTES = {
  id: "2026-11-06-workspace-integrations",
  version: "2026.11.06",
  date: "2026-11-06",
  minimumBuild: "20261106101815",
} as const;
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
  const available = compareBuilds(RELEASE_NOTES.minimumBuild, build)! <= 0;
  const acknowledged =
    read(storage, ACKNOWLEDGED) === RELEASE_NOTES.id || memoryAcknowledged.has(RELEASE_NOTES.id);
  return { previousBuild: previous, show: upgraded && available && !acknowledged };
}

export function acknowledgeRelease(storage: StorageAccess) {
  memoryAcknowledged.add(RELEASE_NOTES.id);
  write(storage, ACKNOWLEDGED, RELEASE_NOTES.id);
}

export function browserStorage(kind: "localStorage" | "sessionStorage"): StorageAccess {
  try {
    return window[kind];
  } catch {
    return null;
  }
}
