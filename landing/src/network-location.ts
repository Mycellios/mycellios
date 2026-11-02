export interface GeoPoint { lon: number; lat: number; }

/** Approximate city coordinates are used only when a worker declares that city. */
const REGION_COORDINATES: Record<string, GeoPoint> = {
  madrid: { lon: -3.7, lat: 40.4 },
  barcelona: { lon: 2.2, lat: 41.4 },
  valencia: { lon: -0.4, lat: 39.5 },
  lisbon: { lon: -9.1, lat: 38.7 },
  london: { lon: -0.1, lat: 51.5 },
  dublin: { lon: -6.3, lat: 53.3 },
  paris: { lon: 2.4, lat: 48.9 },
  amsterdam: { lon: 4.9, lat: 52.4 },
  brussels: { lon: 4.3, lat: 50.8 },
  ghent: { lon: 3.7, lat: 51.0 },
  frankfurt: { lon: 8.7, lat: 50.1 },
  berlin: { lon: 13.4, lat: 52.5 },
  nuremberg: { lon: 11.1, lat: 49.5 },
  munich: { lon: 11.6, lat: 48.1 },
  zurich: { lon: 8.5, lat: 47.4 },
  vienna: { lon: 16.4, lat: 48.2 },
  prague: { lon: 14.4, lat: 50.1 },
  milan: { lon: 9.2, lat: 45.5 },
  rome: { lon: 12.5, lat: 41.9 },
  warsaw: { lon: 21.0, lat: 52.2 },
  bucharest: { lon: 26.1, lat: 44.4 },
  sofia: { lon: 23.3, lat: 42.7 },
  athens: { lon: 23.7, lat: 38.0 },
  vilnius: { lon: 25.3, lat: 54.7 },
  stockholm: { lon: 18.1, lat: 59.3 },
  helsinki: { lon: 25.0, lat: 60.2 },
  oslo: { lon: 10.8, lat: 59.9 },
  copenhagen: { lon: 12.6, lat: 55.7 },
  reykjavik: { lon: -21.9, lat: 64.1 },
  istanbul: { lon: 29.0, lat: 41.0 },
  "tel aviv": { lon: 34.8, lat: 32.1 },
  dubai: { lon: 55.3, lat: 25.2 },
  mumbai: { lon: 72.9, lat: 19.1 },
  bangalore: { lon: 77.6, lat: 13.0 },
  delhi: { lon: 77.2, lat: 28.6 },
  singapore: { lon: 103.8, lat: 1.4 },
  bangkok: { lon: 100.5, lat: 13.8 },
  jakarta: { lon: 106.8, lat: -6.2 },
  manila: { lon: 121.0, lat: 14.6 },
  "hong kong": { lon: 114.2, lat: 22.3 },
  shanghai: { lon: 121.5, lat: 31.2 },
  tokyo: { lon: 139.7, lat: 35.7 },
  osaka: { lon: 135.5, lat: 34.7 },
  seoul: { lon: 127.0, lat: 37.6 },
  sydney: { lon: 151.2, lat: -33.9 },
  melbourne: { lon: 145.0, lat: -37.8 },
  auckland: { lon: 174.8, lat: -36.9 },
  "new york": { lon: -74.0, lat: 40.7 },
  boston: { lon: -71.1, lat: 42.4 },
  toronto: { lon: -79.4, lat: 43.7 },
  montreal: { lon: -73.6, lat: 45.5 },
  chicago: { lon: -87.6, lat: 41.9 },
  atlanta: { lon: -84.4, lat: 33.8 },
  miami: { lon: -80.2, lat: 25.8 },
  austin: { lon: -97.7, lat: 30.3 },
  dallas: { lon: -96.8, lat: 32.8 },
  denver: { lon: -105.0, lat: 39.7 },
  seattle: { lon: -122.3, lat: 47.6 },
  portland: { lon: -122.7, lat: 45.5 },
  "san francisco": { lon: -122.4, lat: 37.8 },
  "los angeles": { lon: -118.2, lat: 34.1 },
  "mexico city": { lon: -99.1, lat: 19.4 },
  "sao paulo": { lon: -46.6, lat: -23.6 },
  "rio de janeiro": { lon: -43.2, lat: -22.9 },
  "buenos aires": { lon: -58.4, lat: -34.6 },
  santiago: { lon: -70.7, lat: -33.5 },
  bogota: { lon: -74.1, lat: 4.7 },
  lima: { lon: -77.0, lat: -12.0 },
  johannesburg: { lon: 28.0, lat: -26.2 },
  "cape town": { lon: 18.4, lat: -33.9 },
  lagos: { lon: 3.4, lat: 6.5 },
  nairobi: { lon: 36.8, lat: -1.3 },
  cairo: { lon: 31.2, lat: 30.0 },
};

/** Rough country label for a region, used by the inspector and the join feed. */
const REGION_COUNTRY: Record<string, string> = {
  madrid: "Spain", barcelona: "Spain", valencia: "Spain", lisbon: "Portugal",
  london: "United Kingdom", dublin: "Ireland", paris: "France", amsterdam: "Netherlands",
  brussels: "Belgium", ghent: "Belgium", frankfurt: "Germany", berlin: "Germany",
  nuremberg: "Germany", munich: "Germany", zurich: "Switzerland", vienna: "Austria",
  prague: "Czechia", milan: "Italy", rome: "Italy", warsaw: "Poland",
  bucharest: "Romania", sofia: "Bulgaria", athens: "Greece", vilnius: "Lithuania",
  stockholm: "Sweden", helsinki: "Finland", oslo: "Norway", copenhagen: "Denmark",
  reykjavik: "Iceland", istanbul: "Turkey", "tel aviv": "Israel", dubai: "UAE",
  mumbai: "India", bangalore: "India", delhi: "India", singapore: "Singapore",
  bangkok: "Thailand", jakarta: "Indonesia", manila: "Philippines",
  "hong kong": "Hong Kong", shanghai: "China", tokyo: "Japan", osaka: "Japan",
  seoul: "South Korea", sydney: "Australia", melbourne: "Australia",
  auckland: "New Zealand", "new york": "United States", boston: "United States",
  toronto: "Canada", montreal: "Canada", chicago: "United States",
  atlanta: "United States", miami: "United States", austin: "United States",
  dallas: "United States", denver: "United States", seattle: "United States",
  portland: "United States", "san francisco": "United States",
  "los angeles": "United States", "mexico city": "Mexico", "sao paulo": "Brazil",
  "rio de janeiro": "Brazil", "buenos aires": "Argentina", santiago: "Chile",
  bogota: "Colombia", lima: "Peru", johannesburg: "South Africa",
  "cape town": "South Africa", lagos: "Nigeria", nairobi: "Kenya", cairo: "Egypt",
};

export interface WorkerPlacement extends GeoPoint {
  /** True when the region label resolved to real city coordinates. */
  located: boolean;
  /** Country for a resolved region, otherwise null. */
  country: string | null;
}

export function placeWorker(region: string, _workerId?: string): WorkerPlacement | null {
  const normalized = region.trim().toLowerCase();
  const matched = normalized && normalized !== "auto"
    ? (REGION_COORDINATES[normalized]
      ? normalized
      : Object.keys(REGION_COORDINATES).find((city) => new RegExp(`(^|[\\s,/_-])${city}($|[\\s,/_-])`).test(normalized)))
    : undefined;
  if (matched) {
    return { ...REGION_COORDINATES[matched]!, located: true, country: REGION_COUNTRY[matched] ?? null };
  }
  return null;
}
