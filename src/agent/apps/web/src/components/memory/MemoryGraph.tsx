import { useLingui } from "@lingui/react/macro";
import { Button } from "@mycellios/ui-web";
import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { createGraphLayout } from "../../lib/memory-graph-layout";
import type { VaultGraphEdge, VaultGraphNode } from "../../lib/memory-vault";

type View = { scale: number; tx: number; ty: number };

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const DRAG_THRESHOLD = 4;

function radius(node: VaultGraphNode) {
  return Math.min(13, 3.5 + Math.sqrt(node.degree) * 1.7);
}

function cssColor(element: Element, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/**
 * The memory graph on a canvas: notes as dots sized by their links, links as lines. Hover
 * lights a note's neighbours, a click opens it, dragging moves a note or the view and the
 * wheel zooms. It is a picture of the person's own notes; the note tree beside it is the
 * keyboard and screen-reader route to the same notes.
 */
export function MemoryGraph({
  nodes,
  edges,
  colorFor,
  selectedId,
  highlighted,
  onOpen,
  compact = false,
  className = "",
}: {
  nodes: readonly VaultGraphNode[];
  edges: readonly VaultGraphEdge[];
  colorFor: (node: VaultGraphNode) => string;
  selectedId?: string | null;
  /** Notes matching the current search; the others are dimmed. */
  highlighted?: ReadonlySet<string> | null;
  onOpen: (id: string) => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ colorFor, selectedId, highlighted, onOpen, compact });
  props.current = { colorFor, selectedId, highlighted, onOpen, compact };
  const signature = useMemo(
    () =>
      `${nodes.map((node) => node.id).join(",")}|${edges.map((edge) => `${edge.source}>${edge.target}`).join(",")}`,
    [nodes, edges],
  );
  const graph = useMemo(() => {
    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const links = edges
      .map((edge) => ({
        source: index.get(edge.source) ?? -1,
        target: index.get(edge.target) ?? -1,
      }))
      .filter((edge) => edge.source >= 0 && edge.target >= 0);
    const adjacent = nodes.map(() => new Set<number>());
    for (const { source, target } of links) {
      adjacent[source]!.add(target);
      adjacent[target]!.add(source);
    }
    return {
      nodes: [...nodes],
      links,
      adjacent,
      index,
      layout: createGraphLayout(
        nodes.map((node) => node.id),
        links,
      ),
    };
    // The signature covers every input the layout depends on.
  }, [signature]);
  const controls = useRef<{
    zoom: (factor: number) => void;
    fit: () => void;
    draw: () => void;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { layout, links, adjacent } = graph;
    const view: View = { scale: 1, tx: 0, ty: 0 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let userMoved = false;
    let hover = -1;
    let disposed = false;
    const reduced = prefersReducedMotion();

    const toWorld = (sx: number, sy: number) => ({
      x: (sx - view.tx) / view.scale,
      y: (sy - view.ty) / view.scale,
    });

    function fitView() {
      if (!graph.nodes.length || !width || !height) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < graph.nodes.length; i += 1) {
        minX = Math.min(minX, layout.x[i]!);
        maxX = Math.max(maxX, layout.x[i]!);
        minY = Math.min(minY, layout.y[i]!);
        maxY = Math.max(maxY, layout.y[i]!);
      }
      const pad = compact ? 36 : 64;
      const scale = Math.min(
        MAX_SCALE,
        Math.max(
          MIN_SCALE,
          Math.min(
            (width - pad * 2) / Math.max(1, maxX - minX),
            (height - pad * 2) / Math.max(1, maxY - minY),
          ),
        ),
        compact ? 2 : 2.4,
      );
      view.scale = scale;
      view.tx = width / 2 - ((minX + maxX) / 2) * scale;
      view.ty = height / 2 - ((minY + maxY) / 2) * scale;
    }

    function draw() {
      if (!context || !canvas) return;
      const { colorFor: color, selectedId: selected, highlighted: matches } = props.current;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.setTransform(
        ratio * view.scale,
        0,
        0,
        ratio * view.scale,
        ratio * view.tx,
        ratio * view.ty,
      );
      const selectedIndex = selected ? (graph.index.get(selected) ?? -1) : -1;
      const focus = hover >= 0 ? hover : selectedIndex;
      const lit = focus >= 0 ? new Set([focus, ...adjacent[focus]!]) : null;
      const edgeColor = cssColor(canvas, "--border", "#d6d3cc");
      const strongEdge = cssColor(canvas, "--muted-foreground", "#6b6862");
      const text = cssColor(canvas, "--foreground", "#1f1e1c");
      const background = cssColor(canvas, "--background", "#ffffff");
      const accent = cssColor(canvas, "--primary", "#2f4a3a");

      context.lineWidth = 1 / view.scale;
      for (const { source, target } of links) {
        const active = lit
          ? lit.has(source) && lit.has(target) && (source === focus || target === focus)
          : false;
        context.globalAlpha =
          lit && !active
            ? 0.25
            : matches &&
                !(matches.has(graph.nodes[source]!.id) || matches.has(graph.nodes[target]!.id))
              ? 0.25
              : 1;
        context.strokeStyle = active ? strongEdge : edgeColor;
        context.lineWidth = (active ? 1.6 : 1) / view.scale;
        context.beginPath();
        context.moveTo(layout.x[source]!, layout.y[source]!);
        context.lineTo(layout.x[target]!, layout.y[target]!);
        context.stroke();
      }
      const labelFont = `${12 / view.scale}px ${getComputedStyle(canvas).fontFamily || "sans-serif"}`;
      context.font = labelFont;
      context.textAlign = "center";
      context.textBaseline = "top";
      const showAllLabels =
        view.scale >= 1.15 || (props.current.compact && graph.nodes.length <= 30);
      for (let i = 0; i < graph.nodes.length; i += 1) {
        const node = graph.nodes[i]!;
        const r = radius(node);
        const dim = (lit && !lit.has(i)) || (matches && !matches.has(node.id));
        context.globalAlpha = dim ? 0.22 : 1;
        context.beginPath();
        context.arc(layout.x[i]!, layout.y[i]!, r, 0, Math.PI * 2);
        if (node.ghost) {
          context.fillStyle = background;
          context.fill();
          context.strokeStyle = strongEdge;
          context.lineWidth = 1.2 / view.scale;
          context.stroke();
        } else {
          context.fillStyle = color(node);
          context.fill();
        }
        if (i === selectedIndex || node.essential) {
          context.beginPath();
          context.arc(
            layout.x[i]!,
            layout.y[i]!,
            r + 3 / view.scale + (i === selectedIndex ? 1.5 / view.scale : 0),
            0,
            Math.PI * 2,
          );
          context.strokeStyle = i === selectedIndex ? accent : strongEdge;
          context.lineWidth = (i === selectedIndex ? 2 : 1) / view.scale;
          context.stroke();
        }
        const labelled =
          showAllLabels || (lit?.has(i) ?? false) || i === selectedIndex || node.degree >= 6;
        if (labelled && !(dim && !showAllLabels)) {
          context.fillStyle = node.ghost ? strongEdge : text;
          const label = node.label.length > 40 ? `${node.label.slice(0, 39)}…` : node.label;
          const labelY = layout.y[i]! + r + 3 / view.scale;
          // A halo in the page colour keeps labels readable over the edges.
          context.strokeStyle = background;
          context.lineWidth = 3 / view.scale;
          context.lineJoin = "round";
          context.strokeText(label, layout.x[i]!, labelY);
          context.fillText(label, layout.x[i]!, labelY);
        }
      }
      context.globalAlpha = 1;
    }

    function loop() {
      frame = 0;
      if (disposed) return;
      const running = layout.step();
      if (!userMoved) fitView();
      draw();
      if (running) frame = requestAnimationFrame(loop);
    }
    function schedule() {
      if (!frame && !disposed) frame = requestAnimationFrame(loop);
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      if (!userMoved) fitView();
      draw();
    }

    if (reduced) layout.settle(600);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    resize();
    if (!reduced) schedule();

    function nodeAt(sx: number, sy: number) {
      const point = toWorld(sx, sy);
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < graph.nodes.length; i += 1) {
        const distance = Math.hypot(layout.x[i]! - point.x, layout.y[i]! - point.y);
        const reach = radius(graph.nodes[i]!) + 5 / view.scale;
        if (distance <= reach && distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
      return best;
    }

    let drag: {
      pointer: number;
      node: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
    } | null = null;
    const local = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    };
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const { sx, sy } = local(event);
      drag = {
        pointer: event.pointerId,
        node: nodeAt(sx, sy),
        startX: sx,
        startY: sy,
        lastX: sx,
        lastY: sy,
        moved: false,
      };
      canvas!.setPointerCapture(event.pointerId);
    }
    function onPointerMove(event: PointerEvent) {
      const { sx, sy } = local(event);
      if (!drag || drag.pointer !== event.pointerId) {
        const next = nodeAt(sx, sy);
        if (next !== hover) {
          hover = next;
          canvas!.style.cursor = next >= 0 ? "pointer" : "grab";
          draw();
        }
        return;
      }
      if (!drag.moved && Math.hypot(sx - drag.startX, sy - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      userMoved = true;
      if (drag.node >= 0) {
        const point = toWorld(sx, sy);
        layout.pin(drag.node, point.x, point.y);
        if (!reduced) {
          layout.reheat(0.25);
          schedule();
        } else draw();
      } else {
        view.tx += sx - drag.lastX;
        view.ty += sy - drag.lastY;
        canvas!.style.cursor = "grabbing";
        draw();
      }
      drag.lastX = sx;
      drag.lastY = sy;
    }
    function onPointerUp(event: PointerEvent) {
      if (!drag || drag.pointer !== event.pointerId) return;
      const { node, moved } = drag;
      drag = null;
      canvas!.style.cursor = hover >= 0 ? "pointer" : "grab";
      if (node >= 0 && moved) layout.unpin(node);
      if (node >= 0 && !moved) props.current.onOpen(graph.nodes[node]!.id);
    }
    function onPointerLeave() {
      if (hover >= 0 && !drag) {
        hover = -1;
        draw();
      }
    }
    function zoomAt(factor: number, sx: number, sy: number) {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
      const point = toWorld(sx, sy);
      view.scale = scale;
      view.tx = sx - point.x * scale;
      view.ty = sy - point.y * scale;
      userMoved = true;
      draw();
    }
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const { sx, sy } = local(event);
      zoomAt(Math.exp(-event.deltaY * 0.0015), sx, sy);
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    // Appearance changes repaint with the new tokens.
    const themeObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => draw());
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", draw);
    controls.current = {
      zoom: (factor) => zoomAt(factor, width / 2, height / 2),
      fit: () => {
        userMoved = false;
        fitView();
        draw();
      },
      draw,
    };
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      themeObserver?.disconnect();
      scheme?.removeEventListener?.("change", draw);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      controls.current = null;
    };
    // compact only changes padding and labels; a new graph restarts everything.
  }, [graph]);

  // Selection, search and colours repaint without restarting the layout.
  useEffect(() => {
    controls.current?.draw();
  }, [selectedId, highlighted, colorFor]);

  return (
    <div className={`relative min-h-0 ${className}`} data-testid="memory-graph">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t`Graph of ${nodes.length} notes and ${edges.length} links`}
        className="absolute inset-0 size-full touch-none"
        style={{ cursor: "grab" }}
      />
      {!compact ? (
        <div className="absolute end-3 bottom-3 flex flex-col gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t`Zoom in`}
            onClick={() => controls.current?.zoom(1.25)}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t`Zoom out`}
            onClick={() => controls.current?.zoom(0.8)}
          >
            <Minus aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t`Fit graph`}
            onClick={() => controls.current?.fit()}
          >
            <Maximize aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
