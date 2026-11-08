import { Trans, useLingui } from "@lingui/react/macro";
import type { Workflow, WorkflowExecution, WorkflowGraph, WorkflowNode } from "@rakazo/contracts";
import { workflowPlan } from "@rakazo/contracts";
import { userFacingLabel } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Disclosure,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";

type Bot = { id: string; name: string };
const key = () => crypto.randomUUID();
function initialGraph(botId: string): WorkflowGraph {
  return {
    nodes: [
      { id: "start", kind: "trigger", trigger: "manual", title: "Start", text: "", x: 30, y: 60 },
      { id: "instruction", kind: "prompt", title: "Instruction", text: "", x: 280, y: 60 },
      { id: "mico", kind: "agent", botId, title: "Mico", text: "", x: 530, y: 60 },
      { id: "result", kind: "output", title: "Result", text: "", x: 780, y: 60 },
    ],
    edges: [
      { id: "a", from: "start", to: "instruction" },
      { id: "b", from: "instruction", to: "mico" },
      { id: "c", from: "mico", to: "result" },
    ],
  };
}

/** The visual graph and its executions use the current Space and the user's existing Micos. */
export function WorkflowWorkspace({
  botId,
  bots,
  onClose,
}: {
  botId: string;
  bots: Bot[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const marker = useId().replaceAll(":", "");
  const [items, setItems] = useState<Workflow[]>([]);
  const [saved, setSaved] = useState<Workflow>();
  const [draft, setDraft] = useState<{
    id: string;
    name: string;
    graph: WorkflowGraph;
    active: boolean;
  }>(() => ({ id: key(), name: "", graph: initialGraph(botId), active: false }));
  const [selected, setSelected] = useState("instruction");
  const [target, setTarget] = useState("");
  const [branch, setBranch] = useState<"yes" | "no">("yes");
  const [runs, setRuns] = useState<WorkflowExecution[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const nonce = useRef<string | undefined>(undefined);
  const selection = useRef(0);
  const dirty = !saved
    ? Boolean(
        draft.name ||
          draft.active ||
          JSON.stringify(draft.graph) !== JSON.stringify(initialGraph(botId)),
      )
    : JSON.stringify({
        id: saved.id,
        name: saved.name,
        graph: saved.graph,
        active: saved.active,
      }) !== JSON.stringify(draft);
  const selectedNode = draft.graph.nodes.find((node) => node.id === selected);
  const kindLabel = (kind: WorkflowNode["kind"]) =>
    ({
      trigger: t`Trigger`,
      prompt: t`Instruction`,
      agent: t`Mico`,
      condition: t`Condition`,
      output: t`Result`,
      note: t`Note`,
      text: t`Text`,
      shape: t`Shape`,
      drawing: t`Drawing`,
    })[kind];
  useEffect(() => {
    alive.current = true;
    void rpc.workflows
      .list()
      .then((value) => {
        if (alive.current) setItems(value);
      })
      .catch(() => {
        if (alive.current) setError(t`Could not load workflows`);
      });
    return () => {
      alive.current = false;
      selection.current++;
    };
  }, [rpc]);
  useEffect(() => {
    if (!saved) {
      setRuns([]);
      return;
    }
    const epoch = ++selection.current;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = await rpc.workflows.runs({ id: saved.id });
        if (alive.current && selection.current === epoch) setRuns(next);
      } catch {
        if (alive.current && selection.current === epoch) setError(t`Could not load executions`);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      selection.current++;
      window.clearInterval(timer);
    };
  }, [saved?.id, rpc]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy]);
  function changeNode(patch: Partial<WorkflowNode>) {
    setDraft((value) => ({
      ...value,
      graph: {
        ...value.graph,
        nodes: value.graph.nodes.map((node) =>
          node.id === selected ? { ...node, ...patch } : node,
        ),
      },
    }));
  }
  function choose(flow?: Workflow) {
    if (busy) return;
    if (dirty) {
      setError(t`Save or discard your changes first.`);
      return;
    }
    nonce.current = undefined;
    setSaved(flow);
    setError("");
    setDraft(
      flow
        ? { id: flow.id, name: flow.name, graph: flow.graph, active: flow.active }
        : { id: key(), name: "", graph: initialGraph(botId), active: false },
    );
    setSelected(flow?.graph.nodes[0]?.id ?? "instruction");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = saved
        ? await rpc.workflows.save({ ...draft, expectedVersion: saved.version })
        : await rpc.workflows.create({ id: draft.id, name: draft.name, graph: draft.graph });
      if (!alive.current) return;
      setSaved(result);
      setDraft({ id: result.id, name: result.name, graph: result.graph, active: result.active });
      setItems((values) => [result, ...values.filter((value) => value.id !== result.id)]);
      nonce.current = undefined;
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : t`Could not save workflow`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function execute(triggerId: string) {
    if (!saved || dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      workflowPlan(draft.graph, triggerId);
      nonce.current ??= key();
      const result = await rpc.workflows.execute({
        id: saved.id,
        expectedVersion: saved.version,
        triggerId,
        clientNonce: nonce.current,
      });
      if (alive.current) {
        nonce.current = undefined;
        setRuns((values) => [result, ...values.filter((value) => value.id !== result.id)]);
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : t`Could not start workflow`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function add(kind: WorkflowNode["kind"]) {
    if (draft.graph.nodes.length >= 60) return;
    const id = key();
    setDraft((value) => ({
      ...value,
      graph: {
        ...value.graph,
        nodes: [
          ...value.graph.nodes,
          {
            id,
            kind,
            title: kind,
            text: "",
            x: 30 + (value.graph.nodes.length % 4) * 250,
            y: 60 + Math.floor(value.graph.nodes.length / 4) * 150,
            ...(kind === "agent" ? { botId } : {}),
            ...(kind === "trigger" ? { trigger: "manual" as const } : {}),
            ...(kind === "condition"
              ? { condition: { operator: "nonempty" as const, value: "" } }
              : {}),
          },
        ],
      },
    }));
    setSelected(id);
  }
  const running = runs.some((run) => run.status === "running" || run.status === "queued");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        if (dirty || busy) setError(t`Save or discard your changes first.`);
        else onClose();
      }}
    >
      <DialogContent
        style={{ width: "min(1400px, 96vw)", maxWidth: "none" }}
        className="flex max-h-[94dvh] flex-col overflow-hidden"
      >
        <DialogTitle>
          <Trans>Workflows</Trans>
        </DialogTitle>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={t`Workflow`}
            value={saved?.id ?? ""}
            disabled={busy}
            onChange={(event) => choose(items.find((item) => item.id === event.target.value))}
          >
            <NativeSelectOption value="">
              <Trans>New workflow</Trans>
            </NativeSelectOption>
            {items.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={t`Workflow name`}
            value={draft.name}
            maxLength={160}
            disabled={busy}
            className="max-w-72"
            onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
          />
          <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
            <Trans>Save</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(
                saved
                  ? { id: saved.id, name: saved.name, graph: saved.graph, active: saved.active }
                  : { id: key(), name: "", graph: initialGraph(botId), active: false },
              );
              setError("");
            }}
          >
            <Trans>Discard changes</Trans>
          </Button>
          {saved ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || dirty || running}
              onClick={() => {
                setBusy(true);
                void rpc.workflows
                  .archive({ id: saved.id })
                  .then(() => {
                    if (!alive.current) return;
                    setItems((values) => values.filter((item) => item.id !== saved.id));
                    setSaved(undefined);
                    setDraft({ id: key(), name: "", graph: initialGraph(botId), active: false });
                    setRuns([]);
                    nonce.current = undefined;
                  })
                  .catch(() => {
                    if (alive.current) setError(t`Could not archive workflow`);
                  })
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              <Trans>Archive workflow</Trans>
            </Button>
          ) : null}
          {draft.graph.nodes
            .filter((node) => node.kind === "trigger")
            .map((node) => (
              <Button
                size="sm"
                key={node.id}
                disabled={busy || dirty || !saved || running}
                onClick={() => void execute(node.id)}
              >
                <Trans>Run</Trans>: {userFacingLabel({ title: node.title }, t`Step`)}
              </Button>
            ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-1">
              {(["trigger", "prompt", "agent", "condition", "output", "note"] as const).map(
                (kind) => (
                  <Button
                    key={kind}
                    variant="ghost"
                    size="sm"
                    disabled={busy || draft.graph.nodes.length >= 60}
                    onClick={() => add(kind)}
                  >
                    + {kindLabel(kind)}
                  </Button>
                ),
              )}
            </div>
            <div
              className="relative h-[420px] overflow-auto rounded-lg border border-border bg-muted/30"
              aria-label={t`Workflow canvas`}
            >
              <div
                className="relative"
                style={{
                  width: Math.max(1040, ...draft.graph.nodes.map((node) => node.x + 230)),
                  height: Math.max(420, ...draft.graph.nodes.map((node) => node.y + 120)),
                }}
              >
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute h-full w-full overflow-visible"
                >
                  <defs>
                    <marker
                      id={marker}
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8" fill="currentColor" />
                    </marker>
                  </defs>
                  {draft.graph.edges.map((edge) => {
                    const from = draft.graph.nodes.find((node) => node.id === edge.from),
                      to = draft.graph.nodes.find((node) => node.id === edge.to);
                    return from && to ? (
                      <g key={edge.id} className="text-muted-foreground">
                        <path
                          d={`M ${from.x + 210} ${from.y + 32} C ${from.x + 240} ${from.y + 32}, ${to.x - 30} ${to.y + 32}, ${to.x} ${to.y + 32}`}
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                          markerEnd={`url(#${marker})`}
                        />
                        <text
                          x={(from.x + 210 + to.x) / 2}
                          y={(from.y + to.y) / 2 + 24}
                          fill="currentColor"
                          fontSize="12"
                        >
                          {edge.branch ?? ""}
                        </text>
                      </g>
                    ) : null;
                  })}
                </svg>
                {draft.graph.nodes.map((node) => (
                  <Button
                    key={node.id}
                    variant={selected === node.id ? "secondary" : "outline"}
                    disabled={busy}
                    className="absolute h-auto w-[210px] flex-col items-start whitespace-normal p-3 text-start"
                    style={{ left: node.x, top: node.y }}
                    onClick={() => setSelected(node.id)}
                  >
                    <span className="text-xs text-muted-foreground">{kindLabel(node.kind)}</span>
                    <span className="max-w-full truncate">
                      {node.title || kindLabel(node.kind)}
                    </span>
                    <span className="text-xs">{runs[0]?.steps[node.id]?.status ?? ""}</span>
                  </Button>
                ))}
              </div>
            </div>
            <Disclosure summary={t`Executions`} defaultOpen>
              <div className="space-y-2 py-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>{run.status}</span>
                      {["queued", "running"].includes(run.status) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void rpc.workflows
                              .stop({ executionId: run.id })
                              .then(() => rpc.workflows.runs({ id: run.workflowId }))
                              .then(setRuns)
                              .catch(() => setError(t`Could not stop workflow`))
                              .finally(() => setBusy(false));
                          }}
                        >
                          <Trans>Stop</Trans>
                        </Button>
                      ) : null}
                    </div>
                    {run.error ? <p className="text-destructive">{run.error}</p> : null}
                    {Object.entries(run.steps)
                      .filter(([, step]) => step.output)
                      .map(([id, step]) => (
                        <Disclosure
                          key={id}
                          summary={draft.graph.nodes.find((node) => node.id === id)?.title || id}
                        >
                          <p className="whitespace-pre-wrap break-words py-2">{step.output}</p>
                        </Disclosure>
                      ))}
                  </div>
                ))}
              </div>
            </Disclosure>
          </div>
          <div className="space-y-3 text-sm">
            <NativeSelect
              aria-label={t`Edit step`}
              value={selected}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {draft.graph.nodes.map((node) => (
                <NativeSelectOption key={node.id} value={node.id}>
                  {node.title || kindLabel(node.kind)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {selectedNode ? (
              <>
                <label className="block space-y-1">
                  <span>
                    <Trans>Step title</Trans>
                  </span>
                  <Input
                    value={selectedNode.title}
                    maxLength={160}
                    disabled={busy}
                    onChange={(event) => changeNode({ title: event.target.value })}
                  />
                </label>
                <label className="block space-y-1">
                  <span>
                    <Trans>Instruction or text</Trans>
                  </span>
                  <Textarea
                    value={selectedNode.text}
                    maxLength={16000}
                    disabled={busy}
                    onChange={(event) => changeNode({ text: event.target.value })}
                  />
                </label>
                <div className="flex gap-2">
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis} className="min-w-0">
                      {axis.toUpperCase()}
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        value={selectedNode[axis]}
                        disabled={busy}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value))
                            changeNode({ [axis]: Math.max(0, Math.min(10000, value)) });
                        }}
                      />
                    </label>
                  ))}
                </div>
                {selectedNode.kind === "agent" ? (
                  <NativeSelect
                    aria-label={t`Mico`}
                    value={selectedNode.botId ?? ""}
                    disabled={busy}
                    onChange={(event) => changeNode({ botId: event.target.value })}
                  >
                    {bots.map((bot) => (
                      <NativeSelectOption key={bot.id} value={bot.id}>
                        {bot.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : null}
                {selectedNode.kind === "trigger" ? (
                  <>
                    <NativeSelect
                      aria-label={t`Trigger`}
                      value={selectedNode.trigger ?? "manual"}
                      disabled={busy}
                      onChange={(event) =>
                        changeNode({ trigger: event.target.value as "manual" | "schedule" })
                      }
                    >
                      <NativeSelectOption value="manual">
                        <Trans>Manual</Trans>
                      </NativeSelectOption>
                      <NativeSelectOption value="schedule">
                        <Trans>Schedule</Trans>
                      </NativeSelectOption>
                    </NativeSelect>
                    {selectedNode.trigger === "schedule" ? (
                      <>
                        <Input
                          aria-label={t`Cron schedule`}
                          placeholder="0 9 * * *"
                          value={selectedNode.cron ?? ""}
                          disabled={busy}
                          onChange={(event) => changeNode({ cron: event.target.value })}
                        />
                        <Input
                          aria-label={t`Time zone`}
                          placeholder="Europe/Madrid"
                          value={selectedNode.timezone ?? ""}
                          disabled={busy}
                          onChange={(event) => changeNode({ timezone: event.target.value })}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                {selectedNode.kind === "condition" ? (
                  <>
                    <NativeSelect
                      aria-label={t`Condition`}
                      value={selectedNode.condition?.operator ?? "nonempty"}
                      disabled={busy}
                      onChange={(event) =>
                        changeNode({
                          condition: {
                            operator: event.target.value as "contains" | "equals" | "nonempty",
                            value: selectedNode.condition?.value ?? "",
                          },
                        })
                      }
                    >
                      {["nonempty", "contains", "equals"].map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {value}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label={t`Compare with`}
                      value={selectedNode.condition?.value ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        changeNode({
                          condition: {
                            operator: selectedNode.condition?.operator ?? "nonempty",
                            value: event.target.value,
                          },
                        })
                      }
                    />
                  </>
                ) : null}
                <NativeSelect
                  aria-label={t`Connect to step`}
                  value={target}
                  disabled={
                    busy ||
                    !["trigger", "prompt", "agent", "condition", "output"].includes(
                      selectedNode.kind,
                    )
                  }
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <NativeSelectOption value="">
                    <Trans>Connect to step</Trans>
                  </NativeSelectOption>
                  {draft.graph.nodes
                    .filter(
                      (node) =>
                        node.id !== selected &&
                        ["prompt", "agent", "condition", "output"].includes(node.kind),
                    )
                    .map((node) => (
                      <NativeSelectOption key={node.id} value={node.id}>
                        {userFacingLabel({ title: node.title }, t`Step`)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                {selectedNode.kind === "condition" ? (
                  <NativeSelect
                    aria-label={t`Branch`}
                    value={branch}
                    disabled={busy}
                    onChange={(event) => setBranch(event.target.value as "yes" | "no")}
                  >
                    <NativeSelectOption value="yes">
                      <Trans>Yes</Trans>
                    </NativeSelectOption>
                    <NativeSelectOption value="no">
                      <Trans>No</Trans>
                    </NativeSelectOption>
                  </NativeSelect>
                ) : null}
                <Button
                  size="sm"
                  disabled={busy || !target || draft.graph.edges.length >= 120}
                  onClick={() =>
                    setDraft((value) => ({
                      ...value,
                      graph: {
                        ...value.graph,
                        edges: [
                          ...value.graph.edges,
                          {
                            id: key(),
                            from: selected,
                            to: target,
                            ...(selectedNode.kind === "condition" ? { branch } : {}),
                          },
                        ],
                      },
                    }))
                  }
                >
                  <Trans>Connect</Trans>
                </Button>
                {draft.graph.edges
                  .filter((edge) => edge.from === selected)
                  .map((edge) => (
                    <Button
                      key={edge.id}
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setDraft((value) => ({
                          ...value,
                          graph: {
                            ...value.graph,
                            edges: value.graph.edges.filter((value) => value.id !== edge.id),
                          },
                        }))
                      }
                    >
                      <Trans>Disconnect</Trans>:{" "}
                      {draft.graph.nodes.find((node) => node.id === edge.to)?.title}
                    </Button>
                  ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDraft((value) => ({
                      ...value,
                      graph: {
                        nodes: value.graph.nodes.filter((node) => node.id !== selected),
                        edges: value.graph.edges.filter(
                          (edge) => edge.from !== selected && edge.to !== selected,
                        ),
                      },
                    }))
                  }
                >
                  <Trans>Remove step</Trans>
                </Button>
              </>
            ) : null}
            {saved ? (
              <NativeSelect
                aria-label={t`Scheduled execution`}
                value={draft.active ? "on" : "off"}
                disabled={busy}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, active: event.target.value === "on" }))
                }
              >
                <NativeSelectOption value="off">
                  <Trans>Schedule disabled</Trans>
                </NativeSelectOption>
                <NativeSelectOption value="on">
                  <Trans>Schedule enabled</Trans>
                </NativeSelectOption>
              </NativeSelect>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <Trans>
                Uses the selected Mico's existing model and permissions. Inputs from earlier steps
                are data, not new authorization.
              </Trans>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
