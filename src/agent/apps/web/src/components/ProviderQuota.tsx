import { useLingui } from "@lingui/react/macro";
import type { AccountPlanLimit, AccountPlanLimits, PlanLimitWindow } from "@mycellios/contracts";
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@mycellios/ui-web";
import { ChevronDown, Gauge } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderLogo } from "./ProviderLogo";
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

/** How long a Mico switch reuses the account quotas instead of reading them again. */
const PLAN_REUSE_MS = 60_000;

export function ProviderQuota(props: {
  scope: string;
  /** The open Mico: when it runs on This PC, its PC's Codex usage shows instead of the server's. */
  botId?: string;
  onModels: () => void;
  onUsage: () => void;
  compact?: boolean;
}) {
  return <QuotaContent key={props.scope} {...props} />;
}
function QuotaContent({
  scope,
  botId,
  onModels,
  onUsage,
  compact = true,
}: {
  scope: string;
  botId?: string;
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
  // Account quotas do not depend on the open Mico; only its PC's Codex reading does.
  const plan = useRef<{ value: AccountPlanLimits; at: number } | null>(null);
  const load = useCallback(
    async (refresh = false, reusePlan = false) => {
      if (loading.current && !controller.current?.signal.aborted) return;
      loading.current = true;
      setBusy(true);
      const abort = new AbortController();
      controller.current = abort;
      try {
        const saved = plan.current;
        const [value, native] = await Promise.all([
          reusePlan && !refresh && saved && Date.now() - saved.at < PLAN_REUSE_MS
            ? saved.value
            : rpc.models.planLimits({ refresh }, { signal: abort.signal }).then((next) => {
                plan.current = { value: next, at: Date.now() };
                return next;
              }),
          rpc.engines.codexQuota(botId ? { botId } : undefined, { signal: abort.signal }).catch(() => null),
        ]);
        if (alive.current && !abort.signal.aborted) {
          setData(native ? { ...value, accounts: [...value.accounts, native] } : value);
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
    [rpc, botId],
  );
  useEffect(() => {
    alive.current = true;
    // Switching Micos only rereads that Mico's PC; the account quotas refresh on their timer.
    void load(false, true);
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
  const accounts = data?.accounts.filter((row) => row.status !== "unsupported") ?? [];
  const account =
    accounts.find((row) => row.credentialId === preferences.accountId) ??
    accounts.find((row) => ringWindows(row, now).length > 0) ??
    accounts[0];
  const windows = !error ? ringWindows(account, now) : [];
  const remaining = windows.length ? Math.min(...windows.map(remainingQuota)) : null;
  const rings = compact && !error ? railRings(accounts, now) : null;
  const name = account ? providerName(account.provider) : t`Model accounts`;
  const summary =
    remaining === null ? t`Quota unavailable` : t`${Math.round(remaining)}% remaining`;
  const action = (callback: () => void) => {
    setOpen(false);
    callback();
  };
  const openSummary = () => {
    setOpen(true);
    void load();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value, details) => {
        // The rail button navigates on activation. Only the preview uses the popover.
        if (compact && details.reason === "trigger-press") {
          details.cancel();
          return;
        }
        if (value) openSummary();
        else setOpen(false);
      }}
    >
      <PopoverTrigger
        data-testid="provider-quota-trigger"
        openOnHover={compact}
        onClick={compact ? () => action(onUsage) : undefined}
        onKeyDown={compact ? (event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openSummary();
        } : undefined}
        aria-keyshortcuts={compact ? "ArrowDown" : undefined}
        aria-label={compact ? t`Usage` : `${t`Subscription quota`}: ${name} · ${summary}`}
        title={compact ? undefined : `${name} · ${summary}`}
        className={`app-no-drag relative flex shrink-0 items-center rounded-lg outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${compact ? "min-h-10 w-10 flex-col justify-center gap-1 py-[3px]" : "mx-3 gap-2 px-2 py-1.5 text-sm"}`}
      >
        {rings?.shown.length ? (
          <>
            {rings.shown.map((row) => (
              <QuotaRing key={row.credentialId} account={row} windows={ringWindows(row, now)} />
            ))}
            {rings.more ? (
              <span data-testid="provider-quota-more" className="grid size-[34px] place-items-center rounded-full border-2 border-foreground/12 text-[11px] font-semibold tabular-nums text-muted-foreground">
                +{rings.more}
              </span>
            ) : null}
          </>
        ) : (
          <QuotaRing account={account} windows={windows} />
        )}
        {!compact ? (
          <>
            <span className="flex-1 text-start">{t`Subscription quota`}</span>
            <ChevronDown size={13} />
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side={compact ? "inline-end" : "top"}
        align="end"
        sideOffset={8}
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        className="app-no-drag max-h-[calc(100dvh-24px)] w-[340px] max-w-[calc(100vw-24px)] gap-0 overflow-y-auto rounded-xl border-0 bg-sidebar p-3 shadow-none ring-0 dark:bg-[#222222]"
        data-testid="provider-quota-panel"
      >
        <PopoverTitle className="mb-2 flex items-center gap-2 text-xs font-semibold leading-4">
          <Gauge size={14} aria-hidden="true" />{t`Usage`}
        </PopoverTitle>
        <div className="space-y-3">
          {busy && !data ? (
            <p role="status" className="text-xs text-muted-foreground">{t`Checking quota…`}</p>
          ) : error ? (
            <p role="status" className="text-xs text-muted-foreground">{t`Could not refresh quota. Try again.`}</p>
          ) : !accounts.length ? (
            <p className="text-xs text-muted-foreground">
              {data?.accounts.length
                ? t`This connection does not report subscription quota.`
                : t`Connect a model account to see its subscription quota.`}
            </p>
          ) : (
            accounts.map((row) => {
              const provider = providerName(row.provider);
              return (
                <section key={row.credentialId} className="space-y-1">
                  <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold leading-4">
                    <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_span]:size-4 [&_svg]:size-4">
                      <ProviderLogo name={provider} providerId={row.provider} />
                    </span>
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
                    <ul className="space-y-1.5 pl-6">
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
                              className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-foreground/15"
                            >
                              {fresh ? <div style={{ width: `${value}%`, backgroundColor: value < 30 ? quotaColor(value) : "var(--foreground)" }} className="h-full rounded-full" /> : null}
                            </div>
                            {fresh ? <span className="shrink-0 font-semibold text-foreground">{t`${Math.round(value)}% remaining`}</span> : <span>{t`Awaiting refresh`}</span>}
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
        {(error || (!busy && !accounts.length)) ? (
          <Button variant="link" className="mt-2 h-auto justify-start p-0 text-xs" disabled={busy}
            onClick={() => error ? void load(true) : action(onModels)}>
            {error ? t`Retry` : t`Manage model accounts`}
          </Button>
        ) : accounts.some((row) => row.status !== "available") ? (
          <Button variant="link" className="mt-2 h-auto justify-start p-0 text-xs" onClick={() => action(onModels)}>
            {t`Manage model accounts`}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const RAIL_RING_LIMIT = 4;

/**
 * The rail shows one ring per account that can report quota. An account without a fresh
 * measurement keeps an empty ring, so it never vanishes and reappears between readings. When
 * they do not fit, the accounts with the least left stay, in their order, and a "+N" mark counts
 * the rest.
 */
export function railRings(accounts: AccountPlanLimit[], now: number) {
  if (accounts.length <= RAIL_RING_LIMIT) return { shown: accounts, more: 0 };
  const left = (row: AccountPlanLimit) => {
    const windows = ringWindows(row, now);
    return windows.length ? Math.min(...windows.map(remainingQuota)) : Number.POSITIVE_INFINITY;
  };
  const kept = new Set([...accounts].sort((a, b) => left(a) - left(b)).slice(0, RAIL_RING_LIMIT - 1));
  return { shown: accounts.filter((row) => kept.has(row)), more: accounts.length - kept.size };
}

function QuotaRing({ account, windows }: { account: AccountPlanLimit | undefined; windows: PlanLimitWindow[] }) {
  return (
    <span data-testid="provider-quota-ring" className="relative grid size-[34px] shrink-0 place-items-center">
      <svg className="absolute inset-0" viewBox="0 0 34 34" aria-hidden="true">
        {(windows.length ? windows : [null]).map((window, index) => {
          const radius = 15.5 - index * 4;
          const perimeter = 2 * Math.PI * radius;
          return (
            <g key={window?.id ?? "unknown"}>
              <circle cx="17" cy="17" r={radius} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="2" />
              {window ? (
                <circle
                  cx="17"
                  cy="17"
                  r={radius}
                  fill="none"
                  stroke={remainingQuota(window) >= 30 ? "#22c55e" : quotaColor(remainingQuota(window))}
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
      {account ? (
        <span className="grid size-3.5 place-items-center [&_img]:size-3.5 [&_span]:size-3.5 [&_svg]:size-3.5">
          <ProviderLogo name={providerName(account.provider)} providerId={account.provider} />
        </span>
      ) : (
        <Gauge size={15} className="text-muted-foreground" />
      )}
    </span>
  );
}
