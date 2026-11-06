import type { Routine, RoutineRun } from "@rakazo/contracts";

export type Point = { x: number; y: number };
export type DiagramView = Point & { scale: number };
export type NodePositions = Record<string, Point>;
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 188;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

export function nodeKey(routineId: string, kind: "trigger" | "agent") { return `${routineId}:${kind}`; }
export function nodePoint(positions: NodePositions, routineId: string, kind: "trigger" | "agent", index: number): Point {
  return positions[nodeKey(routineId, kind)] ?? { x: kind === "trigger" ? 80 : 420, y: 80 + index * 250 };
}
export function fitDiagram(points: Point[], width: number, height: number): DiagramView {
  if (!points.length || width <= 0 || height <= 0) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const right = Math.max(...points.map(p => p.x + NODE_WIDTH)), bottom = Math.max(...points.map(p => p.y + NODE_HEIGHT));
  const scale = Math.max(MIN_SCALE, Math.min(1, (width - 48) / (right - left), (height - 100) / (bottom - top)));
  return { scale, x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale };
}
export function zoomDiagram(view: DiagramView, point: Point, factor: number): DiagramView {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
  return { scale, x: point.x - (point.x - view.x) * scale / view.scale, y: point.y - (point.y - view.y) * scale / view.scale };
}
export function readPositions(storageKey: string): NodePositions {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Point] => {
      const p = entry[1];
      return typeof p === "object" && p !== null && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 100_000 && Math.abs(p.y) <= 100_000;
    }));
  } catch { return {}; }
}
export function routineCanRun(run: RoutineRun | null | undefined): boolean {
  return !run || ["completed", "failed", "cancelled"].includes(run.status);
}
/** No text is inferred from a schedule: this is the exact routine-to-owner execution link. */
export function ownedRoutines(routines: Routine[], botId: string) { return routines.filter(routine => routine.botId === botId); }
