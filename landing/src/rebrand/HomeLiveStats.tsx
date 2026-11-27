import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link, Text } from "../ui/primitives";

interface LiveFigures { online: number; registered: number; models: number; gpuGb: number; completed: number }

/** Public snapshot only; the strip stays hidden when the coordinator does not answer. */
async function loadFigures(signal: AbortSignal): Promise<LiveFigures> {
  const [{ parseStatsSnapshot }, { modelRows, onlineGpuCapacity }] = await Promise.all([import("../stats-model"), import("../overview-stats")]);
  const response = await fetch("/public/v1/snapshot", { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const snapshot = parseStatsSnapshot(await response.json());
  const stats = snapshot as unknown as Parameters<typeof modelRows>[0];
  return {
    online: snapshot.summary.online,
    registered: snapshot.summary.registered,
    models: modelRows(stats).filter(row => row.state === "serving").length,
    gpuGb: Math.round(onlineGpuCapacity(stats.workers).sharedMb / 1024),
    completed: snapshot.summary.completedJobs,
  };
}

function CountUp({ value, active }: { value: number; active: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0;
    const start = performance.now(), from = 0, duration = 1600;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 4);
      setShown(Math.round(from + (value - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, active]);
  return <>{new Intl.NumberFormat("en").format(shown)}</>;
}

export function HomeLiveStats() {
  const root = useRef<HTMLElement>(null);
  const [figures, setFigures] = useState<LiveFigures | null>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadFigures(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])).then(setFigures).catch(() => setFigures(null));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!figures || !root.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { threshold: .4 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [figures]);
  if (!figures) return null;
  const items = [
    [figures.online, `nodes online of ${new Intl.NumberFormat("en").format(figures.registered)}`],
    [figures.models, "models in service"],
    [figures.gpuGb, "GB of shared GPU memory"],
    [figures.completed, "completed tasks"],
  ] as const;
  return <section ref={root} className="home-shell home-live" aria-label="Live network statistics">
    <div className="home-live-head"><span className="home-live-dot" aria-hidden="true" /><Text as="span">Live from the Mycellios network</Text><Link href="/stats">Open Stats<ArrowUpRight size={13} aria-hidden="true" /></Link></div>
    <div className="home-live-grid">{items.map(([value, label]) => <div key={label}><strong><CountUp value={value} active={visible} /></strong><Text as="span">{label}</Text></div>)}</div>
  </section>;
}
