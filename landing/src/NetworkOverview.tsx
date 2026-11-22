import { ArrowRight, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  deviceRows,
  isKnownWorkerKind,
  modelDisplayName,
  hourlyTasks,
  modelRows,
  onlineGpuCapacity,
  type DeviceRow,
  type HourlyActivity,
  type ModelServiceState,
  type StatsHistorySample,
  type StatsSnapshot,
} from "./overview-stats";
import { formatMemory, shortId } from "./panel-ui-utilities";
import { usePanelI18n, type PanelLocale, type PanelTranslate } from "./i18n/panel-i18n";
import {
  Badge as UiBadge,
  Button as UiButton,
  Card as UiCard,
  Heading as UiHeading,
  Table as UiTable,
  TableBody as UiTableBody,
  TableCell as UiTableCell,
  TableHead as UiTableHead,
  TableHeader as UiTableHeader,
  TableRow as UiTableRow,
  Text as UiText,
} from "./ui/primitives";

export type OverviewSnapshot = StatsSnapshot & { capturedAt: string };
type Evidence = "waiting" | "fresh" | "delayed" | "stale" | "degraded";

const NEVER = new Date(0).toISOString();
const intlLocale = (locale: PanelLocale) => locale === "es" ? "es-ES" : "en-US";
const numberFormats = { es: new Intl.NumberFormat("es-ES"), en: new Intl.NumberFormat("en-US") };
const hourFormats = {
  es: new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }),
  en: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }),
};
type OverviewText = { t: PanelTranslate; locale: PanelLocale; number: (value: number) => string; hour: (value: number) => string };

function overviewText(t: PanelTranslate, locale: PanelLocale): OverviewText {
  return { t, locale, number: (value) => numberFormats[locale].format(value), hour: (value) => hourFormats[locale].format(value) };
}

/** Number and hour formatting plus messages in the panel's language. */
function useOverviewText(): OverviewText {
  const { t, locale } = usePanelI18n();
  return overviewText(t, locale);
}

export async function loadDayHistory(): Promise<StatsHistorySample[]> {
  const response = await fetch("/public/v1/history?range=24h", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { samples?: StatsHistorySample[] };
  return Array.isArray(body.samples) ? body.samples : [];
}

function evidenceFor(capturedAt: string, connectionError: string | null, now: number, t: PanelTranslate, locale: PanelLocale): { state: Evidence; text: string } {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured) || capturedAt === NEVER) return { state: "waiting", text: t("overview.evidence.waiting") };
  if (connectionError) return { state: "degraded", text: t("overview.evidence.degraded", { since: sinceText(captured, now, t, locale) }) };
  const age = now - captured;
  if (age <= 10_000) return { state: "fresh", text: t("overview.evidence.fresh") };
  return { state: age <= 30_000 ? "delayed" : "stale", text: t("overview.evidence.old", { since: sinceText(captured, now, t, locale) }) };
}

/** "3 min ago" / "hace 3 min", or a date beyond a month. */
export function sinceText(timestamp: number, now: number, t: PanelTranslate, locale: PanelLocale): string {
  if (!Number.isFinite(timestamp)) return t("overview.since.unknown");
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 10) return t("overview.since.now");
  if (seconds < 60) return t("overview.since.seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("overview.since.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("overview.since.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? t("overview.since.day") : t("overview.since.days", { count: days });
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

const STATE_TONES: Record<ModelServiceState, "success" | "warning" | "neutral" | "danger"> = {
  serving: "success",
  preparing: "neutral",
  no_capacity: "warning",
  unavailable: "danger",
};

export function Overview({ snapshot, connectionError, onAddDevice, loadHistory = loadDayHistory, now: fixedNow }: {
  snapshot: OverviewSnapshot;
  connectionError: string | null;
  onAddDevice: () => void;
  loadHistory?: () => Promise<StatsHistorySample[]>;
  /** Fixed clock for stories and tests; live pages use the current time. */
  now?: number;
}) {
  const text = useOverviewText();
  const { t, locale, number } = text;
  const now = fixedNow ?? Date.now();
  const evidence = evidenceFor(snapshot.capturedAt, connectionError, now, t, locale);
  const [history, setHistory] = useState<StatsHistorySample[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = (silent: boolean) => {
      if (!silent) setHistoryError(false);
      void loadHistory().then((samples) => { if (active) { setHistory(samples); setHistoryError(false); } })
        .catch(() => { if (active && !silent) setHistoryError(true); });
    };
    load(false);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadHistory, attempt]);

  const models = useMemo(() => modelRows(snapshot), [snapshot]);
  const devices = useMemo(() => deviceRows(snapshot.workers), [snapshot.workers]);
  const gpu = useMemo(() => onlineGpuCapacity(snapshot.workers), [snapshot.workers]);
  const activity = useMemo(() => history ? hourlyTasks(history, now) : null, [history, now]);
  const serving = models.filter((model) => model.state === "serving").length;
  const preparing = models.filter((model) => model.state === "preparing").length;

  return <section className="overview-page overview-stats" aria-labelledby="overview-stats-title">
    <header className="overview-heading">
      <div>
        <UiHeading as="h1" id="overview-stats-title">{t("overview.title")}</UiHeading>
        <span className={`overview-status ${evidence.state}`} role="status"><i />{evidence.text}</span>
      </div>
      <UiButton variant="ghost" className="overview-add-device" onClick={onAddDevice}>{t("overview.addDevice")} <ArrowRight size={15} aria-hidden="true" /></UiButton>
    </header>
    {evidence.state === "waiting" ? <UiCard className="overview-no-evidence"><CircleAlert aria-hidden="true" /><div><UiHeading as="h2">{t("overview.waiting.title")}</UiHeading><UiText>{t("overview.waiting.copy")}</UiText></div></UiCard> : <>
      <dl className="overview-kpis" aria-label={t("overview.kpis")}>
        <div>
          <dt>{t("overview.kpi.online")}</dt>
          <dd className="overview-kpi-value">{number(snapshot.summary.online)} <small>{t("overview.kpi.onlineOf", { count: number(snapshot.summary.registered) })}</small></dd>
          <dd className="overview-kpi-hint">{t("overview.kpi.onlineHint")}</dd>
        </div>
        <div>
          <dt>{t("overview.kpi.gpu")}</dt>
          <dd className="overview-kpi-value">{gpu.gpus > 0 ? formatMemory(gpu.sharedMb) : t("overview.kpi.gpuNone")}</dd>
          <dd className="overview-kpi-hint">{gpu.gpus === 0 ? t("overview.kpi.gpuEmpty") : gpu.gpus === 1 ? t("overview.kpi.gpuOne") : t("overview.kpi.gpuMany", { count: number(gpu.gpus) })}</dd>
        </div>
        <div>
          <dt>{t("overview.kpi.models")}</dt>
          <dd className="overview-kpi-value">{number(serving)}</dd>
          <dd className="overview-kpi-hint">{preparing > 0 ? t("overview.kpi.modelsPreparing", { count: number(preparing) }) : t("overview.kpi.modelsReady")}</dd>
        </div>
        <div>
          <dt>{t("overview.kpi.completed")}</dt>
          <dd className="overview-kpi-value">{number(snapshot.summary.completedJobs)}</dd>
          <dd className="overview-kpi-hint">{completedHint(activity, text)}</dd>
        </div>
      </dl>
      <ActivityCard activity={activity} error={historyError} onRetry={() => setAttempt((value) => value + 1)} />
      <ModelsCard models={models} />
      <DevicesCard devices={devices} now={now} />
    </>}
  </section>;
}

function completedHint(activity: HourlyActivity | null, { t, number, hour }: OverviewText): string {
  if (!activity || activity.coverageStart === null) return t("overview.kpi.completedTotal");
  const count = number(activity.completed);
  return activity.fullDay
    ? t("overview.kpi.completedDay", { count })
    : t("overview.kpi.completedSince", { count, time: hour(activity.coverageStart) });
}

function ActivityCard({ activity, error, onRetry }: { activity: HourlyActivity | null; error: boolean; onRetry: () => void }) {
  const { t } = usePanelI18n();
  return <UiCard className="overview-card overview-activity">
    <header>
      <UiHeading as="h2">{t("overview.activity.title")}</UiHeading>
      <UiText>{t("overview.activity.copy")}</UiText>
    </header>
    {activity ? <HourlyChart activity={activity} />
      : error ? <div className="overview-card-state" role="alert"><UiText>{t("overview.activity.error")}</UiText><UiButton variant="secondary" size="sm" onClick={onRetry}>{t("overview.activity.retry")}</UiButton></div>
      : <div className="overview-card-state" role="status"><UiText>{t("overview.activity.loading")}</UiText></div>}
  </UiCard>;
}

const CHART = { width: 720, height: 168, top: 12, bottom: 136, left: 4, right: 716 };

function barPath(x: number, width: number, top: number, bottom: number): string {
  const height = bottom - top;
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x} ${bottom}V${top + radius}Q${x} ${top} ${x + radius} ${top}H${x + width - radius}Q${x + width} ${top} ${x + width} ${top + radius}V${bottom}Z`;
}

function failedText(value: number | null, { t, number }: OverviewText): string {
  return value === null ? t("overview.chart.failedUnknown") : t("overview.chart.failedCount", { count: number(value) });
}

/** Plain-language summary of the chart, also used as its accessible name. */
export function activitySummary(activity: HourlyActivity, { t, number, hour }: OverviewText): string {
  const busiest = activity.hours.reduce((best, entry) => entry.completed > best.completed ? entry : best, activity.hours[0]!);
  const completed = activity.completed > 0
    ? t("overview.chart.summary", { count: number(activity.completed), time: hour(busiest.start), busiest: number(busiest.completed) })
    : t("overview.chart.empty");
  const failed = activity.failedCoverageStart === null
    ? t("overview.chart.failedNone")
    : activity.failedFullDay
      ? t("overview.chart.failedDay", { count: number(activity.failed) })
      : t("overview.chart.failedSince", { count: number(activity.failed), time: hour(activity.failedCoverageStart) });
  return `${completed} ${failed}`;
}

export function HourlyChart({ activity }: { activity: HourlyActivity }) {
  const text = useOverviewText();
  const { t, number, hour: hourLabel } = text;
  const [hovered, setHovered] = useState<number | null>(null);
  const tableId = useId();
  const maximum = Math.max(1, ...activity.hours.map((hour) => Math.max(hour.completed, hour.failed ?? 0)));
  const slot = (CHART.right - CHART.left) / activity.hours.length;
  const barWidth = Math.max(2, (slot - 6) / 2);
  const y = (value: number) => CHART.bottom - (value / maximum) * (CHART.bottom - CHART.top);
  const summary = activitySummary(activity, text);
  const tooltip = hovered === null ? null : activity.hours[hovered]!;
  const leave = useCallback(() => setHovered(null), []);
  const failedLegend = activity.failedCoverageStart === null
    ? t("overview.chart.noData")
    : activity.failedFullDay ? number(activity.failed) : t("overview.chart.legendSince", { count: number(activity.failed), time: hourLabel(activity.failedCoverageStart) });
  return <figure className="overview-chart">
    <div className="overview-chart-plot" onMouseLeave={leave}>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={summary} aria-describedby={tableId} preserveAspectRatio="none">
        <line className="overview-chart-baseline" x1={CHART.left} x2={CHART.right} y1={CHART.bottom} y2={CHART.bottom} />
        <line className="overview-chart-grid" x1={CHART.left} x2={CHART.right} y1={CHART.top} y2={CHART.top} />
        {activity.hours.map((hour, index) => {
          const x = CHART.left + index * slot + (slot - barWidth * 2 - 2) / 2;
          const active = hovered === index ? " active" : "";
          return <g key={hour.start}>
            <path className={`overview-chart-bar${active}`} d={barPath(x, barWidth, y(hour.completed), CHART.bottom)} />
            {hour.failed !== null && <path className={`overview-chart-bar failed${active}`} d={barPath(x + barWidth + 2, barWidth, y(hour.failed), CHART.bottom)} />}
            <rect className="overview-chart-hit" x={CHART.left + index * slot} y={0} width={slot} height={CHART.bottom} onMouseEnter={() => setHovered(index)}>
              <title>{t("overview.chart.barDetail", { time: hourLabel(hour.start), completed: number(hour.completed), failed: failedText(hour.failed, text) })}</title>
            </rect>
          </g>;
        })}
      </svg>
      <span className="overview-chart-max" aria-hidden="true">{number(maximum)}</span>
      {tooltip && <span className="overview-chart-tooltip" aria-hidden="true" style={{ left: `${((hovered! + 0.5) / activity.hours.length) * 100}%` }}><strong>{number(tooltip.completed)}</strong> {t("overview.chart.completedWord")} · {tooltip.failed === null ? t("overview.chart.failedUnknown") : <><strong>{number(tooltip.failed)}</strong> {t("overview.chart.failedWord")}</>} · {hourLabel(tooltip.start)}</span>}
    </div>
    <div className="overview-chart-axis" aria-hidden="true">
      {activity.hours.filter((_, index) => index % 6 === 0).map((hour) => <span key={hour.start}>{hourLabel(hour.start)}</span>)}
      <span>{t("overview.chart.now")}</span>
    </div>
    <ul className="overview-chart-legend" aria-hidden="true">
      <li><i className="overview-legend-completed" />{t("overview.chart.legendCompleted")} <strong>{number(activity.completed)}</strong></li>
      <li><i className="overview-legend-failed" />{t("overview.chart.legendFailed")} <strong>{failedLegend}</strong></li>
    </ul>
    <figcaption className="sr-only">{summary}</figcaption>
    <UiTable id={tableId} className="sr-only">
      <UiTableHead><UiTableRow><UiTableHeader>{t("overview.chart.hour")}</UiTableHeader><UiTableHeader>{t("overview.chart.completed")}</UiTableHeader><UiTableHeader>{t("overview.chart.failed")}</UiTableHeader></UiTableRow></UiTableHead>
      <UiTableBody>{activity.hours.map((hour) => <UiTableRow key={hour.start}><UiTableCell>{hourLabel(hour.start)}</UiTableCell><UiTableCell>{number(hour.completed)}</UiTableCell><UiTableCell>{hour.failed === null ? t("overview.chart.noData") : number(hour.failed)}</UiTableCell></UiTableRow>)}</UiTableBody>
    </UiTable>
  </figure>;
}

function ModelsCard({ models }: { models: ReturnType<typeof modelRows> }) {
  const { t, number } = useOverviewText();
  const [showAll, setShowAll] = useState(false);
  const inService = models.filter((model) => model.state === "serving");
  const others = models.length - inService.length;
  const visible = showAll || inService.length === 0 ? models : inService;
  return <UiCard className="overview-card overview-models-card">
    <header>
      <UiHeading as="h2">{t("overview.models.title")}</UiHeading>
      <UiText>{t("overview.models.copy")}</UiText>
    </header>
    {models.length === 0 ? <UiText className="overview-card-state">{t("overview.models.empty")}</UiText> : <>
      <div className="overview-table-scroll" role="region" aria-label={t("overview.models.table")} tabIndex={0}>
        <UiTable className="overview-table">
          <UiTableHead><UiTableRow><UiTableHeader>{t("overview.models.model")}</UiTableHeader><UiTableHeader>{t("overview.models.kind")}</UiTableHeader><UiTableHeader>{t("overview.models.nodes")}</UiTableHeader><UiTableHeader>{t("overview.models.state")}</UiTableHeader><UiTableHeader>{t("overview.models.recent")}</UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visible.map((model) => <UiTableRow key={model.id}>
            <UiTableCell><span className="overview-cell-name"><strong>{modelDisplayName(model.id, (language) => t(`overview.language.${language}`))}</strong><small>{model.id}</small></span></UiTableCell>
            <UiTableCell>{t(`overview.kind.${model.kind}`)}</UiTableCell>
            <UiTableCell className="overview-number" data-label={t("overview.models.nodes")}>{number(model.nodes)}</UiTableCell>
            <UiTableCell><UiBadge tone={STATE_TONES[model.state]}>{t(`overview.state.${model.state}`)}</UiBadge></UiTableCell>
            <UiTableCell className="overview-number" data-label={t("overview.models.recent")}>{number(model.recentTasks)}</UiTableCell>
          </UiTableRow>)}</UiTableBody>
        </UiTable>
      </div>
      <footer>
        <UiText as="small">{t("overview.models.recentNote")}</UiText>
        {others > 0 && inService.length > 0 && <UiButton variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? t("overview.models.showServing") : others === 1 ? t("overview.models.showOthersOne") : t("overview.models.showOthersMany", { count: number(others) })}</UiButton>}
      </footer>
    </>}
  </UiCard>;
}

function DevicesCard({ devices, now }: { devices: DeviceRow[]; now: number }) {
  const { t, locale, number } = useOverviewText();
  const [showAll, setShowAll] = useState(false);
  const online = devices.filter((device) => device.online);
  const offline = devices.length - online.length;
  const visible = showAll || online.length === 0 ? devices : online;
  return <UiCard className="overview-card overview-devices-card">
    <header>
      <UiHeading as="h2">{t("overview.devices.title")}</UiHeading>
      <UiText>{t("overview.devices.copy")}</UiText>
    </header>
    {devices.length === 0 ? <UiText className="overview-card-state">{t("overview.devices.empty")}</UiText> : <>
      <div className="overview-table-scroll" role="region" aria-label={t("overview.devices.table")} tabIndex={0}>
        <UiTable className="overview-table">
          <UiTableHead><UiTableRow><UiTableHeader>{t("overview.devices.device")}</UiTableHeader><UiTableHeader>{t("overview.devices.kind")}</UiTableHeader><UiTableHeader>{t("overview.devices.version")}</UiTableHeader><UiTableHeader>{t("overview.devices.state")}</UiTableHeader><UiTableHeader>{t("overview.devices.lastSeen")}</UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visible.map((device) => <UiTableRow key={device.id}>
            <UiTableCell><span className="overview-cell-name"><strong>{device.hardware ?? t("overview.devices.native")}</strong><small title={device.id}>{shortId(device.id)}</small></span></UiTableCell>
            <UiTableCell>{isKnownWorkerKind(device.kind) ? t(`overview.workerKind.${device.kind}`) : device.kind}</UiTableCell>
            <UiTableCell data-label={t("overview.devices.version")}>{device.version ?? t("overview.devices.noVersion")}</UiTableCell>
            <UiTableCell><UiBadge tone={device.online ? "success" : device.status === "offline" ? "neutral" : "warning"}>{t(`overview.workerStatus.${device.status}`)}</UiBadge></UiTableCell>
            <UiTableCell data-label={t("overview.devices.lastSeen")}>{sinceText(Date.parse(device.lastSeenAt), now, t, locale)}</UiTableCell>
          </UiTableRow>)}</UiTableBody>
        </UiTable>
      </div>
      {offline > 0 && online.length > 0 && <footer>
        <UiButton variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? t("overview.devices.showOnline") : offline === 1 ? t("overview.devices.showOfflineOne") : t("overview.devices.showOfflineMany", { count: number(offline) })}</UiButton>
      </footer>}
    </>}
  </UiCard>;
}
