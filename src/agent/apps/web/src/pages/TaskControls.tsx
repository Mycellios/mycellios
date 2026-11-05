import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Disclosure, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { useSpaceRpc } from "../lib/space-rpc";

type Task = {
  taskId: string;
  version: number;
  paused: boolean;
  active: boolean;
  botId: string;
  runId: string;
  bots: Array<{ id: string; name: string }>;
};
export function TaskControls({ runId, autoOpen = false }: { runId: string; autoOpen?: boolean }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const id = useId();
  const [task, setTask] = useState<Task | null>(null);
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [work, setWork] = useState<Awaited<ReturnType<RpcClient["tasks"]["work"]>>>([]);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  useEffect(() => { return () => { generation.current++; }; }, []);
  useEffect(() => { if (autoOpen) void load(true); }, [runId, autoOpen]);
  async function refreshWork(taskId: string) {
    const current = generation.current;
    const rows = await rpc.tasks.work({ taskId });
    if (generation.current === current) setWork(rows);
  }
  useEffect(() => {
    if (!expanded || !task) return;
    const timer = window.setInterval(() => {
      if (!busy && document.visibilityState === "visible") void refreshWork(task.taskId).catch(() => setError(t`Could not load task controls`));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [expanded, task?.taskId, busy, rpc]);
  async function load(open: boolean) {
    setExpanded(open);
    generation.current++;
    if (!open) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await rpc.tasks.get({ runId });
      if (generation.current !== current) return;
      setTask(next);
      setBotId(next.botId);
      await refreshWork(next.taskId);
    } catch {
      setError(t`Could not load task controls`);
    } finally {
      setBusy(false);
    }
  }
  async function controlChild(row: typeof work[number], action: "pause" | "resume" | "cancel" | "reassign", destination?: string) {
    if (!task || busy) return;
    setBusy(true); setError("");
    try {
      await rpc.tasks.controlWork({ taskId: row.id, expectedRevision: row.delegationRevision, action, ...(destination ? { botId: destination } : {}) });
      await refreshWork(task.taskId);
    } catch { setError(t`The work changed or could not be updated. Refresh its status and try again.`); await refreshWork(task.taskId).catch(() => undefined); }
    finally { setBusy(false); }
  }
  const delegated = work.some(row => row.delegationState !== null);
  async function control(action: "pause" | "resume" | "reassign") {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      const next = await rpc.tasks.control({
        runId: task.runId,
        expectedVersion: task.version,
        action,
        ...(action === "reassign" ? { botId } : {}),
      });
      setTask({
        ...task,
        ...next,
        active: !next.paused,
        botId: action === "reassign" ? botId : task.botId,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not update task`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Disclosure
      defaultOpen={autoOpen}
      summary={t`Task controls`}
      className="ms-7 pb-2 text-sm"
      onOpenChange={(open) => void load(open)}
    >
      {task && !delegated ? (
        <div className="flex flex-wrap items-center gap-2 py-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (!task.paused && !task.active)}
            onClick={() => void control(task.paused && !task.active ? "resume" : "pause")}
          >
            {task.paused && !task.active ? <Trans>Resume</Trans> : <Trans>Pause</Trans>}
          </Button>
          {task.paused && !task.active ? (
            <>
              <label htmlFor={id} className="sr-only">
                <Trans>Assign to agent</Trans>
              </label>
              <NativeSelect
                id={id}
                value={botId}
                disabled={busy}
                onChange={(event) => setBotId(event.target.value)}
              >
                {task.bots.map((bot) => (
                  <NativeSelectOption key={bot.id} value={bot.id}>
                    {bot.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                disabled={busy || !botId || botId === task.botId}
                onClick={() => void control("reassign")}
              >
                <Trans>Reassign and resume</Trans>
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {delegated ? <div className="space-y-3 py-3" aria-live="polite">
        {work.map(row => <div key={row.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words font-medium">{row.expectedResult || t`Main task`}</span>
            <span className="text-xs text-muted-foreground">{row.workStopPending ? t`Stopping` : workStateLabel(row.executionStatus, row.delegationState)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{task?.bots.find(bot => bot.id === row.botId)?.name ?? t`Mico`}</p>
          {row.result ? <Disclosure summary={t`Result`}><p className="whitespace-pre-wrap break-words text-sm">{row.result}</p></Disclosure> : null}
          {!['completed','cancelled'].includes(row.delegationState ?? '') ? <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy || row.workStopPending} onClick={() => void controlChild(row, row.paused ? "resume" : "pause")}>
              {row.paused ? <Trans>Resume</Trans> : <Trans>Pause</Trans>}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || row.workStopPending} onClick={() => void controlChild(row, "cancel")}><Trans>Cancel task</Trans></Button>
            {row.paused && !row.workStopPending ? <NativeSelect aria-label={t`Reassign task`} value={row.botId} disabled={busy} onChange={event => void controlChild(row, "reassign", event.target.value)}>
              {task?.bots.map(bot => <NativeSelectOption key={bot.id} value={bot.id}>{bot.name}</NativeSelectOption>)}
            </NativeSelect> : null}
          </div> : null}
        </div>)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => task && void refreshWork(task.taskId)}><Trans>Refresh</Trans></Button>
      </div> : null}
      {error ? (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Disclosure>
  );
}

function workStateLabel(execution: string | null | undefined, state: string | null) {
  if (state === "paused") return <Trans>Paused</Trans>;
  if (state === "cancelled") return <Trans>Cancelled</Trans>;
  if (state === "waiting") return <Trans>Waiting for subtasks</Trans>;
  switch (execution ?? state) {
    case "queued": case "leased": return <Trans>Queued</Trans>;
    case "running": return <Trans>Running</Trans>;
    case "completed": return <Trans>Completed</Trans>;
    case "failed": return <Trans>Failed</Trans>;
    default: return <Trans>Waiting</Trans>;
  }
}
