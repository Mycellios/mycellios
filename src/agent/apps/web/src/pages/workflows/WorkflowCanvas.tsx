import { useLingui } from "@lingui/react/macro";
import {
  type Bot,
  isWorkflowStep,
  type WorkflowExecution,
  type WorkflowGraph,
  type WorkflowNode,
} from "@rakazo/contracts";
import { NativeSelectOption, NativeSelect, Textarea, Input,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  Bot as BotIcon,
  CircleCheck,
  FileText,
  Hand,
  Map as MapIcon,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Shapes,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type View = Point & { scale: number };
type Tool = "select" | "hand" | "drawing";
const W = 252,
  H = 170;
export function WorkflowCanvas({
  graph,
  onChange,
  bots,
  execution,
  locked,
}: {
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  bots: Bot[];
  execution?: WorkflowExecution;
  locked: boolean;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLElement>(null),
    current = useRef(graph);
  current.current = graph;
  const [branch, setBranch] = useState<"yes" | "no">("yes");
  const [view, setView] = useState<View>({ x: 60, y: 60, scale: 1 });
  const [tool, setTool] = useState<Tool>("select"),
    [selected, select] = useState<string | null>(null),
    [from, connectFrom] = useState<string | null>(null);
  const [search, setSearch] = useState<string | null>(null),
    [minimap, setMinimap] = useState(false),
    [error, setError] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (search !== null) searchInput.current?.focus();
  }, [search]);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const undo = useRef<WorkflowGraph[]>([]),
    redo = useRef<WorkflowGraph[]>([]),
    [, revision] = useState(0);
  const gesture = useRef<{
    mode: "pan" | "node" | "drawing";
    start: Point;
    view: View;
    graph: WorkflowGraph;
    id?: string;
  } | null>(null);
  const labels: Record<WorkflowNode["kind"], string> = {
    trigger: t`Trigger`,
    prompt: t`Instructions`,
    condition: t`Condition`,
    agent: t`Mico`,
    output: t`Result`,
    note: t`Note`,
    text: t`Text`,
    shape: t`Shape`,
    drawing: t`Drawing`,
  };
  function remember() {
    undo.current = [...undo.current.slice(-49), current.current];
    redo.current = [];
    revision((value) => value + 1);
  }
  function change(next: WorkflowGraph) {
    if (locked) return;
    remember();
    onChange(next);
  }
  function history(back: boolean) {
    if (locked) return;
    const source = back ? undo : redo,
      destination = back ? redo : undo;
    const next = source.current.at(-1);
    if (!next) return;
    source.current = source.current.slice(0, -1);
    destination.current.push(current.current);
    onChange(next);
    select(null);
    revision((value) => value + 1);
  }
  function center() {
    const rect = root.current?.getBoundingClientRect();
    return {
      x: ((rect?.width ?? 800) / 2 - view.x) / view.scale - W / 2,
      y: ((rect?.height ?? 600) / 2 - view.y) / view.scale - H / 2,
    };
  }
  function add(kind: WorkflowNode["kind"]) {
    if (graph.nodes.length >= 60) {
      setError(t`A workflow can have up to 60 items.`);
      return;
    }
    const position = center();
    while (
      graph.nodes.some(
        (item) => Math.abs(item.x - position.x) < W + 30 && Math.abs(item.y - position.y) < H + 30,
      )
    )
      position.x += W + 90;
    const node: WorkflowNode = {
      id: crypto.randomUUID(),
      kind,
      ...position,
      title: labels[kind],
      text: "",
      ...(kind === "trigger"
        ? {
            trigger: "manual",
            cron: "0 9 * * 1-5",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : {}),
      ...(kind === "condition" ? { condition: { operator: "nonempty" as const, value: "" } } : {}),
      ...(kind === "agent" && bots[0] ? { botId: bots[0].id } : {}),
    };
    change({ ...graph, nodes: [...graph.nodes, node] });
    select(node.id);
    setTool("select");
    setView({
      ...view,
      x: size.width / 2 - (node.x + W / 2) * view.scale,
      y: size.height / 2 - (node.y + H / 2) * view.scale,
    });
  }
  function update(node: WorkflowNode, patch: Partial<WorkflowNode>) {
    change({
      ...graph,
      nodes: graph.nodes.map((item) => (item.id === node.id ? { ...item, ...patch } : item)),
    });
  }
  function remove() {
    if (!selected) return;
    change({
      nodes: graph.nodes.filter((node) => node.id !== selected),
      edges: graph.edges.filter(
        (edge) => edge.id !== selected && edge.from !== selected && edge.to !== selected,
      ),
    });
    select(null);
    connectFrom(null);
  }
  function connect(to: string, sourceId = from) {
    if (!sourceId || !to || locked) return;
    const source = graph.nodes.find(node => node.id === sourceId), target = graph.nodes.find(node => node.id === to);
    if (!source || !target || !isWorkflowStep(source) || source.kind === "output" || !isWorkflowStep(target) || target.kind === "trigger" || to === sourceId) {
      setError(t`Choose an instruction, condition, Mico or result as the destination.`); return;
    }
    const visit = (id: string, seen = new Set<string>()): boolean => {
      if (id === sourceId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return graph.edges.filter(edge => edge.from === id).some(edge => visit(edge.to, seen));
    };
    if (visit(to)) { setError(t`Connections cannot form a cycle.`); return; }
    const selectedBranch = source.kind === "condition" ? branch : undefined;
    if (!graph.edges.some(edge => edge.from === sourceId && edge.to === to && edge.branch === selectedBranch))
      change({ ...graph, edges: [...graph.edges.filter(edge => !(source.kind === "condition" && edge.from === sourceId && edge.branch === selectedBranch)),
        { id: crypto.randomUUID(), from: sourceId, to, ...(selectedBranch ? { branch: selectedBranch } : {}) }] });
    connectFrom(null); setError("");
  }
  function zoom(amount: number) {
    const rect = root.current?.getBoundingClientRect();
    const x = (rect?.width ?? 800) / 2,
      y = (rect?.height ?? 600) / 2;
    setView((old) => {
      const scale = Math.max(0.25, Math.min(2, old.scale * amount));
      return {
        scale,
        x: x - ((x - old.x) * scale) / old.scale,
        y: y - ((y - old.y) * scale) / old.scale,
      };
    });
  }
  function fit() {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || !graph.nodes.length) {
      setView({ x: 60, y: 60, scale: 1 });
      return;
    }
    const minX = Math.min(...graph.nodes.map((node) => node.x)),
      minY = Math.min(...graph.nodes.map((node) => node.y)),
      width = Math.max(...graph.nodes.map((node) => node.x + W)) - minX,
      height = Math.max(...graph.nodes.map((node) => node.y + H)) - minY;
    const scale = Math.max(
      0.25,
      Math.min(1, (rect.width - 100) / width, (rect.height - 180) / height),
    );
    setView({
      scale,
      x: (rect.width - width * scale) / 2 - minX * scale,
      y: (rect.height - height * scale) / 2 - minY * scale,
    });
  }
  function point(event: PointerEvent): Point {
    const rect = root.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  }
  function down(event: PointerEvent<HTMLElement>) {
    if (
      !root.current?.contains(event.target as Node) ||
      event.button !== 0 ||
      (event.target as Element).closest("button,input,textarea,select,[data-canvas-controls]")
    )
      return;
    const target = (event.target as Element).closest<HTMLElement>("[data-workflow-node]");
    const start = { x: event.clientX, y: event.clientY };
    if (tool === "drawing" && !locked && !target) {
      if (graph.nodes.length >= 60) return;
      remember();
      const p = point(event),
        id = crypto.randomUUID();
      const node: WorkflowNode = {
        id,
        kind: "drawing",
        x: p.x,
        y: p.y,
        title: t`Drawing`,
        text: "",
        points: [{ x: 0, y: 0 }],
      };
      onChange({ ...graph, nodes: [...graph.nodes, node] });
      gesture.current = { mode: "drawing", start: p, view, graph, id };
    } else if (target && tool === "select") {
      select(target.dataset.workflowNode!);
      if (locked) return;
      remember();
      gesture.current = { mode: "node", start, view, graph, id: target.dataset.workflowNode };
    } else {
      select(null);
      gesture.current = { mode: "pan", start, view, graph };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const drag = gesture.current;
    if (!drag) return;
    if (drag.mode === "pan")
      setView({
        ...drag.view,
        x: drag.view.x + event.clientX - drag.start.x,
        y: drag.view.y + event.clientY - drag.start.y,
      });
    else if (drag.mode === "node")
      onChange({
        ...drag.graph,
        nodes: drag.graph.nodes.map((node) =>
          node.id === drag.id
            ? {
                ...node,
                x: Math.max(
                  -100000,
                  Math.min(100000, node.x + (event.clientX - drag.start.x) / view.scale),
                ),
                y: Math.max(
                  -100000,
                  Math.min(100000, node.y + (event.clientY - drag.start.y) / view.scale),
                ),
              }
            : node,
        ),
      });
    else {
      const p = point(event);
      onChange({
        ...current.current,
        nodes: current.current.nodes.map((node) =>
          node.id === drag.id
            ? {
                ...node,
                points: [
                  ...(node.points ?? []).slice(0, 999),
                  { x: p.x - drag.start.x, y: p.y - drag.start.y },
                ],
              }
            : node,
        ),
      });
    }
  }
  const node = graph.nodes.find((item) => item.id === selected);
  const miniBounds = {
    x: Math.min(0, ...graph.nodes.map((item) => item.x)) - 40,
    y: Math.min(0, ...graph.nodes.map((item) => item.y)) - 40,
    width: 1,
    height: 1,
  };
  miniBounds.width = Math.max(400, ...graph.nodes.map((item) => item.x + W)) - miniBounds.x + 40;
  miniBounds.height = Math.max(300, ...graph.nodes.map((item) => item.y + H)) - miniBounds.y + 40;
  const iconButton = (
    label: string,
    Icon: typeof Plus,
    action: () => void,
    disabled = false,
    active = false,
  ) => (
    <Button
      key={label}
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={action}
      disabled={disabled}
    >
      <Icon size={17} />
    </Button>
  );
  return (
    <div className="rk-workflow-body">
      <section
        ref={root}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Canvas keyboard navigation requires a focus stop.
        tabIndex={0}
        aria-label={t`Workflow canvas`}
        data-testid="workflow-canvas"
        className={`rk-workflow-canvas ${tool === "hand" ? "cursor-grab" : tool === "drawing" ? "cursor-crosshair" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onKeyDown={(event) => {
          if (
            !root.current?.contains(event.target as Node) ||
            (event.target as Element).closest("input,textarea,select,button")
          )
            return;
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            remove();
          }
          if (event.key === "Escape") {
            select(null);
            connectFrom(null);
            setTool("select");
          }
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            const amount = event.shiftKey ? 40 : 10;
            const dx =
                event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
              dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
            if (selected && graph.nodes.some((item) => item.id === selected) && !locked)
              change({
                ...graph,
                nodes: graph.nodes.map((item) =>
                  item.id === selected
                    ? {
                        ...item,
                        x: Math.max(-100000, Math.min(100000, item.x + dx)),
                        y: Math.max(-100000, Math.min(100000, item.y + dy)),
                      }
                    : item,
                ),
              });
            else setView((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            history(!event.shiftKey);
          }
          if (event.key === "+" || event.key === "=") zoom(1.15);
          if (event.key === "-") zoom(1 / 1.15);
        }}
      >
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <pattern
              id="workflow-dots"
              width={20 * view.scale}
              height={20 * view.scale}
              patternUnits="userSpaceOnUse"
              x={view.x}
              y={view.y}
            >
              <circle cx="1" cy="1" r=".7" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#workflow-dots)" className="text-border" />
        </svg>
        {!graph.nodes.length ? (
          <div className="rk-workflow-empty">
            <span className="rk-workflow-trigger-icon">
              <Zap size={19} />
            </span>
            <p>{t`Start with a trigger`}</p>
            <Button size="sm" disabled={locked} onClick={() => add("trigger")}>
              <Plus size={15} />
              {t`Add trigger`}
            </Button>
          </div>
        ) : null}
        <div
          className="absolute left-0 top-0 size-0 origin-top-left"
          style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
        >
          <svg
            className="absolute overflow-visible"
            width="1"
            height="1"
            aria-label={t`Connections`}
          >
            <defs>
              <marker
                id="workflow-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8" fill="var(--primary)" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const a = graph.nodes.find((item) => item.id === edge.from),
                b = graph.nodes.find((item) => item.id === edge.to);
              if (!a || !b) return null;
              const d = `M${a.x + W},${a.y + H / 2} C${a.x + W + 70},${a.y + H / 2} ${b.x - 70},${b.y + H / 2} ${b.x},${b.y + H / 2}`;
              return (
                <g key={edge.id}>
                  {edge.branch ? <text x={(a.x + W + b.x) / 2} y={(a.y + b.y + H) / 2 - 8} fill="var(--foreground)" fontSize="12" pointerEvents="none">{edge.branch === "yes" ? t`Yes` : t`No`}</text> : null}
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={selected === edge.id ? 3 : 1.5}
                    markerEnd="url(#workflow-arrow)"
                  />
                  {/* biome-ignore lint/a11y/useSemanticElements: An SVG path preserves the curved connection hit area, with Enter and Space keyboard activation. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18}
                    tabIndex={0}
                    role="button"
                    aria-label={`${t`Select connection`}: ${a.title} → ${b.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => select(edge.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(edge.id);
                      }
                      if (event.key === "Delete" && !locked)
                        change({
                          ...graph,
                          edges: graph.edges.filter((item) => item.id !== edge.id),
                        });
                    }}
                  />
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((item) => {
            if (item.kind === "drawing")
              return (
                <svg
                  key={item.id}
                  data-workflow-node={item.id}
                  className="absolute overflow-visible"
                  style={{ left: item.x, top: item.y }}
                  width="1"
                  height="1"
                >
                  <polyline
                    points={(item.points ?? []).map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={selected === item.id ? "var(--primary)" : "var(--foreground)"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              );
            const step = execution?.steps[item.id],
              Icon =
                item.kind === "trigger"
                  ? Zap
                  : item.kind === "agent"
                    ? BotIcon
                    : item.kind === "output"
                      ? CircleCheck
                      : FileText;
            return (
              <article
                key={item.id}
                data-workflow-node={item.id}
                data-testid={`workflow-node-${item.kind}`}
                className={`rk-workflow-node rk-workflow-node-${item.kind} ${selected === item.id ? "rk-workflow-node-selected" : ""}`}
                style={{ left: item.x, top: item.y, width: W, height: H }}
                onDoubleClick={() => select(item.id)}
              >
                {isWorkflowStep(item) && item.kind !== "trigger" ? (
                  <button
                    type="button"
                    disabled={locked}
                    className={`rk-workflow-port rk-workflow-port-in ${from ? "rk-workflow-port-ready" : ""}`}
                    aria-label={`${t`Connect input`}: ${item.title}`}
                    title={t`Choose an output first, then this input`}
                    onClick={() => connect(item.id)}
                  />
                ) : null}
                <button
                  type="button"
                  className="rk-workflow-node-heading"
                  onClick={() => select(item.id)}
                  aria-label={`${t`Edit`}: ${item.title}`}
                >
                  <Icon size={16} />
                  <span className="truncate">{item.title || labels[item.kind]}</span>
                </button>
                <p className="line-clamp-3 whitespace-pre-wrap break-words px-3 text-xs text-muted-foreground">
                  {item.kind === "agent"
                    ? (bots.find((bot) => bot.id === item.botId)?.name ?? t`Choose a Mico`)
                    : item.kind === "trigger"
                      ? item.trigger === "schedule"
                        ? `${item.cron} · ${item.timezone}`
                        : t`Manual trigger`
                      : ""}
                  {item.text ? `\n${item.text}` : ""}
                </p>
                {step ? (
                  <div
                    className="absolute bottom-3 left-3 right-3 truncate text-xs"
                    title={step.output || step.error}
                  >
                    {step.status === "completed"
                      ? t`Completed`
                      : step.status === "running"
                        ? t`Running`
                        : t`Stopped`}
                    {step.output ? ` · ${step.output}` : ""}
                  </div>
                ) : null}
                {isWorkflowStep(item) && item.kind !== "output" ? (
                  <button
                    type="button"
                    disabled={locked}
                    className={`rk-workflow-port rk-workflow-port-out ${from === item.id ? "rk-workflow-port-ready" : ""}`}
                    aria-label={`${t`Connect output`}: ${item.title}`}
                    title={t`Connect to another step`}
                    onClick={() => {
                      connectFrom(from === item.id ? null : item.id);
                      setError("");
                    }}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
        {from ? (
          <div role="status" className="rk-workflow-hint">
            {t`Select the input of the next step`}
            {graph.nodes.find(node => node.id === from)?.kind === "condition" ? <NativeSelect aria-label={t`Branch`} value={branch} onChange={event => setBranch(event.target.value as "yes" | "no")}><NativeSelectOption value="yes">{t`Yes`}</NativeSelectOption><NativeSelectOption value="no">{t`No`}</NativeSelectOption></NativeSelect> : null}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t`Cancel connection`}
              onClick={() => connectFrom(null)}
            >
              <X size={13} />
            </Button>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="rk-workflow-hint text-destructive">
            {error}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t`Dismiss`}
              onClick={() => setError("")}
            >
              <X size={13} />
            </Button>
          </div>
        ) : null}
        {search !== null ? (
          <div data-canvas-controls className="rk-workflow-search">
            <Input
              ref={searchInput}
              aria-label={t`Find a node`}
              placeholder={t`Find a node…`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t`Close search`}
              onClick={() => setSearch(null)}
            >
              <X size={15} />
            </Button>
            {graph.nodes
              .filter((item) =>
                `${item.title} ${item.text}`.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(0, 8)
              .map((item) => (
                <button
                  type="button"
                  className="w-full truncate rounded px-2 py-2 text-start text-sm hover:bg-accent"
                  key={item.id}
                  onClick={() => {
                    const rect = root.current!.getBoundingClientRect();
                    setView({
                      ...view,
                      x: rect.width / 2 - (item.x + W / 2) * view.scale,
                      y: rect.height / 2 - (item.y + H / 2) * view.scale,
                    });
                    select(item.id);
                    setSearch(null);
                  }}
                >
                  {item.title || labels[item.kind]}
                </button>
              ))}
          </div>
        ) : null}
        <div data-canvas-controls className="rk-workflow-zoom">
          {iconButton(t`Zoom out`, Minus, () => zoom(1 / 1.15))}
          <span className="min-w-10 text-center text-xs tabular-nums">
            {Math.round(view.scale * 100)} %
          </span>
          {iconButton(t`Zoom in`, Plus, () => zoom(1.15))}
          {iconButton(t`Fit diagram`, Maximize, fit)}
          {iconButton(
            t`Toggle minimap`,
            MapIcon,
            () => setMinimap((value) => !value),
            false,
            minimap,
          )}
        </div>
        {minimap ? (
          <button
            type="button"
            data-canvas-controls
            className="rk-workflow-minimap"
            aria-label={t`Navigate using minimap`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x =
                  miniBounds.x + ((event.clientX - rect.left) / rect.width) * miniBounds.width,
                y = miniBounds.y + ((event.clientY - rect.top) / rect.height) * miniBounds.height;
              setView({
                ...view,
                x: size.width / 2 - x * view.scale,
                y: size.height / 2 - y * view.scale,
              });
            }}
          >
            <svg
              viewBox={`${miniBounds.x} ${miniBounds.y} ${miniBounds.width} ${miniBounds.height}`}
              preserveAspectRatio="none"
              width="140"
              height="90"
              aria-hidden="true"
            >
              {graph.nodes.map((item) => (
                <rect
                  key={item.id}
                  x={item.x}
                  y={item.y}
                  width={W}
                  height={H}
                  rx="8"
                  fill="var(--muted-foreground)"
                  opacity=".6"
                />
              ))}
              <rect
                x={-view.x / view.scale}
                y={-view.y / view.scale}
                width={size.width / view.scale}
                height={size.height / view.scale}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="5"
              />
            </svg>
          </button>
        ) : null}
        <div
          data-canvas-controls
          role="toolbar"
          aria-label={t`Canvas tools`}
          className="rk-workflow-toolbar"
        >
          {iconButton(t`Select`, MousePointer2, () => setTool("select"), false, tool === "select")}
          {iconButton(t`Pan canvas`, Hand, () => setTool("hand"), false, tool === "hand")}
          {iconButton(t`Draw`, Pencil, () => setTool("drawing"), locked, tool === "drawing")}
          {iconButton(t`Add note`, StickyNote, () => add("note"), locked)}
          {iconButton(t`Add shape`, Shapes, () => add("shape"), locked)}
          {iconButton(t`Add text`, Type, () => add("text"), locked)}
          {iconButton(t`Find node`, Search, () => setSearch(""))}
          <DropdownMenu>
            <DropdownMenuTrigger disabled={locked} className="rk-workflow-add">
              <Plus size={15} />
              <span>{t`Add node`}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["trigger", "prompt", "agent", "condition", "output"] as const).map((kind) => (
                <DropdownMenuItem key={kind} onClick={() => add(kind)}>
                  {labels[kind]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      {node || selected ? (
        <aside className="rk-workflow-inspector" aria-label={t`Node details`} data-canvas-controls>
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <h2 className="text-sm font-medium">{node ? labels[node.kind] : t`Connection`}</h2>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t`Close details`}
              onClick={() => select(null)}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="rk-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
            {node ? (
              <>
                <label className="grid gap-2">
                  {t`Name`}
                  <Input
                    disabled={locked}
                    className="rk-workflow-input"
                    maxLength={160}
                    value={node.title}
                    onChange={(event) => update(node, { title: event.target.value })}
                  />
                </label>
                {node.kind === "trigger" ? (
                  <>
                    <label className="grid gap-2">
                      {t`Activation`}
                      <NativeSelect
                        disabled={locked}
                        className="rk-workflow-input"
                        value={node.trigger ?? "manual"}
                        onChange={(event) =>
                          update(node, { trigger: event.target.value as "manual" | "schedule" })
                        }
                      >
                        <NativeSelectOption value="manual">{t`Manual`}</NativeSelectOption>
                        <NativeSelectOption value="schedule">{t`Schedule`}</NativeSelectOption>
                      </NativeSelect>
                    </label>
                    {node.trigger === "schedule" ? (
                      <>
                        <label className="grid gap-2">
                          {t`Cron schedule`}
                          <Input
                            disabled={locked}
                            className="rk-workflow-input"
                            value={node.cron ?? ""}
                            maxLength={100}
                            onChange={(event) => update(node, { cron: event.target.value })}
                          />
                        </label>
                        <p className="text-xs text-muted-foreground">{t`For example: 0 9 * * 1-5 runs at 09:00, Monday to Friday. Activate the schedule in the header.`}</p>
                        <label className="grid gap-2">
                          {t`Timezone`}
                          <Input
                            disabled={locked}
                            className="rk-workflow-input"
                            value={node.timezone ?? "UTC"}
                            maxLength={80}
                            onChange={(event) => update(node, { timezone: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}
                {node.kind === "agent" ? (
                  <label className="grid gap-2">
                    {t`Mico`}
                    <NativeSelect
                      className="rk-workflow-input"
                      disabled={locked}
                      value={node.botId ?? ""}
                      onChange={(event) => update(node, { botId: event.target.value })}
                    >
                      <NativeSelectOption value="">{t`Choose a Mico`}</NativeSelectOption>
                      {bots.map((bot) => (
                        <NativeSelectOption key={bot.id} value={bot.id}>
                          {bot.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <span className="text-xs text-muted-foreground">{t`Uses this Mico’s model, tools and permissions.`}</span>
                  </label>
                ) : null}
                {node.kind !== "drawing" ? (
                  <label className="grid gap-2">
                    {node.kind === "agent" ? t`Instructions` : t`Content`}
                    <Textarea
                      className="rk-workflow-input min-h-32 resize-y"
                      disabled={locked}
                      maxLength={16000}
                      value={node.text}
                      onChange={(event) => update(node, { text: event.target.value })}
                    />
                  </label>
                ) : null}
                {node.kind === "condition" ? <>
                  <label className="grid gap-2">{t`Condition`}<NativeSelect aria-label={t`Condition`} value={node.condition?.operator ?? "nonempty"} disabled={locked}
                    onChange={event => update(node, { condition: { operator: event.target.value as "contains" | "equals" | "nonempty", value: node.condition?.value ?? "" } })}>
                    <NativeSelectOption value="nonempty">{t`Has content`}</NativeSelectOption><NativeSelectOption value="contains">{t`Contains`}</NativeSelectOption><NativeSelectOption value="equals">{t`Equals`}</NativeSelectOption>
                  </NativeSelect></label>
                  {node.condition?.operator !== "nonempty" ? <label className="grid gap-2">{t`Compare with`}<Input aria-label={t`Compare with`} maxLength={1000} disabled={locked} value={node.condition?.value ?? ""} onChange={event => update(node, { condition: { operator: node.condition?.operator ?? "nonempty", value: event.target.value } })}/></label> : null}
                  <label className="grid gap-2">{t`Branch`}<NativeSelect aria-label={t`Branch`} value={branch} disabled={locked} onChange={event => setBranch(event.target.value as "yes" | "no")}><NativeSelectOption value="yes">{t`Yes`}</NativeSelectOption><NativeSelectOption value="no">{t`No`}</NativeSelectOption></NativeSelect></label>
                </> : null}
                {isWorkflowStep(node) && node.kind !== "output" ? (
                  <label className="grid gap-2">
                    {t`Connect to`}
                    <NativeSelect
                      aria-label={t`Connect to`}
                      className="rk-workflow-input"
                      disabled={locked}
                      value=""
                      onChange={event => connect(event.target.value, node.id)}
                    >
                      <NativeSelectOption value="">{t`Choose a step`}</NativeSelectOption>
                      {graph.nodes
                        .filter(
                          (item) =>
                            isWorkflowStep(item) && item.kind !== "trigger" && item.id !== node.id,
                        )
                        .map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.title || labels[item.kind]}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </label>
                ) : null}
                {execution?.steps[node.id]?.output ? (
                  <div>
                    <h3 className="mb-2 text-xs font-medium">{t`Result`}</h3>
                    <pre className="whitespace-pre-wrap break-words text-xs">
                      {execution.steps[node.id]!.output}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex gap-1">
              {iconButton(t`Undo`, Undo2, () => history(true), locked || !undo.current.length)}
              {iconButton(t`Redo`, Redo2, () => history(false), locked || !redo.current.length)}
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto text-destructive"
                disabled={locked}
                onClick={remove}
              >
                <Trash2 size={15} />
                {t`Delete`}
              </Button>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
