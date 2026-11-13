import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { Laptop, Pause, Play, Smartphone, Tablet } from "lucide-react";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { MICO_PRIMARY_AVATAR } from "@rakazo/contracts";
import type { EventDemoNetwork } from "../../lib/event-demo";
import { myceliumLayout, myceliumSeed } from "./mycelium-layout";

const seed = myceliumSeed();
export function MyceliumNetwork({ devices, unavailable = false }: { devices: EventDemoNetwork["devices"]; unavailable?: boolean }) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const syncVisibility = useRef(() => {});
  const [paused, setPaused] = useState(false), [visible, setVisible] = useState(true);
  useEffect(() => {
    // Recheck current geometry, rather than retaining an obsolete observer entry
    // after viewport changes (including full-page capture and returning to a tab).
    const update = () => {
      const r = host.current?.getBoundingClientRect();
      setVisible(document.visibilityState !== "hidden" && Boolean(r && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth));
    };
    syncVisibility.current = update;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(update);
    if (host.current) observer?.observe(host.current);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("resize", update); window.addEventListener("focus", update); update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update);
      window.removeEventListener("resize", update); window.removeEventListener("focus", update); syncVisibility.current = () => {}; };
  }, []);
  const geometry = useMemo(() => myceliumLayout(devices.map(d => d.number)), [devices]);
  const byNumber = new Map(devices.map(device => [device.number, device]));
  return <div ref={host} className="mycelium-scene" data-motion={paused || !visible ? "paused" : "running"} data-dense={devices.length > 20}>
    <div className="mycelium-scene-caption"><span>{t`Every connection makes us grow.`}</span>
      <Button variant="ghost" size="icon" aria-label={paused ? t`Resume animation` : t`Pause animation`} aria-pressed={paused}
        onClick={() => { syncVisibility.current(); setPaused(value => !value); }}>{paused ? <Play size={14} /> : <Pause size={14} />}</Button></div>
    <div className="mycelium-pan"><div className="mycelium-field">
      <svg className="mycelium-branches" viewBox="0 0 1000 640" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <g className="mycelium-seed">{seed.map((path, index) => <path d={path} key={index} />)}</g>
        {geometry.points.length > 0 && <path className="mycelium-root-link" pathLength={1}
          d={`M 500 320 Q 540 250 ${geometry.points[0]!.x} ${geometry.points[0]!.y}`} />}
        {geometry.branches.map(branch => {
          const a = byNumber.get(branch.a), b = byNumber.get(branch.b);
          return <g key={branch.key} className="mycelium-branch" data-powered={Boolean(a?.connected || b?.connected)} data-working={Boolean(a?.working || b?.working)}>
            {branch.filaments.map((path, index) => <path className="mycelium-filament" d={path} pathLength={1} key={index} />)}
            <path className="mycelium-hypha" d={branch.path} pathLength={1} />
            {(a?.working || b?.working) && <path className="mycelium-work" d={branch.path} pathLength={1} />}
          </g>;
        })}
      </svg>
      <div className="mycelium-origin" aria-hidden="true"><BotAvatar color={MICO_PRIMARY_AVATAR} size={42} /></div>
      <div className="event-demo-devices mycelium-peers" role="list" aria-label={t`Event devices`} aria-live="polite" aria-relevant="additions removals">
        {geometry.points.map(point => {
          const device = byNumber.get(point.number)!;
          const Icon = device.kind === "mobile" ? Smartphone : device.kind === "tablet" ? Tablet : Laptop;
          const state = device.working ? t`Running inference` : device.connected ? t`Available for inference` : t`In the app`;
          const name = `${t`Guest`} ${String(device.number).padStart(2, "0")}`;
          return <div className="event-demo-device mycelium-peer" role="listitem" data-present="true" data-connected={device.connected} data-working={device.working}
            style={{ left: `${point.x / 10}%`, top: `${point.y / 6.4}%`, "--peer-delay": `${(device.number % 5) * 70}ms` } as CSSProperties}
            key={device.number} title={`${name} · ${state}`}>
            <span className="mycelium-peer-bloom" aria-hidden="true" /><span className="event-demo-device-glyph"><Icon size={21} strokeWidth={1.6} /><i /></span>
            <span>{name}</span><small>{state}</small>
          </div>;
        })}
      </div>
      {!devices.length && !unavailable && <div className="mycelium-empty"><p>{t`The next connection starts here.`}</p><span>{t`No one is connected right now.`}</span></div>}
    </div></div>
    <div className="mycelium-legend"><span><i />{t`In the app`}</span><span><i data-powered="true" />{t`Available for inference`}</span>
      <span className="mycelium-map-note">{t`Illustrative connections · real devices`}</span></div>
  </div>;
}
