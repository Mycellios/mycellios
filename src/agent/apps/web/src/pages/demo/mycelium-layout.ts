/** Illustrative community geometry, never measured physical routes or traffic. */
export interface MyceliumPoint { number: number; x: number; y: number }
export interface MyceliumBranch { key: string; a: number; b: number; path: string; filaments: string[] }
const round = (n: number) => Math.round(n * 100) / 100;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

// Admission ordinal owns the location. Polling, departures and input order cannot move peers.
export function myceliumPoint(number: number): MyceliumPoint {
  const radius = 170 + Math.sqrt(number - 1) * 38;
  const angle = number * goldenAngle - 0.8;
  return { number, x: round(500 + Math.cos(angle) * radius), y: round(320 + Math.sin(angle) * radius * .62) };
}
function branch(a: MyceliumPoint, b: MyceliumPoint): MyceliumBranch {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  const bend = ((a.number + b.number) % 2 ? 1 : -1) * Math.min(42, length * .2);
  const path = (offset: number) => `M ${a.x} ${a.y} C ${round(a.x + dx * .28 + nx * (bend + offset))} ${round(a.y + dy * .28 + ny * (bend + offset))} ${round(a.x + dx * .74 - nx * (bend - offset))} ${round(a.y + dy * .74 - ny * (bend - offset))} ${b.x} ${b.y}`;
  return { key: `${a.number}:${b.number}`, a: a.number, b: b.number, path: path(0), filaments: [-12, -5, 6, 13].map(path) };
}
export function myceliumLayout(numbers: number[]) {
  const points = [...new Set(numbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 50))].sort((a, b) => a - b).map(myceliumPoint);
  const branches: MyceliumBranch[] = [];
  // Two close predecessors form an expanding peer mesh, rather than a central server star.
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    const nearest = points.slice(0, i).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
    for (const peer of nearest.slice(0, 2)) branches.push(branch(peer, point));
  }
  return { points, branches };
}

/** Unlabelled botanical ornament; these strands do not represent extra devices. */
export function myceliumSeed() {
  return Array.from({ length: 18 }, (_, i) => {
    const angle = i * Math.PI * 2 / 18;
    const radius = 95 + (i % 4) * 16;
    const x = 500 + Math.cos(angle) * radius, y = 320 + Math.sin(angle) * radius * .64;
    const sx = 500 + Math.cos(angle + .35) * 33, sy = 320 + Math.sin(angle + .35) * 24;
    return `M ${round(sx)} ${round(sy)} C ${round(500 + Math.cos(angle - .5) * 70)} ${round(320 + Math.sin(angle - .5) * 40)} ${round(x - Math.sin(angle) * 28)} ${round(y + Math.cos(angle) * 18)} ${round(x)} ${round(y)} m 0 0 q ${round(Math.cos(angle - .65) * 28)} ${round(Math.sin(angle - .65) * 22)} ${round(Math.cos(angle - .4) * 45)} ${round(Math.sin(angle - .4) * 34)} M ${round(x)} ${round(y)} q ${round(Math.cos(angle + .8) * 20)} ${round(Math.sin(angle + .8) * 14)} ${round(Math.cos(angle + .6) * 38)} ${round(Math.sin(angle + .6) * 28)}`;
  });
}
