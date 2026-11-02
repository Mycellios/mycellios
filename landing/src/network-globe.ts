import { BORDERS_B64, LAND_GRID_B64 } from "./network-land";

import type { GeoPoint } from "./network-location";
export { placeWorker, type GeoPoint, type WorkerPlacement } from "./network-location";

/** A point on the unit sphere: [x, y, z] with +y north and +z toward lon 0. */
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

/** Longitude/latitude in degrees to a unit vector. */
export function sphere(lon: number, lat: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)];
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }
  // Server-side rendering and the test runner have no atob.
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Land cell centres as a flat Float32Array of unit vectors (3 floats per point).
 * The source bitmap is a regular 1deg graticule, so the projected dots settle
 * into even latitude rows - that engineered lattice is the intended look.
 */
export const LAND_POINTS: Float32Array = (() => {
  const packed = decodeBase64(LAND_GRID_B64);
  const values: number[] = [];
  for (let row = 0; row < 180; row += 1) {
    const lat = 90 - row - 0.5;
    for (let col = 0; col < 360; col += 1) {
      const index = row * 360 + col;
      if (!((packed[index >> 3]! >> (7 - (index & 7))) & 1)) continue;
      const [x, y, z] = sphere(col - 180 + 0.5, lat);
      values.push(x, y, z);
    }
  }
  return new Float32Array(values);
})();

/** Country boundaries as unit-vector polylines (3 floats per vertex). */
export const BORDER_LINES: readonly Float32Array[] = (() => {
  const bytes = decodeBase64(BORDERS_B64);
  const lines: Float32Array[] = [];
  let cursor = 0;
  const readVarint = (): number => {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = bytes[cursor++] ?? 0;
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    // Undo the zig-zag.
    return (result >>> 1) ^ -(result & 1);
  };
  while (cursor < bytes.length) {
    const count = readVarint();
    if (count <= 0 || count > 100_000) break;
    const line = new Float32Array(count * 3);
    let lonUnit = 0;
    let latUnit = 0;
    for (let index = 0; index < count; index += 1) {
      lonUnit += readVarint();
      latUnit += readVarint();
      const [x, y, z] = sphere(lonUnit / 10 - 180, latUnit / 10 - 90);
      line[index * 3] = x;
      line[index * 3 + 1] = y;
      line[index * 3 + 2] = z;
    }
    lines.push(line);
  }
  return lines;
})();

/**
 * Rotates a unit vector by yaw (around the polar axis) then tilt (toward the
 * viewer). Writes into `out` so hot render loops allocate nothing.
 */
export function rotatePoint(
  point: ArrayLike<number>,
  offset: number,
  sinYaw: number,
  cosYaw: number,
  sinTilt: number,
  cosTilt: number,
  out: Vec3,
): Vec3 {
  const px = point[offset]!;
  const py = point[offset + 1]!;
  const pz = point[offset + 2]!;
  const x = px * cosYaw + pz * sinYaw;
  const z = -px * sinYaw + pz * cosYaw;
  out[0] = x;
  out[1] = py * cosTilt - z * sinTilt;
  out[2] = py * sinTilt + z * cosTilt;
  return out;
}

/** Spherical linear interpolation between two unit vectors. */
export function slerp(from: Vec3, to: Vec3, fraction: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-4) return [from[0], from[1], from[2]];
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - fraction) * omega) / sinOmega;
  const b = Math.sin(fraction * omega) / sinOmega;
  return [
    from[0] * a + to[0] * b,
    from[1] * a + to[1] * b,
    from[2] * a + to[2] * b,
  ];
}

/**
 * Samples a great circle between two nodes and lifts the middle off the surface
 * so the arc reads as a hop rather than a line painted on the sphere.
 */
export function buildArc(from: Vec3, to: Vec3, samples = 28, lift = 0.16): Float32Array {
  const points = new Float32Array(samples * 3);
  for (let index = 0; index < samples; index += 1) {
    const fraction = index / (samples - 1);
    const point = slerp(from, to, fraction);
    const scale = 1 + lift * Math.sin(fraction * Math.PI);
    points[index * 3] = point[0] * scale;
    points[index * 3 + 1] = point[1] * scale;
    points[index * 3 + 2] = point[2] * scale;
  }
  return points;
}

/**
 * The visitor's approximate position from their IANA time zone. No IP lookup and
 * no network call: it only decides which face of the globe greets them.
 */
const TIMEZONE_COORDINATES: Record<string, GeoPoint> = {
  "Europe/Madrid": { lon: -3.7, lat: 40.4 },
  "Europe/Lisbon": { lon: -9.1, lat: 38.7 },
  "Europe/London": { lon: -0.1, lat: 51.5 },
  "Europe/Dublin": { lon: -6.3, lat: 53.3 },
  "Europe/Paris": { lon: 2.4, lat: 48.9 },
  "Europe/Brussels": { lon: 4.3, lat: 50.8 },
  "Europe/Amsterdam": { lon: 4.9, lat: 52.4 },
  "Europe/Berlin": { lon: 13.4, lat: 52.5 },
  "Europe/Zurich": { lon: 8.5, lat: 47.4 },
  "Europe/Vienna": { lon: 16.4, lat: 48.2 },
  "Europe/Prague": { lon: 14.4, lat: 50.1 },
  "Europe/Rome": { lon: 12.5, lat: 41.9 },
  "Europe/Warsaw": { lon: 21.0, lat: 52.2 },
  "Europe/Bucharest": { lon: 26.1, lat: 44.4 },
  "Europe/Sofia": { lon: 23.3, lat: 42.7 },
  "Europe/Athens": { lon: 23.7, lat: 38.0 },
  "Europe/Stockholm": { lon: 18.1, lat: 59.3 },
  "Europe/Helsinki": { lon: 25.0, lat: 60.2 },
  "Europe/Oslo": { lon: 10.8, lat: 59.9 },
  "Europe/Copenhagen": { lon: 12.6, lat: 55.7 },
  "Europe/Kyiv": { lon: 30.5, lat: 50.5 },
  "Europe/Moscow": { lon: 37.6, lat: 55.8 },
  "Europe/Istanbul": { lon: 29.0, lat: 41.0 },
  "Atlantic/Reykjavik": { lon: -21.9, lat: 64.1 },
  "America/New_York": { lon: -74.0, lat: 40.7 },
  "America/Toronto": { lon: -79.4, lat: 43.7 },
  "America/Chicago": { lon: -87.6, lat: 41.9 },
  "America/Denver": { lon: -105.0, lat: 39.7 },
  "America/Los_Angeles": { lon: -118.2, lat: 34.1 },
  "America/Vancouver": { lon: -123.1, lat: 49.3 },
  "America/Mexico_City": { lon: -99.1, lat: 19.4 },
  "America/Sao_Paulo": { lon: -46.6, lat: -23.6 },
  "America/Bogota": { lon: -74.1, lat: 4.7 },
  "America/Lima": { lon: -77.0, lat: -12.0 },
  "America/Argentina/Buenos_Aires": { lon: -58.4, lat: -34.6 },
  "America/Santiago": { lon: -70.7, lat: -33.5 },
  "Africa/Lagos": { lon: 3.4, lat: 6.5 },
  "Africa/Nairobi": { lon: 36.8, lat: -1.3 },
  "Africa/Cairo": { lon: 31.2, lat: 30.0 },
  "Africa/Johannesburg": { lon: 28.0, lat: -26.2 },
  "Asia/Dubai": { lon: 55.3, lat: 25.2 },
  "Asia/Jerusalem": { lon: 34.8, lat: 32.1 },
  "Asia/Kolkata": { lon: 77.6, lat: 13.0 },
  "Asia/Bangkok": { lon: 100.5, lat: 13.8 },
  "Asia/Singapore": { lon: 103.8, lat: 1.4 },
  "Asia/Jakarta": { lon: 106.8, lat: -6.2 },
  "Asia/Manila": { lon: 121.0, lat: 14.6 },
  "Asia/Hong_Kong": { lon: 114.2, lat: 22.3 },
  "Asia/Shanghai": { lon: 121.5, lat: 31.2 },
  "Asia/Tokyo": { lon: 139.7, lat: 35.7 },
  "Asia/Seoul": { lon: 127.0, lat: 37.6 },
  "Australia/Sydney": { lon: 151.2, lat: -33.9 },
  "Australia/Melbourne": { lon: 145.0, lat: -37.8 },
  "Pacific/Auckland": { lon: 174.8, lat: -36.9 },
};

const CONTINENT_LATITUDE: Record<string, number> = {
  Europe: 50, America: 38, Asia: 32, Africa: 6,
  Australia: -30, Pacific: -8, Atlantic: 38, Indian: -20,
};

export function visitorLocation(): GeoPoint {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    const known = TIMEZONE_COORDINATES[zone];
    if (known) return known;
    // Unknown zone: the UTC offset still gives a usable longitude.
    const lon = Math.max(-180, Math.min(180, (-new Date().getTimezoneOffset() / 60) * 15));
    const lat = CONTINENT_LATITUDE[zone.split("/")[0] ?? ""] ?? 30;
    return { lon, lat };
  } catch {
    return { lon: -3.7, lat: 40.4 };
  }
}
