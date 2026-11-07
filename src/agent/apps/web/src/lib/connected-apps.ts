import type { Connection, ConnectionCatalogItem } from "@rakazo/contracts";
import { matchFeaturedConnectorId } from "@rakazo/core";

function isFamiliarApp(item: ConnectionCatalogItem) {
  return (
    matchFeaturedConnectorId(item.slug) !== null ||
    matchFeaturedConnectorId(item.name) !== null ||
    item.slug.toLowerCase() === "github"
  );
}

const shortcutApps = ["gmail", "github", "google-calendar"];

function shortcutRank(item: ConnectionCatalogItem) {
  const rank = shortcutApps.findIndex(
    (id) =>
      item.slug.toLowerCase() === id ||
      item.name.toLowerCase() === id ||
      matchFeaturedConnectorId(item.slug) === id ||
      matchFeaturedConnectorId(item.name) === id,
  );
  return rank === -1 ? shortcutApps.length : rank;
}

/** Decorative suggestions for the connection shortcut, drawn from the available catalog. */
export function connectedAppMarks(
  catalog: readonly ConnectionCatalogItem[],
  connections: readonly Connection[],
) {
  const connected = new Set(
    catalog.filter(
      (item) =>
        item.connected ||
        connections.some(
          (row) =>
            row.status === "connected" &&
            row.connectorId === item.connectorId &&
            row.provider.toLowerCase() === item.slug.toLowerCase(),
        ),
    ),
  );
  const apps = [...catalog]
    .sort(
      (a, b) =>
        shortcutRank(a) - shortcutRank(b) ||
        Number(connected.has(b)) - Number(connected.has(a)) ||
        Number(Boolean(b.logo)) - Number(Boolean(a.logo)) ||
        Number(isFamiliarApp(b)) - Number(isFamiliarApp(a)),
    )
    .filter((item, index, apps) => apps.findIndex((app) => app.name === item.name) === index);
  const initials = new Set<string>();
  const preferred = apps.filter((app) => {
    if (app.logo || shortcutRank(app) < shortcutApps.length) return true;
    const initial = app.name[0]?.toUpperCase() ?? "";
    if (initials.has(initial)) return false;
    initials.add(initial);
    return true;
  });
  return [...preferred, ...apps.filter((app) => !preferred.includes(app))]
    .slice(0, 3)
    .map(({ name, logo }) => ({ name, logo }));
}
