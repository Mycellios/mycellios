import type { ModelsDevRelease, ModelsDevSnapshot } from "./models-dev.js";
import { modelsDevName } from "./models-dev.js";
import { modelsDevService } from "./pi-live-model.js";

/**
 * How the model picker shows each model, from models.dev release dates. A provider's main list
 * holds its current models; the rest fold under Older models, and a recent release is marked
 * New. Only the picker changes: runs, backups and saved choices still reach every model.
 */
export type ModelListing = "new" | "older";

/** A provider that lists this many models or fewer folds only superseded models of a family. */
const SHORT_LIST = 12;
/** How many of the newest families a longer list shows. */
const NEWEST_FAMILIES = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A family this much older than the provider's newest family is a past generation. */
const FAMILY_AGE_LIMIT_MS = 120 * DAY_MS;
/** A model in the main list is New for this long after its release date. */
const NEW_MODEL_MS = 7 * DAY_MS;

type Release = { date: string; family: string; agentReady: boolean };
type Match = { id: string; release: Release | undefined };

function asRelease(release: ModelsDevRelease | undefined): Release | undefined {
  return release?.releaseDate
    ? { date: release.releaseDate, family: release.family, agentReady: release.agentReady }
    : undefined;
}

/** The release of the provider's model: its own service's entry, or the shared name elsewhere. */
function releaseOf(
  provider: string,
  id: string,
  snapshot: ModelsDevSnapshot,
): Release | undefined {
  const service = modelsDevService(provider, snapshot);
  if (service) return asRelease(snapshot.model(service, id));
  return asRelease(snapshot.releaseByName(id));
}

/**
 * The text around a model's version, and the version: `claude-fable-5-2` gives
 * `claude-fable-#` and `[5, 2]`; `gpt-6.1-sol` gives `gpt-#-sol` and `[6, 1]`. An eight-digit
 * build stamp is not a version, and each version part has at most three digits, so neither the
 * `70` of `llama-3-1-70b` nor a date such as `0528` counts as one.
 */
function versioned(id: string): { shape: string; version: number[] } | undefined {
  const name = modelsDevName(id).replace(/-\d{8}(?=-|$)/g, "");
  const found = /(?<=^|-)\d{1,3}(?:-\d{1,3})*(?=-|$)/.exec(name);
  if (!found) return undefined;
  return {
    shape: `${name.slice(0, found.index)}#${name.slice(found.index + found[0].length)}`,
    version: found[0].split("-").map(Number),
  };
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/**
 * models.dev adds a release some days after a provider lists it. Until then, a model that is a
 * newer version of a catalogued one (same text around the version) takes that family: the
 * newest such version is dated a day after the family's newest model so it leads the family;
 * any other takes the date of the version before it.
 */
function withNewerVersions(matches: readonly Match[]): Match[] {
  const named = matches.map((match) => ({ match, name: versioned(match.id) }));
  const shapes = new Map<string, { version: number[]; release: Release | undefined }[]>();
  const families = new Map<string, Release[]>();
  for (const { match, name } of named) {
    if (match.release?.family) {
      families.set(match.release.family, [
        ...(families.get(match.release.family) ?? []),
        match.release,
      ]);
    }
    if (name) {
      shapes.set(name.shape, [
        ...(shapes.get(name.shape) ?? []),
        { version: name.version, release: match.release },
      ]);
    }
  }
  return named.map(({ match, name }) => {
    if (match.release || !name) return match;
    const siblings = shapes.get(name.shape) ?? [];
    let previous: { version: number[]; release: Release } | undefined;
    for (const { version, release } of siblings) {
      if (!release) continue;
      if (compareVersions(name.version, version) <= 0) return match;
      if (!previous || compareVersions(version, previous.version) > 0) {
        previous = { version, release };
      }
    }
    if (!previous) return match;
    const family = previous.release.family
      ? (families.get(previous.release.family) ?? [previous.release])
      : [previous.release];
    const newest = siblings.every(
      ({ version, release }) => release || compareVersions(name.version, version) >= 0,
    );
    const latest = Date.parse(
      family.reduce((left, right) => (right.date > left.date ? right : left)).date,
    );
    if (Number.isNaN(latest)) return match;
    return {
      ...match,
      release: {
        family: previous.release.family,
        agentReady: family.some((member) => member.agentReady),
        date: newest
          ? new Date(latest + DAY_MS).toISOString().slice(0, 10)
          : previous.release.date,
      },
    };
  });
}

/** Every model except those the list has a newer model of the same family for. */
function newestOfEachFamily(matches: readonly Match[]): Set<string> {
  const newest = new Map<string, string>();
  for (const { release } of matches) {
    if (!release?.family) continue;
    const date = newest.get(release.family);
    if (date === undefined || release.date > date) newest.set(release.family, release.date);
  }
  return new Set(
    matches
      .filter(({ release }) => !release?.family || newest.get(release.family) === release.date)
      .map(({ id }) => id),
  );
}

/**
 * The provider's main list. A short list folds only superseded models of a family. A longer
 * one shows the newest agent-ready model of each of its newest families from the current
 * generation; a model models.dev lacks shows only when none of the provider's models is in it.
 */
function mainList(matches: readonly Match[]): Set<string> {
  if (matches.length <= SHORT_LIST) return newestOfEachFamily(matches);
  const catalogued = matches.some(({ release }) => release);
  const families = new Map<string, { id: string; date: string }>();
  for (const { id, release } of matches) {
    if (!release?.agentReady) continue;
    const family = release.family || id;
    const current = families.get(family);
    if (!current || release.date > current.date) families.set(family, { id, date: release.date });
  }
  const newest = [...families.values()].sort((left, right) => right.date.localeCompare(left.date));
  const cutoff = Date.parse(newest[0]?.date ?? "") - FAMILY_AGE_LIMIT_MS;
  const chosen = new Set(
    newest
      .slice(0, NEWEST_FAMILIES)
      .filter((entry) => !(Date.parse(entry.date) < cutoff))
      .map((entry) => entry.id),
  );
  return new Set(
    matches
      .filter(({ id, release }) => (release ? chosen.has(id) : !catalogued))
      .map(({ id }) => id),
  );
}

/**
 * Set `listing` on each model, per provider. `keep` holds `provider:id` keys that stay in the
 * main list whatever their age: saved choices, defaults and backups. `skipProviders` keep their
 * own order and grouping. Without models.dev the list is returned unchanged.
 */
export function applyModelListing<T extends { provider: string; id: string; recommended?: boolean }>(
  entries: readonly T[],
  snapshot: ModelsDevSnapshot | undefined,
  options: {
    keep?: ReadonlySet<string>;
    skipProviders?: readonly string[];
    now?: number;
  } = {},
): (T & { listing?: ModelListing })[] {
  if (!snapshot) return [...entries];
  const keep = options.keep ?? new Set<string>();
  const skip = new Set(options.skipProviders ?? []);
  const now = options.now ?? Date.now();
  const byProvider = new Map<string, T[]>();
  for (const entry of entries) {
    if (skip.has(entry.provider)) continue;
    const listed = byProvider.get(entry.provider);
    if (listed) listed.push(entry);
    else byProvider.set(entry.provider, [entry]);
  }
  const shown = new Map<string, { main: Set<string>; released: Map<string, string> }>();
  for (const [provider, listed] of byProvider) {
    const matches = withNewerVersions(
      listed.map((entry) => ({ id: entry.id, release: releaseOf(provider, entry.id, snapshot) })),
    );
    const main = mainList(matches);
    for (const entry of listed) if (entry.recommended) main.add(entry.id);
    const released = new Map<string, string>();
    for (const { id, release } of matches) if (release) released.set(id, release.date);
    shown.set(provider, { main, released });
  }
  return entries.map((entry) => {
    const picker = shown.get(entry.provider);
    if (!picker) return entry;
    const kept = keep.has(`${entry.provider}:${entry.id}`);
    if (picker.main.has(entry.id) || kept) {
      const released = Date.parse(picker.released.get(entry.id) ?? "");
      return now - released < NEW_MODEL_MS && picker.main.has(entry.id)
        ? { ...entry, listing: "new" as const }
        : entry;
    }
    return { ...entry, listing: "older" as const };
  });
}
