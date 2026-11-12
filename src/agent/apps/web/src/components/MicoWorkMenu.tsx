import { accountNotificationAllowed, accountNotificationSettings } from "../lib/account-notifications";
import { hasFocusedNotificationTab, showSystemNotification } from "../lib/browser-notifications";
import { usesServerPush } from "../lib/web-push";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ListTodo } from "lucide-react";
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
              preference.enabled && preference.mutedUntil <= Date.now() && !usesServerPush() &&
              accountNotificationAllowed(userId ?? "", row.botId, { type: "run.failed", payload: {} }) &&
              !hasFocusedNotificationTab(userId ?? "") &&
              (document.visibilityState !== "visible" || !document.hasFocus()) &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              try {
                const preview = preference.preview && (accountNotificationSettings(userId ?? "")?.previews ?? false);
                const query = new URLSearchParams(); if (spaceId) query.set("noticeSpace", spaceId); query.set("task", row.threadId);
                const route = `/app/${encodeURIComponent(row.botId)}?${query}`;
                await showSystemNotification(preview ? t`Delegated task failed` : "Mycellios",
                  preview ? row.name : t`Open Mycellios to review the task.`, `mycellios:${userId}:${row.threadId}`, route, preference.sound,
                  () => { if (document.documentElement.getAttribute("data-preview-owner") === userId) onOpenTask(row); });
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
  const label = t`Tasks`;
  const triggerLabel = failed ? `${label} · ${t`Task failed`}` : label;
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
          <Button size="icon-sm" variant="ghost" className="relative shrink-0 text-muted-foreground hover:text-foreground" data-mobile-chat-action={inMenu || undefined}
            aria-label={triggerLabel} title={triggerLabel} />
        }
      >
        <ListTodo size={15} aria-hidden="true" />
        {inMenu ? label : null}
        {failed || activeCount ? <span aria-hidden="true"
          className={`absolute end-0.5 top-0.5 size-1.5 rounded-full ${failed ? "bg-destructive" : "bg-muted-foreground"}`} /> : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto p-4"
      >
        <PopoverTitle className="text-xs font-normal text-muted-foreground">{label}</PopoverTitle>
        <div className="space-y-3">
          {runId ? (
            <TaskControls key={runId} runId={runId} autoOpen embedded />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>No tasks running</Trans>
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
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm" htmlFor={`task-limit-${botId}`}><Trans>Tasks at once</Trans></label>
              <NativeSelect
                id={`task-limit-${botId}`}
                className="w-16 shrink-0"
                aria-label={t`Simultaneous tasks`}
                title={t`Computer operations remain exclusive. Changing the limit does not stop active work.`}
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
                  <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {policy && policy.effectiveLimit !== policy.limit ? <Trans>This runtime currently runs one task at a time.</Trans> : <Trans>Extra tasks wait their turn.</Trans>}
            </p>
          </div>
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
