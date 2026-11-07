import { useLingui } from "@lingui/react/macro";
import type { AccountPlanLimits } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { ChartArea, ChevronDown, Gauge, RefreshCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "../lib/app-path";
import { useSpaceRpc } from "../lib/space-rpc";
import {
  freshQuota,
  providerName,
  quotaColor,
  quotaPreferencesKey,
  readQuotaPreferences,
  remainingQuota,
  ringWindows,
  usableWindow,
} from "./quota-view";

export function ProviderQuota(props: {
  scope: string;
  onModels: () => void;
  onUsage: () => void;
  compact?: boolean;
}) {
  return <QuotaContent key={props.scope} {...props} />;
}
function QuotaContent({
  scope,
  onModels,
  onUsage,
  compact = true,
}: {
  scope: string;
  onModels: () => void;
  onUsage: () => void;
  compact?: boolean;
}) {
  const { t, i18n } = useLingui();
  const rpc = useSpaceRpc();
  const [preferences, setPreferences] = useState(() => readQuotaPreferences(scope));
  const [data, setData] = useState<AccountPlanLimits | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true);
  const loading = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (refresh = false) => {
      if (loading.current && !controller.current?.signal.aborted) return;
      loading.current = true;
      setBusy(true);
      const abort = new AbortController();
      controller.current = abort;
      try {
        const value = await rpc.models.planLimits({ refresh }, { signal: abort.signal });
        if (alive.current && !abort.signal.aborted) {
          setData(value);
          setError(false);
          setNow(Date.now());
        }
      } catch {
        if (alive.current && !abort.signal.aborted) setError(true);
      } finally {
        if (controller.current === abort) loading.current = false;
        if (alive.current && !abort.signal.aborted) setBusy(false);
      }
    },
    [rpc],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      controller.current?.abort();
      clearInterval(tick);
    };
  }, [load]);
  useEffect(() => {
    if (!preferences.autoRefresh) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, preferences.autoRefresh]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === quotaPreferencesKey(scope))
        setPreferences(readQuotaPreferences(scope));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [scope]);
  function save(next: typeof preferences) {
    setPreferences(next);
    try {
      localStorage.setItem(quotaPreferencesKey(scope), JSON.stringify(next));
    } catch {
      /* Session preferences still work. */
    }
  }
  const accounts = data?.accounts.filter((row) => row.status !== "unsupported") ?? [];
  const account =
    accounts.find((row) => row.credentialId === preferences.accountId) ??
    accounts.find((row) => ringWindows(row, now).length > 0) ??
    accounts[0];
  const windows = !error ? ringWindows(account, now) : [];
  const remaining = windows.length ? Math.min(...windows.map(remainingQuota)) : null;
  const name = account ? providerName(account.provider) : t`Model accounts`;
  const logo =
    account?.provider === "openai-codex"
      ? "openai"
      : account?.provider === "anthropic"
        ? "anthropic"
        : null;
  const summary =
    remaining === null ? t`Quota unavailable` : t`${Math.round(remaining)}% remaining`;
  const action = (callback: () => void) => {
    setOpen(false);
    callback();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void load();
      }}
    >
      <PopoverTrigger
        data-testid="provider-quota-trigger"
        openOnHover={compact}
        aria-label={`${t`Subscription quota`}: ${name} · ${summary}`}
        title={`${name} · ${summary}`}
        className={`app-no-drag relative flex shrink-0 items-center rounded-lg outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${compact ? "size-10 justify-center" : "mx-3 gap-2 px-2 py-1.5 text-sm"}`}
      >
        <span className="relative grid size-[34px] shrink-0 place-items-center">
          <svg className="absolute inset-0" viewBox="0 0 34 34" aria-hidden="true">
            {(windows.length ? windows : [null]).map((window, index) => {
              const radius = 15.5 - index * 4;
              const perimeter = 2 * Math.PI * radius;
              return (
                <g key={window?.id ?? "unknown"}>
                  <circle
                    cx="17"
                    cy="17"
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity=".12"
                    strokeWidth="2"
                  />
                  {window ? (
                    <circle
                      cx="17"
                      cy="17"
                      r={radius}
                      fill="none"
                      stroke={quotaColor(remainingQuota(window))}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={`${(perimeter * remainingQuota(window)) / 100} ${perimeter}`}
                      transform="rotate(-90 17 17)"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          {logo ? (
            <img src={appPath(`/providers/${logo}.svg`)} alt="" className="size-3.5 dark:invert" />
          ) : (
            <Gauge size={15} className="text-muted-foreground" />
          )}
        </span>
        {!compact ? (
          <>
            <span className="flex-1 text-start">{t`Subscription quota`}</span>
            <ChevronDown size={13} />
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side={compact ? "right" : "top"}
        align="end"
        sideOffset={8}
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        className="app-no-drag max-h-[calc(100dvh-24px)] w-[340px] max-w-[calc(100vw-24px)] gap-0 overflow-y-auto rounded-xl p-0"
        data-testid="provider-quota-panel"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <PopoverTitle className="flex items-center gap-2"><Gauge size={16} aria-hidden="true" />{t`Usage`}</PopoverTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Refresh quota`}
              disabled={busy}
              onClick={() => void load(true)}
            >
              <RefreshCw
                size={15}
                className={busy ? "animate-spin motion-reduce:animate-none" : ""}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t`Quota settings`}
                className="grid size-8 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-24px)]">
                <DropdownMenuCheckboxItem
                  checked={preferences.autoRefresh}
                  onCheckedChange={(value) => save({ ...preferences, autoRefresh: value })}
                >{t`Refresh automatically`}</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => action(onModels)}
                >{t`Manage model accounts`}</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => action(onUsage)}
                >{t`View usage and costs`}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="space-y-3 px-4 py-3">
          {busy && !data ? (
            <p role="status" className="text-sm text-muted-foreground">{t`Checking quota…`}</p>
          ) : error ? (
            <p role="status" className="text-sm text-muted-foreground">{t`Could not refresh quota. Try again.`}</p>
          ) : !accounts.length ? (
            <p className="text-sm text-muted-foreground">
              {data?.accounts.length
                ? t`This connection does not report subscription quota.`
                : t`Connect a model account to see its subscription quota.`}
            </p>
          ) : (
            accounts.map((row) => {
              const provider = providerName(row.provider);
              const icon = row.provider === "openai-codex" ? "openai" : row.provider === "anthropic" ? "anthropic" : null;
              return (
                <section key={row.credentialId} className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    {icon ? <img src={appPath(`/providers/${icon}.svg`)} alt="" className="size-4 shrink-0 dark:invert" /> : null}
                    <span className="truncate">{provider}</span>
                    {row.label !== row.provider && row.label !== provider ? (
                      <span className="truncate text-xs font-normal text-muted-foreground">{row.label}</span>
                    ) : null}
                  </h3>
                  {row.status !== "available" ? (
                    <p className="text-xs text-muted-foreground">
                      {row.status === "reconnect"
                        ? t`Reconnect this account in model settings.`
                        : row.status === "rate_limited"
                          ? t`The provider has paused quota checks. Try again later.`
                          : t`Quota is temporarily unavailable.`}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {row.windows.map((window) => {
                        const fresh = freshQuota(row, now) && usableWindow(window, now);
                        const value = remainingQuota(window);
                        const label = window.durationMinutes === 300 ? t`5 hours`
                          : window.durationMinutes === 10080 ? t`Weekly`
                            : window.label === "Session" ? t`Session` : window.label;
                        const windowName = window.model ? `${window.model} · ${label}` : label;
                        const date = window.resetsAt ? new Date(window.resetsAt) : null;
                        const minutes = date ? Math.max(0, Math.ceil((date.getTime() - now) / 60_000)) : 0;
                        const remainingTime = minutes >= 1440 ? `${Math.floor(minutes / 1440)} d ${Math.floor(minutes % 1440 / 60)} h`
                          : minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
                        return (
                          <li key={window.id} className="flex min-w-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                            <span title={windowName} className="min-w-0 max-w-[40%] truncate">{windowName}</span>
                            <div
                              role="progressbar"
                              aria-label={`${provider} · ${windowName}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={fresh ? Math.round(value) : undefined}
                              aria-valuetext={fresh ? t`${Math.round(value)}% remaining` : t`Awaiting refresh`}
                              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                            >
                              {fresh ? <div style={{ width: `${value}%`, backgroundColor: quotaColor(value) }} className="h-full rounded-full" /> : null}
                            </div>
                            {fresh ? <span className="shrink-0 font-semibold" style={{ color: quotaColor(value) }}>{Math.round(value)}%</span> : <span>{t`Awaiting refresh`}</span>}
                            {fresh && date ? (
                              <time dateTime={date.toISOString()} title={new Intl.DateTimeFormat(i18n.locale, { dateStyle: "full", timeStyle: "short" }).format(date)} className="shrink-0">
                                {remainingTime}
                              </time>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
        <div className="grid gap-1 border-t p-2">
          <Button variant="ghost" className="justify-start gap-2" onClick={() => action(onModels)}>
            <Settings2 size={15} />
            {t`Manage model accounts`}
          </Button>
          <Button variant="ghost" className="justify-start gap-2" onClick={() => action(onUsage)}>
            <ChartArea size={15} />
            {t`View usage and costs`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
