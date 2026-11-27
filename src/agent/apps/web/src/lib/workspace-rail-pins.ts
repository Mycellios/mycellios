export const RAIL_PAGES = [
  "routines",
  "workflows",
  "tasks",
  "schedule",
  "usage",
  "activity",
  "files",
  "memory",
  "marketplace",
  "board",
] as const;
export type RailPage = (typeof RAIL_PAGES)[number];
export const DEFAULT_RAIL_PINS: readonly RailPage[] = [
  ...RAIL_PAGES.slice(0, 5),
  "files",
  "memory",
];

/**
 * Pages added to the default pins after people had saved their own. Each is appended once
 * to a saved list, then remembered, so unpinning it later sticks.
 */
const ADDED_DEFAULT_PINS: readonly { page: RailPage; marker: string }[] = [
  { page: "memory", marker: "memory" },
];

export function railPinsKey(scope: string) {
  return `mycellios:workspace-rail-pins:v1:${scope}`;
}

function addedPinsKey(scope: string) {
  return `mycellios:workspace-rail-pins-added:v1:${scope}`;
}

function readAdded(scope: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(addedPinsKey(scope)) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function readRailPins(scope: string): RailPage[] {
  try {
    const raw = window.localStorage.getItem(railPinsKey(scope));
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        const migrated = value.map((id) => (id === "connections" ? "marketplace" : id));
        const added = readAdded(scope);
        const missing = ADDED_DEFAULT_PINS.filter((entry) => !added.includes(entry.marker));
        if (missing.length) {
          for (const entry of missing)
            if (!migrated.includes(entry.page)) migrated.push(entry.page);
          const pins = RAIL_PAGES.filter((id) => migrated.includes(id));
          try {
            window.localStorage.setItem(railPinsKey(scope), JSON.stringify(pins));
            window.localStorage.setItem(
              addedPinsKey(scope),
              JSON.stringify([...added, ...missing.map((entry) => entry.marker)]),
            );
          } catch {
            /* Without storage the page stays pinned for this window only. */
          }
          return pins;
        }
        return RAIL_PAGES.filter((id) => migrated.includes(id));
      }
    }
  } catch {
    /* Storage may be disabled or corrupt; keep navigation usable. */
  }
  return [...DEFAULT_RAIL_PINS];
}

export function writeRailPins(scope: string, pins: readonly RailPage[]) {
  try {
    window.localStorage.setItem(railPinsKey(scope), JSON.stringify(pins));
    // Choosing pins by hand settles every page added so far.
    window.localStorage.setItem(
      addedPinsKey(scope),
      JSON.stringify(ADDED_DEFAULT_PINS.map((entry) => entry.marker)),
    );
  } catch {
    /* The current window retains its in-memory preference. */
  }
}
