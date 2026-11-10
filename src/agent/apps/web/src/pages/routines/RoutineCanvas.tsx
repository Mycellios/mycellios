import { useLingui } from "@lingui/react/macro";
import type { Bot, Routine } from "@rakazo/contracts";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Clock3, Maximize, Minus, Plus } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { routineDiagramSummary } from "./routine-summary";
import { fitDiagram, nodeKey, nodePoint, NODE_HEIGHT, NODE_WIDTH, readPositions, zoomDiagram } from "./routine-diagram";
import type { DiagramView, NodePositions, Point } from "./routine-diagram";

type Props = {
  bot: Bot;
  routines: Routine[];
  selectedId?: string;
  scope: string;
  onSelect: (routineId: string) => void;
  onEdit: (routine: Routine) => void;
  onRun: (routine: Routine) => void;
  canRun: (routineId: string) => boolean;
  status: (routineId: string) => ReactNode;
  output: (routineId: string) => string;
  onAsk: (routine: Routine) => void;
};

export function RoutineCanvas(props: Props) {
  const { t, i18n } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const storageKey = `mycellios:routine-diagram:${props.scope}:${props.bot.id}`;
  const [positions, setPositions] = useState<NodePositions>(() => readPositions(storageKey));
  const [view, setView] = useState<DiagramView>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ id: number; start: Point; original: Point; key?: string } | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const positionsRef = useRef(positions); positionsRef.current = positions;
  const routinesRef = useRef(props.routines); routinesRef.current = props.routines;
  const marker = useId().replaceAll(":", "");
  const selected = props.routines.find(routine => routine.id === props.selectedId) ?? props.routines[0];
  const fit = (all = false) => {
    const points = routinesRef.current.flatMap((routine, index) => !all && routine.id !== selected?.id ? [] : [nodePoint(positionsRef.current, routine.id, "trigger", index), nodePoint(positionsRef.current, routine.id, "agent", index)]);
    setView(fitDiagram(points, root.current?.clientWidth ?? 0, root.current?.clientHeight ?? 0));
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observe = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(observe); observer.observe(element); observe();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { fit(); }, [size.width, size.height, selected?.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch { /* Layout still works without storage. */ } }, 300);
    return () => window.clearTimeout(timer);
  }, [positions, storageKey]);
  useEffect(() => () => { try { localStorage.setItem(storageKey, JSON.stringify(positionsRef.current)); } catch { /* Layout is optional. */ } }, [storageKey]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("button,select,input")) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      setView(current => event.ctrlKey || event.metaKey
        ? zoomDiagram(current, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, Math.exp(-event.deltaY * 0.002))
        : { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function start(event: PointerEvent<HTMLElement>, key?: string, point?: Point) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button,select,input,a"))) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, original: point ?? viewRef.current, key };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const scale = current.key ? viewRef.current.scale : 1;
    const point = { x: current.original.x + (event.clientX - current.start.x) / scale, y: current.original.y + (event.clientY - current.start.y) / scale };
    if (current.key) setPositions(previous => ({ ...previous, [current.key!]: point }));
    else setView(previous => ({ ...previous, ...point }));
  }
  function end(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (current.key) {
      const next = { ...positionsRef.current, [current.key]: event.type === "pointercancel" ? current.original : { x: current.original.x + (event.clientX - current.start.x) / viewRef.current.scale, y: current.original.y + (event.clientY - current.start.y) / viewRef.current.scale } };
      positionsRef.current = next; setPositions(next);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Layout is optional. */ }
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyMove(event: KeyboardEvent<HTMLElement>, key: string, point: Point, routineId: string) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") { event.preventDefault(); props.onSelect(routineId); return; }
    const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
    if (!delta) return;
    event.preventDefault(); setPositions(previous => ({ ...previous, [key]: { x: point.x + delta[0]!, y: point.y + delta[1]! } }));
  }
  const zoom = (factor: number) => setView(current => zoomDiagram(current, { x: size.width / 2, y: size.height / 2 }, factor));
  return <div ref={root} data-testid="routine-canvas" role="region" aria-label={t`Routine diagram`} className="rk-routine-canvas" onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs><pattern id={`${marker}-grid`} width={24 * view.scale} height={24 * view.scale} patternUnits="userSpaceOnUse" x={view.x % (24 * view.scale)} y={view.y % (24 * view.scale)}><circle cx={1} cy={1} r={0.75} fill="var(--border)" /></pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${marker}-grid)`} />
    </svg>
    <div className="absolute left-0 top-0 h-0 w-0 origin-top-left" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
      <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
        <defs><marker id={`${marker}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="var(--primary)" /></marker></defs>
        {props.routines.map((routine, index) => {
          const a = nodePoint(positions, routine.id, "trigger", index), b = nodePoint(positions, routine.id, "agent", index);
          const sx = a.x + NODE_WIDTH, sy = a.y + 48, ex = b.x, ey = b.y + 48;
          return <path key={routine.id} d={`M${sx} ${sy} C${sx + 60} ${sy},${ex - 60} ${ey},${ex} ${ey}`} fill="none" stroke="var(--primary)" strokeWidth={1.25} markerEnd={`url(#${marker}-arrow)`} opacity={routine.id === selected?.id ? 0.8 : 0.35} />;
        })}
      </svg>
      {props.routines.flatMap((routine, index) => (["trigger", "agent"] as const).map(kind => {
        const point = nodePoint(positions, routine.id, kind, index), key = nodeKey(routine.id, kind);
        return <section key={key} data-testid={`routine-node-${kind}`} data-routine-id={routine.id} data-selected={routine.id === selected?.id || undefined} role="group" tabIndex={0} aria-label={kind === "trigger" ? routine.name : `${props.bot.name}: ${routine.name}`} className="rk-routine-node" style={{ left: point.x, top: point.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }} onFocus={() => props.onSelect(routine.id)} onClick={() => props.onSelect(routine.id)} onPointerDown={event => start(event, key, point)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={event => keyMove(event, key, point, routine.id)}>
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            {kind === "trigger" ? <Clock3 size={20} className="shrink-0 text-muted-foreground" /> : <BotAvatar identity={props.bot.id} color={props.bot.color} size={26} status={props.bot.status} />}
            <div className="min-w-0 flex-1"><span className="block truncate text-[10px] text-muted-foreground">{kind === "trigger" ? routine.active ? t`Active` : t`Paused` : routine.modelId ?? props.bot.modelId ?? t`General model`}</span><strong className="block truncate text-xs font-medium">{kind === "trigger" ? routine.name : props.bot.name}</strong></div>
          </header>
          <div className="flex min-h-32 flex-col gap-2 p-3 text-xs">
            <p className="line-clamp-2 text-muted-foreground">{kind === "trigger" ? `${routineDiagramSummary(routine, i18n.locale)} · ${routine.timezone}` : routine.prompt}</p>
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{kind === "trigger" ? routine.prompt : props.output(routine.id) || t`Results will appear here after the first run.`}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              {kind === "trigger" ? <><Button variant="ghost" size="xs" onClick={() => props.onEdit(routine)}>{t`Edit`}</Button><Button variant="secondary" size="xs" disabled={!props.canRun(routine.id)} onClick={() => props.onRun(routine)}>{t`Run`}</Button></> : props.status(routine.id)}
            </div>
          </div>
          <span aria-hidden="true" className={`rk-routine-port ${kind === "trigger" ? "-right-1" : "-left-1"}`} />
        </section>;
      }))}
    </div>
    <div className="absolute bottom-4 end-4 flex flex-col gap-1">
      <IconTooltip label={t`Zoom in`}><Button variant="outline" size="icon-sm" aria-label={t`Zoom in`} onClick={() => zoom(1.2)}><Plus size={16} /></Button></IconTooltip>
      <IconTooltip label={t`Zoom out`}><Button variant="outline" size="icon-sm" aria-label={t`Zoom out`} onClick={() => zoom(1 / 1.2)}><Minus size={16} /></Button></IconTooltip>
      <IconTooltip label={t`Fit diagram`}><Button variant="outline" size="icon-sm" aria-label={t`Fit diagram`} onClick={() => fit(true)}><Maximize size={15} /></Button></IconTooltip>
      <span className="text-center text-[10px] text-muted-foreground">{Math.round(view.scale * 100)}%</span>
    </div>
    {selected ? <Button variant="outline" size="sm" className="absolute bottom-4 start-4 max-w-[calc(100%-80px)] rounded-full bg-background text-xs font-normal" onClick={() => props.onAsk(selected)}>{t`Ask the agent to edit this routine`}</Button> : null}
  </div>;
}
