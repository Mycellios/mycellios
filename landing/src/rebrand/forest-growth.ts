export interface SceneRect { x: number; y: number; width: number; height: number }
type GrowthPoint = readonly [number, number, number];

// Arrival times follow roots first, then the equipment and the tree trunks.
const branches: readonly (readonly GrowthPoint[])[] = [
  [[.52, 1, .01], [.48, .83, .12], [.38, .72, .24], [.38, .5, .43], [.39, .25, .62], [.39, 0, .83]],
  [[.48, .83, .12], [.27, .85, .2], [.15, .74, .29], [.14, .48, .49], [.13, .25, .69], [.12, 0, .88]],
  [[.52, 1, .01], [.69, .87, .17], [.84, .78, .3], [.88, .52, .49], [.86, .25, .68], [.86, 0, .88]],
  [[.27, .85, .2], [.08, .91, .37], [0, .7, .56]],
  [[.69, .87, .17], [.92, .94, .38], [1, .7, .57]],
  [[.38, .72, .24], [.22, .51, .45], [.1, .32, .64], [.04, 0, .87]],
  [[.54, .78, .24], [.63, .55, .43], [.64, .27, .68], [.65, 0, .88]],
  [[.84, .78, .3], [.96, .49, .55], [.97, .22, .75], [1, 0, .94]],
  [[.38, .5, .43], [.56, .43, .53], [.77, .46, .64], [.87, .52, .71]],
];

/** A deterministic small mask; no per-frame noise or layout measurements. */
export function createGrowthField(width: number, height: number): Float32Array {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x / Math.max(1, width - 1), py = y / Math.max(1, height - 1);
    let arrival = 2;
    for (const branch of branches) for (let i = 1; i < branch.length; i++) {
      const a = branch[i - 1]!, b = branch[i]!;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const projection = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot((px - a[0] - projection * dx) * 1.5, py - a[1] - projection * dy);
      arrival = Math.min(arrival, a[2] + (b[2] - a[2]) * projection + distance * 2.8);
    }
    const grain = Math.sin(px * 101 + Math.sin(py * 71) * 3) * Math.sin(py * 83 + Math.sin(px * 53) * 4);
    values[y * width + x] = Math.max(.015, Math.min(.985, arrival + grain * .038));
  }
  return values;
}

export function growthAlpha(arrival: number, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 255;
  return Math.round(Math.max(0, Math.min(1, (progress - arrival) * 45 + .5)) * 255);
}

export function containScene(width: number, height: number, ratio = 2): SceneRect {
  const w = Math.min(width, height * ratio);
  return { x: (width - w) / 2, y: (height - w / ratio) / 2, width: w, height: w / ratio };
}

export function interpolateRect(a: SceneRect, b: SceneRect, progress: number): SceneRect {
  const t = Math.max(0, Math.min(1, progress));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t };
}
