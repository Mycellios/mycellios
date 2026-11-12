type Point = { x: number; y: number };
type Hypha = { from: Point; to: Point; bend: Point; start: number; end: number; width: number };
let stopCurrent: (() => void) | undefined;

/** A brief acknowledgement, never an update progress indicator or a restart permit. */
export function playUpdateMycelium(origin?: Element | null, direction: "grow" | "gather" = "grow"): Promise<void> {
  try { return renderMycelium(origin, direction).catch(() => undefined); }
  catch { return Promise.resolve(); } // Decoration must never prevent downloading or restarting.
}

function renderMycelium(origin: Element | null | undefined, direction: "grow" | "gather"): Promise<void> {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" ||
      document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  stopCurrent?.();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve();
  const w = window.innerWidth, h = window.innerHeight;
  const box = origin?.getBoundingClientRect();
  const seed = box && box.width && box.height ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: w * 0.16, y: h * 0.9 };
  seed.x = Math.max(0, Math.min(w, seed.x)); seed.y = Math.max(0, Math.min(h, seed.y));
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.updateMycelium = direction;
  // Top-layer makes the same effect visible from Settings' native dialog.
  canvas.setAttribute("popover", "manual");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none",
    margin: "0", padding: "0", border: "0", background: "transparent", pointerEvents: "none", zIndex: "2147483647", overflow: "hidden" });
  document.body.append(canvas);
  try { canvas.showPopover?.(); } catch { /* A normal overlay remains available. */ }
  ctx.scale(ratio, ratio);
  const reach = Math.hypot(Math.max(seed.x, w - seed.x), Math.max(seed.y, h - seed.y));
  const strands: Hypha[] = [];
  let branchLimit = 0;
  let randomState = 47291;
  const random = () => ((randomState = (randomState * 16807) % 2147483647) - 1) / 2147483646;
  function branch(from: Point, heading: number, travelled: number, depth: number, length: number) {
    let p = from, angle = heading;
    for (let i = 0; i < length && (depth === 0 || strands.length < branchLimit); i++) {
      const step = 26 + random() * 27;
      angle += (random() - 0.5) * 0.43;
      const next = { x: p.x + Math.cos(angle) * step, y: p.y + Math.sin(angle) * step };
      strands.push({ from: p, to: next, bend: { x: (p.x + next.x) / 2 + Math.sin(angle) * (random() - 0.5) * 22,
        y: (p.y + next.y) / 2 - Math.cos(angle) * (random() - 0.5) * 22 }, start: travelled, end: travelled + step,
        width: Math.max(0.45, 1.5 - depth * 0.35 - travelled / reach * 0.6) });
      travelled += step; p = next;
      if (depth < 3 && i > 0 && random() < 0.32) branch(p, angle + (random() > 0.5 ? 1 : -1) * (0.4 + random() * 0.6), travelled, depth + 1, Math.max(2, Math.floor((length - i) * 0.58)));
      if (p.x < -80 || p.y < -80 || p.x > w + 80 || p.y > h + 80) break;
    }
  }
  for (let arm = 0; arm < 13; arm++) {
    branchLimit = strands.length + 48;
    branch(seed, arm / 13 * Math.PI * 2 + (random() - 0.5) * 0.15, 0, 0, Math.ceil(reach / 34));
  }
  // Depth-first construction gives each branch its own budget; the draw order is radial.
  strands.sort((a, b) => a.start - b.start);
  const maximum = Math.max(...strands.map(s => s.end), 1);
  return new Promise(resolve => {
    let frame = 0, timer: ReturnType<typeof setTimeout>;
    let ended = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      if (ended) return; ended = true;
      cancelAnimationFrame(frame); clearTimeout(timer); canvas.remove();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("resize", finish);
      motion.removeEventListener("change", finish);
      if (stopCurrent === finish) stopCurrent = undefined;
      resolve();
    };
    const visibility = () => { if (document.hidden) finish(); };
    stopCurrent = finish;
    document.addEventListener("visibilitychange", visibility); window.addEventListener("resize", finish);
    motion.addEventListener("change", finish);
    timer = setTimeout(finish, 1600); // A throttled frame must never hold an update action.
    const started = performance.now();
    const dark = document.documentElement.classList.contains("dark");
    function draw(now: number) {
      try {
      const t = Math.min(1, (now - started) / 1250);
      if (t >= 1) { finish(); return; }
      ctx!.clearRect(0, 0, w, h);
      const front = (direction === "grow" ? 1 - (1 - Math.min(1, t / 0.78)) ** 2 : (1 - Math.min(1, t / 0.85)) ** 1.5) * maximum;
      const fade = Math.min(1, t / 0.09) * Math.min(1, (1 - t) / 0.25);
      ctx!.fillStyle = `rgba(205,151,43,${fade * (dark ? 0.035 : 0.025)})`; ctx!.fillRect(0, 0, w, h);
      ctx!.lineCap = "round";
      for (const strand of strands) {
        const f = Math.max(0, Math.min(1, (front - strand.start) / (strand.end - strand.start)));
        if (!f) continue;
        const x = (1 - f) ** 2 * strand.from.x + 2 * (1 - f) * f * strand.bend.x + f * f * strand.to.x;
        const y = (1 - f) ** 2 * strand.from.y + 2 * (1 - f) * f * strand.bend.y + f * f * strand.to.y;
        const fresh = Math.exp(-Math.abs(front - strand.end) / 95);
        ctx!.beginPath(); ctx!.moveTo(strand.from.x, strand.from.y);
        ctx!.quadraticCurveTo(strand.from.x + (strand.bend.x - strand.from.x) * f, strand.from.y + (strand.bend.y - strand.from.y) * f, x, y);
        ctx!.strokeStyle = `rgba(225,162,39,${fade * (0.1 + fresh * 0.13)})`; ctx!.lineWidth = strand.width * 6; ctx!.stroke();
        ctx!.strokeStyle = `rgba(${dark ? "255,207,104" : "169,111,20"},${fade * (0.34 + fresh * 0.6)})`; ctx!.lineWidth = strand.width; ctx!.stroke();
        if (fresh > 0.4) {
          ctx!.beginPath(); ctx!.arc(x, y, 1.1 + fresh, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(255,224,144,${fade * fresh})`; ctx!.fill();
          ctx!.beginPath(); ctx!.arc(x, y, 0.65, 0, Math.PI * 2); ctx!.fillStyle = `rgba(255,250,225,${fade * fresh})`; ctx!.fill();
        }
      }
      frame = requestAnimationFrame(draw);
      } catch { finish(); }
    }
    frame = requestAnimationFrame(draw);
  });
}
