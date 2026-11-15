/** Deterministic artwork, not network telemetry or a wallet balance. */
export function distributedEarnArtwork() {
  const nodes: Array<{ id: number; x: number; y: number; mobile: boolean }> = [];
  let seed = 0x28b77f;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // Seeded spacing makes the mesh organic without layout shifts or overlapping bodies.
  for (let attempt = 0; nodes.length < 49 && attempt < 4096; attempt++) {
    const x = 60 + Math.round(next() * 1080), y = 42 + Math.round(next() * 470);
    if (nodes.every(node => (node.x - x) ** 2 + (node.y - y) ** 2 > 80 ** 2)) {
      const id = nodes.length; nodes.push({ id, x, y, mobile: id % 2 === 0 });
    }
  }
  const pairs = new Set<string>();
  const distance = (a: typeof nodes[number], b: typeof nodes[number]) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const add = (a: number, b: number) => { if (a !== b) pairs.add([a, b].sort((x, y) => x - y).join(":")); };
  // Both responsive views form a peer mesh, without a privileged central machine.
  const connect = (list: typeof nodes) => {
    const connected = new Set([list[0]!.id]);
    while (connected.size < list.length) {
      let closest: [number, number] | undefined, best = Infinity;
      for (const a of list) if (connected.has(a.id)) for (const b of list) if (!connected.has(b.id)) {
        const d = distance(a, b);
        if (d < best) { best = d; closest = [a.id, b.id]; }
      }
      add(...closest!); connected.add(closest![1]);
    }
  };
  connect(nodes); connect(nodes.filter(node => node.mobile));
  for (const node of nodes) {
    const neighbor = nodes.filter(other => other.id !== node.id).sort((a, b) => distance(node, a) - distance(node, b))[1]!;
    add(node.id, neighbor.id);
  }
  const edges = [...pairs].map(pair => {
    const [a, b] = pair.split(":").map(Number), from = nodes[a!]!, to = nodes[b!]!;
    const bend = (from.id % 2 ? 1 : -1) * 28;
    return { id: pair, from: from.id, to: to.id, mobile: from.mobile && to.mobile,
      path: `M${from.x} ${from.y}C${from.x + (to.x - from.x) * .35} ${from.y + bend} ${to.x - (to.x - from.x) * .35} ${to.y - bend} ${to.x} ${to.y}` };
  });
  return { nodes, edges };
}
