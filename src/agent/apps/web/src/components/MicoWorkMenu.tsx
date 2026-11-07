import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { notificationPreferences } from "../lib/notification-preferences";
import { useBoundSpaceId, useSpaceRpc } from "../lib/space-rpc";
import { TaskControls } from "../pages/TaskControls";

type Overview = Awaited<ReturnType<RpcClient["tasks"]["overview"]>>;
const observed = new Map<string, Map<string, string>>();
export function MicoWorkMenu({
  botId,
  runId,
  userId,
  threadId,
  onOpenTask,
  inMenu = false,
}: {
  botId: string;
  runId?: string;
  userId?: string;
  threadId?: string;
  inMenu?: boolean;
  onOpenTask: (task: Overview[number]) => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const spaceId = useBoundSpaceId();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<{ limit: number; effectiveLimit: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [work, setWork] = useState<Overview>([]);
  const [failed, setFailed] = useState<Overview[number]>();
  useEffect(() => {
    let current = true,
      pending = false;
    const scope = `${userId ?? ""}:${spaceId ?? ""}`;
    const previous = observed.get(scope) ?? new Map<string, string>();
    const initialized = observed.has(scope);
    let ready = initialized;
    observed.set(scope, previous);
    const refresh = async () => {
      if (pending || (document.visibilityState !== "visible" && !ready)) return;
      pending = true;
      try {
        const rows = await rpc.tasks.overview();
        if (!current) return;
        setWork(rows);
        for (const row of rows) {
          const state = `${row.runId}:${row.status}`;
          if (
            ready &&
            previous.get(row.taskId) !== state &&
            row.status === "failed" &&
            row.threadId !== threadId
          ) {
            setFailed(row);
            const preference = notificationPreferences(userId ?? "");
            if (
              row.notify &&
              preference.enabled &&
              (document.visibilityState !== "visible" || !document.hasFocus()) &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              try {
                const notice = new Notification(t`Delegated task failed`, {
                  body: preference.preview ? row.name : t`Open Mycellios to review the task.`,
                  tag: `work:${row.taskId}:${row.runId}`,
                });
                notice.onclick = () => {
                  if (document.documentElement.getAttribute("data-preview-owner") === userId) {
                    window.focus();
                    onOpenTask(row);
                  }
                  notice.close();
                };
              } catch {
                /* Some PWA runtimes require service-worker notifications. Keep the in-app alert. */
              }
            }
          }
          previous.set(row.taskId, state);
        }
        for (const id of previous.keys())
          if (!rows.some((row) => row.taskId === id)) previous.delete(id);
        ready = true;
      } catch {
        if (current) setError(t`Could not load task controls`);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [rpc, userId, spaceId, threadId]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void rpc.tasks
      .concurrency({ botId })
      .then((value) => {
        if (current) setPolicy(value);
      })
      .catch(() => {
        if (current) setError(t`Could not load task controls`);
      });
    return () => {
      current = false;
    };
  }, [open, botId, rpc]);
  const activeCount = work.filter((row) => ["running", "queued", "leased"].includes(row.status)).length;
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setFailed(undefined);
      }}
    >
      <PopoverTrigger
        render={
          <Button size="icon-sm" variant="ghost" className="relative shrink-0" data-mobile-chat-action={inMenu || undefined}
            aria-label={failed ? t`Task failed` : t`Work`} title={failed ? t`Task failed` : t`Work`} />
        }
      >
        <Activity size={15} aria-hidden="true" />
        {inMenu ? (failed ? t`Task failed` : t`Work`) : null}
        {failed || activeCount ? <span aria-hidden="true"
          className={`absolute end-0.5 top-0.5 size-1.5 rounded-full ${failed ? "bg-destructive" : "bg-foreground"}`} /> : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70dvh] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <div className="space-y-3">
          <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Trans>Simultaneous tasks</Trans>
            <NativeSelect
              aria-label={t`Simultaneous tasks`}
              value={policy?.limit ?? 1}
              disabled={!policy || busy}
              onChange={(event) => {
                setBusy(true);
                setError("");
                void rpc.tasks
                  .concurrency({ botId, limit: Number(event.target.value) })
                  .then(setPolicy)
                  .catch(() => setError(t`Could not update task`))
                  .finally(() => setBusy(false));
              }}
            >
              {[1, 2, 3, 4].map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {policy && policy.effectiveLimit !== policy.limit ? (
            <p className="text-xs text-muted-foreground">
              <Trans>This runtime currently runs one task at a time.</Trans>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            <Trans>
              Computer operations remain exclusive. Changing the limit does not stop active work.
            </Trans>
          </p>
          {runId ? (
            <TaskControls key={runId} runId={runId} autoOpen />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>No active work in this conversation. Earlier work remains in Activity.</Trans>
            </p>
          )}
          {work.length ? (
            <div className="space-y-1 border-t pt-2">
              <p className="text-xs text-muted-foreground">
                <Trans>Recent delegated work</Trans>
              </p>
              {work.map((row) => (
                <Button
                  key={row.taskId}
                  size="sm"
                  variant="ghost"
                  className="w-full justify-between"
                  onClick={() => {
                    onOpenTask(row);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{row.name}</span>
                  <span>{row.status}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
