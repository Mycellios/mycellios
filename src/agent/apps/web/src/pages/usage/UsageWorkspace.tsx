import { useLingui } from "@lingui/react/macro";
import { TOKENS_PER_TRIAL_SPORE, type Bot, type Space, type UsageDashboard, type UsageDashboardTotals } from "@rakazo/contracts";
import { useQuery } from "@tanstack/react-query";
import { NativeSelectOption, NativeSelect,
  BotAvatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  ArrowLeft,
  ArrowRight,
  Bot as BotIcon,
  ChevronsUpDown,
  RefreshCw,
  Terminal,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../../lib/desktop";
import { localTimezone } from "../../lib/local-timezone";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { dateInZone, shiftDay } from "../schedule/calendar-dates";
import { UsageChart } from "./UsageChart";
import { providerColor, providerName, type UsageMetric, usageDayStart } from "./usage-chart";
import "../tasks/tasks.css";
import "./usage.css";

type Breakdown = "model" | "agent" | "day";
type Filter = { bot: string; metric: UsageMetric; period: 7 | 30 | 90 | 365 };
function ProviderMark({ provider }: { provider: string }) {
  const Icon = /codex|claude|cli/.test(provider) ? Terminal : BotIcon;
  return <Icon size={16} strokeWidth={1.6} aria-hidden="true" />;
}

export function UsageWorkspace({
  client,
  scope,
  bots,
  spaces,
  spaceId,
  initialBotId,
  onSpace,
  onExit,
  onPreferences,
}: {
  client: RpcClient;
  scope: string;
  bots: Bot[];
  spaces: Space[];
  spaceId: string | null;
  initialBotId?: string;
  onSpace: (id: string, path: string) => void;
  onExit: () => void;
  onPreferences: () => void;
}) {
  const { t, i18n } = useLingui(),
    locale = i18n.locale || "en",
    zone = localTimezone();
  const key = `mycellios:usage:${scope}`;
  const rewards = useQuery({
    queryKey: ["spore-rewards", scope],
    queryFn: ({ signal }) => client.usage.sporeRewards(undefined, { signal }),
    refetchInterval: 60_000,
  });
  const [filter, setFilter] = useState<Filter>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved &&
        typeof saved.bot === "string" &&
        ["cost", "tokens"].includes(saved.metric) &&
        [7, 30, 90, 365].includes(saved.period)
      )
        return { ...saved, bot: initialBotId ?? saved.bot };
    } catch {
      /* Start with the complete 30-day report. */
    }
    return { bot: initialBotId ?? "all", metric: "cost", period: 30 };
  });
  const [report, setReport] = useState<UsageDashboard | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, refresh] = useState(0);
  const [agents, setAgents] = useState<UsageDashboard["agents"]>(() =>
    bots.map((bot) => ({ id: bot.id, name: bot.name, archived: false, deleted: false })),
  );
  const [breakdown, setBreakdown] = useState<Breakdown>("agent");
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (initialBotId) return;
    try {
      localStorage.setItem(key, JSON.stringify(filter));
    } catch {
      /* Filters still work without browser storage. */
    }
  }, [filter, initialBotId, key]);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    setReport(null);
    setLoading(true);
    setError("");
    async function load() {
      const today = dateInZone(new Date(), zone);
      try {
        const result = await client.usage.dashboard({
          from: usageDayStart(shiftDay(today, 1 - filter.period), zone).toISOString(),
          to: usageDayStart(shiftDay(today, 1), zone).toISOString(),
          timeZone: zone,
          ...(filter.bot === "all"
            ? {}
            : { botId: filter.bot === "unassigned" ? null : filter.bot }),
        });
        if (!live) return;
        setReport(result);
        setAgents(result.agents);
        setLoading(false);
        setError("");
        timer = setTimeout(load, 15_000);
      } catch (cause) {
        if (live) {
          setError(errorText(cause));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, zone, filter.bot, filter.period, revision]);
  const compact = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(
          value,
        );
  const exact = (value: number | null) =>
    value === null ? t`Unavailable` : new Intl.NumberFormat(locale).format(value);
  const preciseMoney = (value: number | null) =>
    value === null
      ? t`Unavailable`
      : `${value > 0 && value < 1e-12 ? "<" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(value > 0 && value < 1e-12 ? 1e-12 : value)} USD`;
  const money = (value: number | null) =>
    value === null
      ? "—"
      : value > 0 && value < 1e-12
        ? `<${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 12 }).format(1e-12)}`
        : new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits:
              value > 0 && value < 0.01 ? Math.min(12, -Math.floor(Math.log10(value)) + 1) : 2,
          }).format(value);
  const date = (
    value: string,
    options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  ) => new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }).format(new Date(value));
  const totals = report?.totals;
  const partial = Boolean(
    totals &&
      (totals.pricedCalls < totals.calls ||
        totals.incompleteCalls ||
        report?.missingRuns ||
        report?.activeRuns ||
        totals.pendingCalls),
  );
  const knownCost = (value: UsageDashboardTotals) =>
    value.costUsd ?? (value.pricedCalls > 0 ? value.knownUsd : null);
  const knownTokens = (value: UsageDashboardTotals) =>
    value.tokens ?? (value.knownTokens > 0 ? value.knownTokens : null);
  const share = (value: UsageDashboardTotals) => {
    if (!totals) return "—";
    const amount = filter.metric === "cost" ? knownCost(value) : knownTokens(value),
      total = filter.metric === "cost" ? totals.knownUsd : totals.knownTokens;
    return amount === null
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(total > 0 ? amount / total : 0);
  };
  const sortValue = (value: UsageDashboardTotals) =>
    (filter.metric === "cost" ? knownCost(value) : knownTokens(value)) ?? -1;
  const rows = report
    ? [
        ...(breakdown === "agent"
          ? report.byAgent
          : breakdown === "model"
            ? report.byModel
            : report.daily),
      ].sort((a, b) =>
        breakdown === "day" ? b.id.localeCompare(a.id) : sortValue(b) - sortValue(a),
      )
    : [];
  function showDaily() {
    setBreakdown("day");
    requestAnimationFrame(() => {
      table.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
      table.current?.focus({ preventScroll: true });
    });
  }
  return (
    <section className="rk-usage-workspace" data-testid="usage-workspace" aria-label={t`Usage`}>
      <header
        className={`rk-usage-header ${desktopBridge() ? "app-drag" : ""}`}
        data-testid="conversation-header"
        style={
          desktopBridge() && desktopBridge()?.platform !== "win32"
            ? { paddingInlineStart: 48 }
            : undefined
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="app-no-drag rk-usage-space"
            aria-label={t`Switch workspace`}
          >
            <span>{spaces.find((space) => space.id === spaceId)?.name ?? "Mycellios"}</span>
            <ChevronsUpDown size={11} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                onClick={() =>
                  onSpace(
                    space.id,
                    space.bots[0] ? `/app/${space.bots[0].id}?view=usage` : "/onboarding",
                  )
                }
              >
                {space.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="app-no-drag"
          size="icon-sm"
          variant="ghost"
          aria-label={t`Back to chat`}
          onClick={onExit}
        >
          <ArrowLeft size={15} />
        </Button>
        <Button
          className="app-no-drag"
          size="icon-sm"
          variant="ghost"
          data-usage-forward
          aria-label={t`Forward`}
          disabled
        >
          <ArrowRight size={15} />
        </Button>
        <span className="rk-usage-divider" />
        <h1>{t`Usage`}</h1>
        <div className="app-no-drag rk-usage-filters">
          <label>
            <span className="sr-only">{t`Included Micos`}</span>
            <NativeSelect
              aria-label={t`Included Micos`}
              value={filter.bot}
              onChange={(event) =>
                setFilter((current) => ({ ...current, bot: event.target.value }))
              }
            >
              <NativeSelectOption value="all">{t`All agents`}</NativeSelectOption>
              {agents.map((bot) => (
                <NativeSelectOption key={bot.id ?? "unassigned"} value={bot.id ?? "unassigned"}>
                  {bot.name ??
                    (bot.id === null
                      ? t`Unassigned usage`
                      : bot.deleted
                        ? t`Deleted Mico`
                        : t`Unknown Mico`)}
                  {bot.archived ? ` · ${t`Archived`}` : bot.deleted ? ` · ${t`Deleted`}` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span className="sr-only">{t`Usage metric`}</span>
            <NativeSelect
              aria-label={t`Usage metric`}
              value={filter.metric}
              onChange={(event) =>
                setFilter((current) => ({ ...current, metric: event.target.value as UsageMetric }))
              }
            >
              <NativeSelectOption value="cost">{t`Cost`}</NativeSelectOption>
              <NativeSelectOption value="tokens">{t`Tokens`}</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            <span className="sr-only">{t`Usage period`}</span>
            <NativeSelect
              aria-label={t`Usage period`}
              value={filter.period}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  period: Number(event.target.value) as Filter["period"],
                }))
              }
            >
              {([7, 30, 90, 365] as const).map((days) => (
                <NativeSelectOption key={days} value={days}>
                  {days === 365 ? t`1 year` : t`${days} days`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Refresh usage`}
            disabled={loading}
            onClick={() => {
              refresh((value) => value + 1);
              void rewards.refetch();
            }}
          >
            <RefreshCw
              size={15}
              className={loading ? "animate-spin motion-reduce:animate-none" : ""}
            />
          </Button>
        </div>
      </header>
      <div className="rk-usage-content rk-scroll">
        <section className="mb-4 space-y-2 rounded-xl border border-border bg-card p-4" aria-label={t`Trial Spore`}>
          <h2 className="text-sm font-semibold">{t`Trial Spore`}</h2>
          {rewards.data ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">{exact(rewards.data.welcome + rewards.data.earned)} Spore</p>
              <p className="text-sm text-muted-foreground">
                {t`${exact(rewards.data.welcome)} welcome Spore · ${exact(rewards.data.earned)} earned from usage`}
              </p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {t`${exact(rewards.data.progressTokens)} / ${exact(TOKENS_PER_TRIAL_SPORE)} tokens toward the next Spore`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              {rewards.isError ? t`Could not load Spore rewards.` : t`Loading Spore rewards…`}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t`Earn 1 Spore for every million tokens processed.`}</p>
          <p className="text-sm text-muted-foreground">{t`Across all your spaces. Trial rewards have no monetary value and are not on-chain.`}</p>
        </section>
        {error ? (
          <p className="rk-usage-notice text-destructive" role="alert">
            {t`Could not load usage data.`} {error}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => refresh((value) => value + 1)}
            >{t`Retry`}</Button>
          </p>
        ) : null}
        {loading ? (
          <p className="rk-usage-loading" role="status">{t`Loading usage data…`}</p>
        ) : null}
        {report && totals ? (
          <>
            {!totals.calls && !report.missingRuns ? (
              <p
                className="rk-usage-notice"
                role="status"
              >{t`No usage was recorded in this period.`}</p>
            ) : null}
            {partial || totals.pendingCalls || report.activeRuns ? (
              <p className="rk-usage-notice" role="status">
                {t`Partial data: ${totals.calls - totals.pricedCalls} unpriced calls, ${totals.incompleteCalls} incomplete token records, ${report.missingRuns} runs without usage.`}
                {totals.pendingCalls || report.activeRuns
                  ? ` ${t`Some costs are still pending.`}`
                  : ""}
              </p>
            ) : null}
            <div className="rk-usage-overview">
              <section className="rk-usage-summary" aria-label={t`Usage summary`}>
                <div>
                  <p
                    className="rk-usage-hero"
                    data-testid="usage-hero"
                    style={
                      {
                        "--rk-usage-hero-size": `${Math.min(56, 520 / Math.max(1, (filter.metric === "cost" ? money(knownCost(totals)) : compact(knownTokens(totals))).length))}px`,
                      } as CSSProperties
                    }
                    title={
                      filter.metric === "cost"
                        ? `${knownCost(totals) ?? t`Unavailable`} USD`
                        : exact(knownTokens(totals))
                    }
                  >
                    {filter.metric === "cost"
                      ? money(knownCost(totals))
                      : compact(knownTokens(totals))}
                  </p>
                  <p className="rk-usage-secondary">
                    {report.sessions === 1 ? t`1 session` : t`${report.sessions} sessions`} ·{" "}
                    {filter.metric === "tokens"
                      ? t`Known tokens excluding cache reads`
                      : totals.estimatedCalls
                        ? totals.estimatedCalls === totals.pricedCalls
                          ? t`API estimate · USD`
                          : t`Recorded and estimated cost · USD`
                        : t`Recorded cost · USD`}
                    {partial ? ` · ${t`Partial`}` : ""}
                  </p>
                </div>
                <div className="rk-usage-providers">
                  {[...report.byProvider]
                    .sort((a, b) => sortValue(b) - sortValue(a))
                    .map((provider) => (
                      <div key={provider.id} className="rk-usage-provider">
                        <div>
                          <span>
                            <i style={{ background: providerColor(provider.id) }} />
                            <ProviderMark provider={provider.id} />
                            {providerName(provider.id)}
                          </span>
                          <strong>
                            {filter.metric === "cost"
                              ? money(knownCost(provider))
                              : compact(knownTokens(provider))}
                          </strong>
                        </div>
                        <p>
                          {filter.metric === "cost"
                            ? t`${share(provider)} of known cost`
                            : t`${share(provider)} of known tokens`}{" "}
                          ·{" "}
                          {filter.metric === "cost"
                            ? t`${compact(knownTokens(provider))} tokens`
                            : money(knownCost(provider))}
                        </p>
                      </div>
                    ))}
                </div>
              </section>
              <section className="rk-usage-trend" aria-label={t`Daily trend`}>
                <div className="rk-usage-section-heading">
                  <h2>{filter.metric === "cost" ? t`Daily cost` : t`Daily tokens`}</h2>
                  <button type="button" onClick={showDaily}>{t`View daily data`}</button>
                </div>
                <UsageChart
                  report={report}
                  metric={filter.metric}
                  money={money}
                  preciseMoney={preciseMoney}
                  compact={compact}
                />
              </section>
            </div>
            <section aria-label={t`Totals`} className="rk-usage-total-section">
              <h2>{t`Totals`}</h2>
              <dl className="rk-usage-totals">
                {[
                  { name: t`Tokens excluding cache reads`, value: totals.tokens },
                  { name: t`Tokens processed including cache reads`, value: totals.processed },
                  { name: t`Cached input`, value: totals.cacheRead },
                  { name: t`Uncached input`, value: totals.input },
                  { name: t`Cache creation`, value: totals.cacheWrite },
                  { name: t`Output`, value: totals.output },
                  { name: t`User messages`, value: report.userMessages },
                  { name: t`Assistant messages`, value: report.assistantMessages },
                ].map((stat) => (
                  <div key={stat.name}>
                    <dt>{stat.name}</dt>
                    <dd title={exact(stat.value)}>{compact(stat.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rk-usage-breakdown" aria-label={t`Usage breakdown`}>
              <div className="rk-usage-section-heading">
                <h2>{t`Breakdown`}</h2>
                <fieldset className="rk-usage-tabs" aria-label={t`Usage breakdown`}>
                  {(["model", "agent", "day"] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      aria-pressed={breakdown === mode}
                      onClick={() => setBreakdown(mode)}
                    >
                      {mode === "model" ? t`Model` : mode === "agent" ? t`Agent` : t`Day`}
                    </button>
                  ))}
                </fieldset>
              </div>
              <div className="rk-usage-table-wrap">
                <table ref={table} tabIndex={-1} data-testid="usage-breakdown-table">
                  <caption className="sr-only">
                    {breakdown === "day"
                      ? t`Daily usage data`
                      : breakdown === "model"
                        ? t`Usage by model`
                        : t`Usage by agent`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        {breakdown === "day"
                          ? t`Date`
                          : breakdown === "model"
                            ? t`Model`
                            : t`Agent`}
                      </th>
                      <th scope="col">{breakdown === "day" ? t`Cost · USD` : t`Cost`}</th>
                      {breakdown !== "day" ? <th scope="col">{t`Share`}</th> : null}
                      <th scope="col">{t`Tokens`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">
                          {breakdown === "model" && "provider" in row ? (
                            <span className="rk-usage-row-name">
                              <ProviderMark provider={row.provider as string} />
                              <span title={providerName(row.provider as string)}>
                                {row.name || t`Unknown model`}
                              </span>
                            </span>
                          ) : breakdown === "day" ? (
                            row.id
                          ) : (
                            <span className="rk-usage-row-name">
                              <BotAvatar
                                identity={String(
                                  "botId" in row ? (row.botId ?? "unassigned") : row.id,
                                )}
                                color={
                                  bots.find((bot) => bot.id === ("botId" in row ? row.botId : null))
                                    ?.color ?? "#9B5CF6"
                                }
                                size={16}
                              />
                              <span>
                                {row.name ||
                                  ("botId" in row && row.botId !== null
                                    ? t`Unknown Mico`
                                    : t`Unassigned usage`)}
                              </span>
                            </span>
                          )}
                        </th>
                        <td title={`${row.knownUsd} USD`}>
                          {breakdown === "day"
                            ? preciseMoney(knownCost(row))
                            : money(knownCost(row))}
                          {row.costUsd === null && row.pricedCalls > 0 ? " *" : ""}
                        </td>
                        {breakdown !== "day" ? <td>{share(row)}</td> : null}
                        <td title={exact(knownTokens(row))}>
                          {breakdown === "day"
                            ? exact(knownTokens(row))
                            : compact(knownTokens(row))}
                          {row.tokens === null && row.knownTokens > 0 ? " *" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length ? (
                <p className="rk-usage-secondary">{t`No usage was recorded in this period.`}</p>
              ) : null}
            </section>
            <footer className="rk-usage-footer">
              <p>
                {report.collectionStartedAt
                  ? t`Collection started ${date(report.collectionStartedAt)} · Updated ${date(report.updatedAt)}`
                  : t`Updated ${date(report.updatedAt)}`}{" "}
                · {zone}
              </p>
              <details>
                <summary>{t`About these figures`}</summary>
                <p>
                  {t`Confirmed charges`}: {money(totals.confirmedUsd)} · {t`API estimates`}:{" "}
                  {money(totals.estimatedUsd)}
                </p>
                {report.unmappedCalls ? (
                  <p>{t`${report.unmappedCalls} calls have no stored conversation link. Session counts may be incomplete.`}</p>
                ) : null}
                <p>{t`Each model call is counted once. Recorded charges and API estimates are separate from your credit balance and subscriptions. Unknown prices and incomplete token counts stay unavailable; shares use known amounts only. Gas, tools and other external services are excluded.`}</p>
                <p>{t`Tokens exclude cache reads. Processed tokens include them. Cache creation includes its one-hour subset once, and reasoning tokens are already part of output. Sessions count distinct stored conversations; deleted run links can make that count incomplete.`}</p>
                <p>{t`Daily records follow the time zone shown here. Missing model usage leaves gaps in the chart instead of a zero.`}</p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onPreferences}
                >{t`Usage preferences`}</Button>
              </details>
            </footer>
          </>
        ) : null}
      </div>
    </section>
  );
}
