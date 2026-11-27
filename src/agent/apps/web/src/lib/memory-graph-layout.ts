/**
 * A small deterministic force layout for the memory graph: linked notes pull together,
 * every note pushes its near neighbours away, and a weak pull keeps the graph centred.
 * Repulsion only looks at nearby grid cells, so a tick stays linear in the note count.
 */

export type LayoutEdge = { source: number; target: number };

export type GraphLayout = {
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Advances one tick; false once the layout has settled. */
  step(): boolean;
  /** Runs up to `ticks` steps at once (reduced motion, tests). */
  settle(ticks?: number): void;
  readonly alpha: number;
  reheat(alpha?: number): void;
  pin(index: number, x: number, y: number): void;
  unpin(index: number): void;
};

const LINK_DISTANCE = 70;
const LINK_STRENGTH = 0.08;
const REPULSION = 2600;
const REPULSION_RANGE = 260;
const GRAVITY = 0.012;
const DAMPING = 0.6;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.004;
const MAX_SPEED = 40;

/** Stable 32-bit hash so the same notes start (and settle) in the same place. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createGraphLayout(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
): GraphLayout {
  const count = ids.length;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const pinned = new Uint8Array(count);
  const linkCount = new Uint16Array(count);
  for (const { source, target } of edges) {
    linkCount[source] = Math.min(65535, linkCount[source]! + 1);
    linkCount[target] = Math.min(65535, linkCount[target]! + 1);
  }
  // Phyllotaxis start ordered by a stable hash: even spread, no overlaps, same every time.
  const order = ids
    .map((id, index) => ({ index, key: hash(id) }))
    .sort((a, b) => a.key - b.key || a.index - b.index);
  const golden = Math.PI * (3 - Math.sqrt(5));
  order.forEach(({ index }, rank) => {
    const radius = 18 * Math.sqrt(rank + 0.5);
    x[index] = radius * Math.cos(rank * golden);
    y[index] = radius * Math.sin(rank * golden);
  });

  let alpha = 1;
  const cellSize = REPULSION_RANGE;
  const cells = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

  function tick() {
    cells.clear();
    for (let i = 0; i < count; i += 1) {
      const key = cellKey(Math.floor(x[i]! / cellSize), Math.floor(y[i]! / cellSize));
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor(x[i]! / cellSize);
      const cy = Math.floor(y[i]! / cellSize);
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1) {
          const list = cells.get(cellKey(cx + dx, cy + dy));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            let ddx = x[i]! - x[j]!;
            let ddy = y[i]! - y[j]!;
            let distance2 = ddx * ddx + ddy * ddy;
            if (distance2 === 0) {
              // Coincident points split along a direction derived from their indices.
              ddx = ((i * 7 + j) % 5) - 2 || 1;
              ddy = ((i + j * 3) % 5) - 2 || 1;
              distance2 = ddx * ddx + ddy * ddy;
            }
            if (distance2 > REPULSION_RANGE * REPULSION_RANGE) continue;
            const force = (REPULSION * alpha) / Math.max(distance2, 25);
            const distance = Math.sqrt(distance2);
            const fx = (ddx / distance) * force;
            const fy = (ddy / distance) * force;
            vx[i] = vx[i]! + fx;
            vy[i] = vy[i]! + fy;
            vx[j] = vx[j]! - fx;
            vy[j] = vy[j]! - fy;
          }
        }
    }
    for (const { source, target } of edges) {
      const ddx = x[target]! - x[source]!;
      const ddy = y[target]! - y[source]!;
      const distance = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      // Hubs stretch less per link so their neighbours ring them instead of piling up.
      const strength =
        (LINK_STRENGTH * alpha) / Math.sqrt(Math.min(linkCount[source]!, linkCount[target]!) || 1);
      const delta = ((distance - LINK_DISTANCE) / distance) * strength;
      const fx = ddx * delta;
      const fy = ddy * delta;
      vx[source] = vx[source]! + fx;
      vy[source] = vy[source]! + fy;
      vx[target] = vx[target]! - fx;
      vy[target] = vy[target]! - fy;
    }
    for (let i = 0; i < count; i += 1) {
      if (pinned[i]) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] = (vx[i]! - x[i]! * GRAVITY * alpha) * DAMPING;
      vy[i] = (vy[i]! - y[i]! * GRAVITY * alpha) * DAMPING;
      const speed = Math.hypot(vx[i]!, vy[i]!);
      if (speed > MAX_SPEED) {
        vx[i] = (vx[i]! / speed) * MAX_SPEED;
        vy[i] = (vy[i]! / speed) * MAX_SPEED;
      }
      x[i] = x[i]! + vx[i]!;
      y[i] = y[i]! + vy[i]!;
    }
    alpha *= ALPHA_DECAY;
  }

  return {
    x,
    y,
    get alpha() {
      return alpha;
    },
    step() {
      if (alpha < ALPHA_MIN || count === 0) return false;
      tick();
      return alpha >= ALPHA_MIN;
    },
    settle(ticks = 400) {
      for (let i = 0; i < ticks && alpha >= ALPHA_MIN && count > 0; i += 1) tick();
    },
    reheat(next = 0.3) {
      alpha = Math.max(alpha, next);
    },
    pin(index, px, py) {
      pinned[index] = 1;
      x[index] = px;
      y[index] = py;
    },
    unpin(index) {
      pinned[index] = 0;
    },
  };
}
