export interface MyceliumPoint { x: number; y: number }
export interface MyceliumRect { x: number; y: number; width: number; height: number }
export interface MyceliumLayout { width: number; height: number; source: MyceliumPoint; stage: MyceliumRect; compact: boolean }
export interface MyceliumStrand { points: MyceliumPoint[]; birth: number; duration: number; weight: number; seed: number }
export interface MyceliumSpore { origin: MyceliumPoint; birth: number; seed: number; radius: number }
export interface MyceliumGeometry { strands: MyceliumStrand[]; spores: MyceliumSpore[] }

function random(seed: number) { let state = seed; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
export function cubicPoints(a: MyceliumPoint, b: MyceliumPoint, c: MyceliumPoint, d: MyceliumPoint, count = 20): MyceliumPoint[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count, k = 1 - t;
    return { x: k*k*k*a.x + 3*k*k*t*b.x + 3*k*t*t*c.x + t*t*t*d.x, y: k*k*k*a.y + 3*k*k*t*b.y + 3*k*t*t*c.y + t*t*t*d.y };
  });
}

/** A measured, seeded botanical frame. It never stands for connected devices or earnings. */
export function createMyceliumGeometry(layout: MyceliumLayout): MyceliumGeometry {
  const { width, height, stage, compact } = layout;
  const rand = random(72819), strands: MyceliumStrand[] = [], spores: MyceliumSpore[] = [];
  const clamp = (value: number, max: number) => Math.max(3, Math.min(max - 3, value));
  const point = (x: number, y: number) => ({ x: clamp(x, width), y: clamp(y, height) });
  const left = Math.max(7, stage.x - (compact ? 7 : 17));
  const right = Math.min(width - 7, stage.x + stage.width + (compact ? 7 : 17));
  const top = stage.y - (compact ? 9 : 14), bottom = Math.min(height - 18, stage.y + stage.height * .92);
  const add = (points: MyceliumPoint[], birth: number, duration: number, weight: number) => {
    const strand = { points, birth, duration, weight, seed: rand() };
    strands.push(strand); return strand;
  };
  const source = point(layout.source.x, layout.source.y);
  const originStrand = add(cubicPoints(source, point(source.x - 65, source.y + 3), point(left - 6, source.y + 22), point(left, top)), .15, 2.7, 1.6);
  for (const index of [5, 10, 15]) spores.push({ origin: originStrand.points[index]!, birth: .15 + index / 20 * 2.7, seed: rand(), radius: 1.5 + rand() });
  add(cubicPoints(point(left, top), point(left + stage.width * .22, top - 18), point(right - stage.width * .2, top - 20), point(right, top)), 2.75, 2.15, 1.15);
  for (const [side, rail, birth] of [[-1, left, 2.8], [1, right, 4.85]] as const) {
    add(cubicPoints(point(rail, top), point(rail + side * 7, top + 100), point(rail - side * 5, bottom - 90), point(rail, bottom)), birth, 3.7, 1.35);
    const count = compact ? 9 : 17;
    let previousTip: MyceliumPoint | null = null;
    for (let i = 0; i < count; i++) {
      const t = .04 + i / count * .92;
      const y = top + (bottom - top) * t;
      const reach = compact ? 9 + rand() * 9 : 27 + rand() * Math.min(100, width * .075);
      const end = point(rail + side * reach, y - 40 - rand() * 66);
      const branch = add(cubicPoints(point(rail, y), point(rail + side * reach * .4, y - 8), point(end.x - side * 12, end.y + 32), end, 14), birth + t * 3.3, 1.2 + rand(), .45 + rand() * .5);
      if (!compact || i % 2 === 0) {
        const fork = branch.points[8]!;
        const leaf = point(end.x + side * (10 + rand() * 25), end.y + 20 + rand() * 18);
        add(cubicPoints(fork, point(fork.x + side * 12, fork.y), point(leaf.x, leaf.y + 14), leaf, 10), branch.birth + branch.duration * .55, .9, .35 + rand() * .25);
      }
      if (i % 2 === 0) spores.push({ origin: end, birth: branch.birth + branch.duration, seed: rand(), radius: 1 + rand() * 1.1 });
      if (previousTip && i % 4 === 3) add(cubicPoints(previousTip, point(previousTip.x + side * 15, previousTip.y + 20), point(end.x + side * 10, end.y - 25), end, 12), branch.birth + branch.duration, 1.5, .4);
      previousTip = end;
    }
  }
  // Fine hyphae grow above the app's crown, into the space below the introduction.
  for (let i = 0; i < (compact ? 8 : 14); i++) {
    const half = compact ? 4 : 7, t = i < half ? .015 + i / half * .22 : .78 + (i-half) / half * .20, x = left + (right - left) * t;
    const rise = (compact ? 17 : 26) + rand() * (compact ? 24 : 48);
    const start = point(x, top - Math.sin(t * Math.PI) * 14);
    const direction = t < .5 ? -1 : 1;
    const end = point(x + direction * (18 + rand() * 40), start.y - rise);
    add(cubicPoints(start, point(start.x + direction * 12, start.y - 12), point(end.x, end.y + 16), end, 14), 2.9 + t * 2.1, 1.1 + rand(), .35 + rand() * .35);
    if (i % 3 === 0) spores.push({ origin: end, birth: 5 + t * 2, seed: rand(), radius: .9 + rand() });
  }
  return { strands, spores };
}

export function strandPath(strand: MyceliumStrand): string {
  return strand.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
}

export function myceliumPixelRatio(width: number, height: number, deviceRatio: number): number {
  return Math.min(1.65, Math.max(1, deviceRatio), 1900 / Math.max(width, height));
}
