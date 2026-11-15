import { useEffect, useRef, useState } from "react";
import { createMyceliumGeometry, strandPath, type MyceliumGeometry, type MyceliumLayout, type MyceliumRect } from "./golden-mycelium-model";
import type { createGoldenRenderer } from "./golden-mycelium-renderer";
import "./golden-mycelium.css";

type Renderer = NonNullable<ReturnType<typeof createGoldenRenderer>>;

/** The download grows into the workspace. Pure brand artwork, never network telemetry. */
export function GoldenMycelium({ running }: { running: boolean }) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null), active = useRef(running), synchronize = useRef<() => void>(() => {});
  const [drawing, setDrawing] = useState<{ layout: MyceliumLayout; geometry: MyceliumGeometry } | null>(null);
  const [status, setStatus] = useState("pending");
  useEffect(() => { active.current = running; synchronize.current(); }, [running]);
  useEffect(() => {
    const host = root.current?.closest<HTMLElement>(".agent-product-opening"), target = canvas.current;
    const stage = host?.querySelector<HTMLElement>(".agent-product-stage");
    const source = host?.querySelector<HTMLElement>(".agent-download-split");
    if (!host || !stage || !source || !target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false, inView = false, importing = false, failed = false;
    let current: { layout: MyceliumLayout; geometry: MyceliumGeometry; excluded: MyceliumRect[] } | null = null;
    const mayPlay = () => active.current && inView && !document.hidden && !reduced.matches;
    const update = () => {
      if (disposed) return;
      if (reduced.matches) {
        renderer.current?.destroy(); renderer.current = null; setStatus("static");
        target.dataset.myceliumMotion = "reduced"; return;
      }
      if (renderer.current) { renderer.current.setActive(mayPlay()); return; }
      if (!mayPlay() || importing || failed || !current) return;
      importing = true;
      void import("./golden-mycelium-renderer").then(({ createGoldenRenderer }) => {
        if (disposed || reduced.matches) return;
        try { renderer.current = createGoldenRenderer(target); } catch { renderer.current = null; }
        if (!renderer.current) { failed = true; setStatus("static"); return; }
        if (current) renderer.current.resize(current.layout, current.geometry, current.excluded);
        setStatus("webgl2"); renderer.current.setActive(mayPlay());
      }).catch(() => { failed = true; if (!disposed) setStatus("static"); }).finally(() => { importing = false; });
    };
    const measure = () => {
      if (disposed) return;
      const h = host.getBoundingClientRect(), s = stage.getBoundingClientRect(), origin = source.getBoundingClientRect();
      if (h.width < 1 || h.height < 1 || s.width < 1) return;
      const rect = (r: DOMRect, inset = 0): MyceliumRect => ({ x: r.left-h.left+inset, y:r.top-h.top+inset, width:Math.max(0,r.width-inset*2), height:Math.max(0,r.height-inset*2) });
      const layout: MyceliumLayout = { width:h.width, height:h.height, compact:h.width<700, source:{x:origin.left-h.left+16,y:origin.bottom-h.top+5}, stage:rect(s) };
      const geometry = createMyceliumGeometry(layout);
      const excluded = ["h1", ".agent-product-hero > p", ".agent-product-actions", ".agent-product-earn"].map(selector => host.querySelector(selector)).filter((el): el is Element => Boolean(el)).map(el => rect(el.getBoundingClientRect()));
      excluded.push(rect(s, 5));
      current = { layout, geometry, excluded }; setDrawing({ layout, geometry });
      renderer.current?.resize(layout, geometry, excluded); update();
    };
    const lost = (event: Event) => {
      event.preventDefault(); renderer.current?.destroy(); renderer.current = null; failed = true; setStatus("static");
    };
    const restored = () => { failed = false; update(); };
    const preference = () => { failed = false; update(); };
    const observer = new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); update(); }, { threshold: .01 });
    const resize = new ResizeObserver(measure); resize.observe(host); resize.observe(stage); resize.observe(source);
    observer.observe(host); document.addEventListener("visibilitychange", update); reduced.addEventListener("change", preference);
    target.addEventListener("webglcontextlost", lost); target.addEventListener("webglcontextrestored", restored);
    synchronize.current = update; measure();
    // Re-register geometry after the existing hero entrance and font settlement.
    const settled = window.setTimeout(measure, 1400);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true; synchronize.current = () => {};
      window.clearTimeout(settled);
      observer.disconnect(); resize.disconnect(); document.removeEventListener("visibilitychange", update); reduced.removeEventListener("change", preference);
      target.removeEventListener("webglcontextlost", lost); target.removeEventListener("webglcontextrestored", restored);
      renderer.current?.destroy(); renderer.current = null;
    };
  }, []);
  return <div className="golden-mycelium" ref={root} aria-hidden="true" data-renderer={status}>
    {drawing && <svg className="golden-mycelium-fallback" viewBox={`0 0 ${drawing.layout.width} ${drawing.layout.height}`} preserveAspectRatio="none" focusable="false">
      {drawing.geometry.strands.map((strand, i) => <path key={i} d={strandPath(strand)} fill="none" strokeWidth={strand.weight * .7} vectorEffect="non-scaling-stroke" />)}
    </svg>}
    <canvas ref={canvas} className="golden-mycelium-canvas" />
  </div>;
}
