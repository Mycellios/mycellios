import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Disclosure, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useId, useState } from "react";
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
export function TaskControls({ runId }: { runId: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const id = useId();
  const [task, setTask] = useState<Task | null>(null);
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(open: boolean) {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      const next = await rpc.tasks.get({ runId });
      setTask(next);
      setBotId(next.botId);
    } catch {
      setError(t`Could not load task controls`);
    } finally {
      setBusy(false);
    }
  }
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
      summary={t`Task controls`}
      className="ms-7 pb-2 text-sm"
      onOpenChange={(open) => void load(open)}
    >
      {task ? (
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
      {error ? (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Disclosure>
  );
}
