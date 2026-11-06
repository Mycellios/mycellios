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
  const accounts = data?.accounts ?? [];
  const account =
    accounts.find((row) => row.credentialId === preferences.accountId) ??
    accounts.find(
      (row) => row.authKind === "oauth" && ["openai-codex", "anthropic"].includes(row.provider),
    ) ??
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
          <PopoverTitle>{t`Subscription quota`}</PopoverTitle>
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
        <div className="space-y-4 px-4 py-3">
          {accounts.length ? (
            <div className="space-y-1">
              <label
                htmlFor={`quota-account-${compact ? "rail" : "mobile"}`}
                className="text-xs text-muted-foreground"
              >{t`Account`}</label>
              <select
                id={`quota-account-${compact ? "rail" : "mobile"}`}
                aria-label={t`Quota account`}
                value={account?.credentialId ?? ""}
                onChange={(event) => save({ ...preferences, accountId: event.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {accounts.map((row) => (
                  <option key={row.credentialId} value={row.credentialId}>
                    {providerName(row.provider)} · {row.label}
                  </option>
                ))}
              </select>
              {account?.plan ? (
                <p className="text-xs capitalize text-muted-foreground">{account.plan}</p>
              ) : null}
            </div>
          ) : null}
          {busy && !data ? (
            <p role="status" className="text-sm text-muted-foreground">{t`Checking quota…`}</p>
          ) : error ? (
            <p
              role="status"
              className="text-sm text-muted-foreground"
            >{t`Could not refresh quota. Try again.`}</p>
          ) : !account ? (
            <p className="text-sm text-muted-foreground">{t`Connect a model account to see its subscription quota.`}</p>
          ) : account.status !== "available" ? (
            <p role="status" className="text-sm leading-relaxed text-muted-foreground">
              {account.status === "reconnect"
                ? t`Reconnect this account in model settings.`
                : account.status === "unsupported"
                  ? t`This connection does not report subscription quota.`
                  : account.status === "rate_limited"
                    ? t`The provider has paused quota checks. Try again later.`
                    : t`Quota is temporarily unavailable.`}
            </p>
          ) : (
            <div className="space-y-4">
              {account.windows.map((window) => {
                const fresh = freshQuota(account, now) && usableWindow(window, now);
                const value = remainingQuota(window);
                const label =
                  window.durationMinutes === 300
                    ? t`5 hours`
                    : window.durationMinutes === 10080
                      ? t`Weekly`
                      : window.label === "Session"
                        ? t`Session`
                        : window.label;
                const date = window.resetsAt ? new Date(window.resetsAt) : null;
                const minutes = date ? Math.max(0, Math.ceil((date.getTime() - now) / 60000)) : 0;
                const relative =
                  minutes >= 60
                    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
                    : `${minutes} min`;
                return (
                  <div key={window.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {window.model ? `${window.model} · ` : ""}
                        {label}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {fresh ? t`${Math.round(value)}% remaining` : t`Awaiting refresh`}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${window.model ?? name} · ${label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={fresh ? Math.round(value) : undefined}
                      aria-valuetext={
                        fresh ? t`${Math.round(value)}% remaining` : t`Awaiting refresh`
                      }
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        style={{
                          width: fresh ? `${value}%` : "0%",
                          backgroundColor: quotaColor(value),
                        }}
                        className="h-full rounded-full"
                      />
                    </div>
                    {date ? (
                      <p
                        title={new Intl.DateTimeFormat(i18n.locale, {
                          dateStyle: "full",
                          timeStyle: "short",
                        }).format(date)}
                        className="text-xs text-muted-foreground"
                      >
                        {date.getTime() <= now
                          ? t`Waiting for the provider to report the reset.`
                          : t`Resets in ${relative}`}{" "}
                        <span>
                          ·{" "}
                          {new Intl.DateTimeFormat(i18n.locale, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(date)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {account?.measuredAt && !error ? (
            <p className="text-[11px] text-muted-foreground">
              {t`Updated`}{" "}
              {new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
                new Date(account.measuredAt),
              )}
            </p>
          ) : null}
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
