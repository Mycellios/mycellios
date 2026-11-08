export const RAIL_PAGES = [
  "routines",
  "workflows",
  "tasks",
  "schedule",
  "usage",
  "activity",
  "files",
  "marketplace",
  "board",
] as const;
export type RailPage = (typeof RAIL_PAGES)[number];
export const DEFAULT_RAIL_PINS: readonly RailPage[] = [...RAIL_PAGES.slice(0, 5), "files"];

export function railPinsKey(scope: string) {
  return `mycellios:workspace-rail-pins:v1:${scope}`;
}

export function readRailPins(scope: string): RailPage[] {
  try {
    const raw = window.localStorage.getItem(railPinsKey(scope));
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        const migrated = value.map((id) => (id === "connections" ? "marketplace" : id));
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
  } catch {
    /* The current window retains its in-memory preference. */
  }
}
