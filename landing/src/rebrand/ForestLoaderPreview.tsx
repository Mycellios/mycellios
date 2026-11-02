import { memo, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button, IconButton, Input, Select, Text } from "../ui/primitives";
import { ReferenceLanding } from "./ReferenceLanding";
import { createForestRenderer, type ForestPictures } from "./forest-renderer";
import "./forest-loader-preview.css";

gsap.registerPlugin(useGSAP);
const StaticLanding = memo(ReferenceLanding);
const sources = {
  landscape: ["/assets/loading/forest-clean.webp", "/assets/loading/forest-grown.webp", "/assets/landing/network-fruiting.webp"],
  portrait: ["/assets/loading/forest-portrait-clean.webp", "/assets/loading/forest-portrait-grown.webp", "/assets/landing/network-fruiting.webp"],
} as const;

export function ForestLoaderPreview() {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), landing = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const [pictures, setPictures] = useState<ForestPictures | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(false);
  const [portrait, setPortrait] = useState(() => typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches);

  useEffect(() => {
    document.title = "Mycellios · Previsualización del bosque";
    document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, nofollow");
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches); update();
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let active = true; setFailed(false);
    void Promise.all(sources[portrait ? "portrait" : "landscape"].map(async source => { const image = new Image(); image.src = source; await image.decode(); return image; }))
      .then(images => { if (active) setPictures(images as unknown as ForestPictures); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt, portrait]);

  useGSAP(() => {
    if (!pictures || !canvas.current || !landing.current) return;
    const renderer = createForestRenderer(canvas.current, pictures, () => {
      const bounds = landing.current?.querySelector(".reference-network-print")?.getBoundingClientRect();
      return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
    });
    const state = { growth: 0, leaving: 0 };
    let lastUpdate = -1;
    const tl = gsap.timeline({ paused: true, onUpdate: () => {
      if (state.leaving === 0) renderer.reset();
      renderer.render(state);
      const p = tl.progress();
      if (Math.abs(p - lastUpdate) > .008 || p === 0 || p === 1) { setProgress(p); lastUpdate = p; }
    }, onComplete: () => { setPlaying(false); setProgress(1); } });
    gsap.set(landing.current, { autoAlpha: 0 });
    if (reduced) {
      tl.set(state, { growth: 1 }, 0).to(state, { leaving: 1, duration: .3 }, 0)
        .to(landing.current, { autoAlpha: 1, duration: .3 }, 0);
    } else {
      tl.addLabel("forest", 0).to(state, { growth: 1, duration: 4.9, ease: "none" }, .6)
        .addLabel("landing", 5.85).to(state, { leaving: 1, duration: 1.25, ease: "power2.inOut" }, "landing")
        .to(landing.current, { autoAlpha: 1, duration: .95, ease: "power1.inOut" }, "landing+=.25");
    }
    timeline.current = tl; setProgress(0); setPlaying(false);
    return () => { timeline.current = null; renderer.destroy(); };
  }, { scope: root, dependencies: [pictures, reduced], revertOnUpdate: true });

  useEffect(() => { timeline.current?.timeScale(speed); }, [speed, pictures, reduced]);
  const complete = progress >= .999;
  useEffect(() => {
    if (complete) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previous; };
  }, [complete]);

  function seek(value: number) {
    window.scrollTo({ top: 0, behavior: "instant" });
    timeline.current?.pause().progress(value); setProgress(value); setPlaying(false);
  }
  function toggle() {
    const tl = timeline.current; if (!tl) return;
    if (playing) { tl.pause(); setPlaying(false); }
    else { if (tl.progress() >= .999) { window.scrollTo({ top: 0, behavior: "instant" }); tl.restart(); } else tl.play(); setPlaying(true); }
  }
  const stage = complete ? "Landing" : reduced ? "Vista estática del bosque" : progress < .08 ? "Bosque limpio" : progress < .82 ? "El micelio se extiende" : "Transición a la landing";
  return <div className="forest-preview" ref={root}>
    <div className="forest-preview-landing" ref={landing} inert={!complete} aria-hidden={!complete}><StaticLanding networkOpening /></div>
    <div className="forest-preview-scene" data-complete={complete} role="img" aria-label="Equipos en un bosque que se coloniza progresivamente con micelio y hongos">
      <canvas ref={canvas} aria-hidden="true" />
      {!pictures && !failed ? <Text className="forest-preview-waiting">Preparando el bosque…</Text> : null}
    </div>
    <section className="forest-preview-controls" aria-label="Controles de la previsualización">
      <div className="forest-preview-status"><span>Previsualización</span><strong aria-live="polite">{failed ? "No se pudieron cargar las imágenes" : stage}</strong></div>
      {failed ? <Button onClick={() => setAttempt(n => n + 1)}>Reintentar</Button> : <>
        <Button variant="primary" onClick={toggle} disabled={!pictures} aria-label={playing ? "Pausar animación" : "Reproducir animación"}>{playing ? <Pause size={16} /> : <Play size={16} />}<span className="forest-preview-play-label">{playing ? "Pausar" : complete ? "Repetir" : "Reproducir"}</span></Button>
        <IconButton variant="ghost" onClick={() => seek(0)} disabled={!pictures} aria-label="Volver al inicio"><RotateCcw size={17} /></IconButton>
        <Input type="range" min="0" max="1000" step="1" value={Math.round(progress * 1000)} onChange={event => seek(Number(event.target.value) / 1000)} aria-label="Posición de la animación" disabled={!pictures} />
        <Select aria-label="Velocidad de la animación" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value=".65">Lenta</option><option value="1">Normal</option><option value="2">Rápida</option></Select>
        <IconButton variant="ghost" onClick={() => seek(1)} disabled={!pictures} aria-label="Ver landing"><SkipForward size={17} /></IconButton>
      </>}
      {reduced ? <small>Movimiento reducido</small> : null}
    </section>
  </div>;
}
