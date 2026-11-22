import { ArrowRight, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  MODEL_KIND_LABELS,
  MODEL_STATE_LABELS,
  WORKER_STATUS_LABELS,
  deviceRows,
  hourlyCompletedTasks,
  modelRows,
  onlineGpuCapacity,
  recentTaskOutcome,
  type DeviceRow,
  type HourlyActivity,
  type ModelServiceState,
  type RecentOutcome,
  type StatsHistorySample,
  type StatsSnapshot,
} from "./overview-stats";
import { formatMemory, shortId } from "./panel-ui-utilities";
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
const numbers = new Intl.NumberFormat("es-ES");
const hourFormat = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

export async function loadDayHistory(): Promise<StatsHistorySample[]> {
  const response = await fetch("/public/v1/history?range=24h", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { samples?: StatsHistorySample[] };
  return Array.isArray(body.samples) ? body.samples : [];
}

function evidenceFor(capturedAt: string, connectionError: string | null, now: number): { state: Evidence; text: string } {
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured) || capturedAt === NEVER) return { state: "waiting", text: "Esperando datos" };
  if (connectionError) return { state: "degraded", text: `Sin conexión · datos de ${sinceText(captured, now)}` };
  const age = now - captured;
  if (age <= 10_000) return { state: "fresh", text: "Red en directo" };
  return { state: age <= 30_000 ? "delayed" : "stale", text: `Datos de ${sinceText(captured, now)}` };
}

/** "hace 3 min", "hace 2 días" or a date, in Spanish. */
export function sinceText(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return "fecha desconocida";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 10) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
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
  const now = fixedNow ?? Date.now();
  const evidence = evidenceFor(snapshot.capturedAt, connectionError, now);
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
  const activity = useMemo(() => history ? hourlyCompletedTasks(history, now) : null, [history, now]);
  const outcome = useMemo(() => recentTaskOutcome(snapshot.jobs), [snapshot.jobs]);
  const serving = models.filter((model) => model.state === "serving").length;
  const preparing = models.filter((model) => model.state === "preparing").length;

  return <section className="overview-page overview-stats" aria-labelledby="overview-stats-title">
    <header className="overview-heading">
      <div>
        <UiHeading as="h1" id="overview-stats-title">Estadísticas de la red</UiHeading>
        <span className={`overview-status ${evidence.state}`} role="status"><i />{evidence.text}</span>
      </div>
      <UiButton variant="ghost" className="overview-add-device" onClick={onAddDevice}>Añadir un dispositivo <ArrowRight size={15} aria-hidden="true" /></UiButton>
    </header>
    {evidence.state === "waiting" ? <UiCard className="overview-no-evidence"><CircleAlert aria-hidden="true" /><div><UiHeading as="h2">Esperando al coordinador</UiHeading><UiText>Las estadísticas aparecerán cuando llegue la primera lectura de la red.</UiText></div></UiCard> : <>
      <dl className="overview-kpis" aria-label="Resumen de la red">
        <div>
          <dt>Nodos en línea</dt>
          <dd className="overview-kpi-value">{numbers.format(snapshot.summary.online)} <small>de {numbers.format(snapshot.summary.registered)}</small></dd>
          <dd className="overview-kpi-hint">Equipos conectados ahora, de todos los registrados.</dd>
        </div>
        <div>
          <dt>Memoria de GPU compartida</dt>
          <dd className="overview-kpi-value">{gpu.gpus > 0 ? formatMemory(gpu.sharedMb) : "Ninguna"}</dd>
          <dd className="overview-kpi-hint">{gpu.gpus > 0 ? `${gpu.gpus} ${gpu.gpus === 1 ? "tarjeta gráfica" : "tarjetas gráficas"} en equipos en línea.` : "Ningún equipo en línea aporta tarjeta gráfica."}</dd>
        </div>
        <div>
          <dt>Modelos en servicio</dt>
          <dd className="overview-kpi-value">{numbers.format(serving)}</dd>
          <dd className="overview-kpi-hint">{preparing > 0 ? `${preparing} más en preparación.` : "Listos para recibir tareas."}</dd>
        </div>
        <div>
          <dt>Tareas completadas</dt>
          <dd className="overview-kpi-value">{numbers.format(snapshot.summary.completedJobs)}</dd>
          <dd className="overview-kpi-hint">{completedHint(activity)}</dd>
        </div>
      </dl>
      <ActivityCard activity={activity} error={historyError} onRetry={() => setAttempt((value) => value + 1)} outcome={outcome} now={now} />
      <ModelsCard models={models} />
      <DevicesCard devices={devices} now={now} />
    </>}
  </section>;
}

function completedHint(activity: HourlyActivity | null): string {
  if (!activity || activity.coverageStart === null) return "Total desde que empezó la red.";
  const amount = numbers.format(activity.completed);
  return activity.fullDay
    ? `${amount} en las últimas 24 horas.`
    : `${amount} desde las ${hourFormat.format(activity.coverageStart)}.`;
}

function ActivityCard({ activity, error, onRetry, outcome, now }: { activity: HourlyActivity | null; error: boolean; onRetry: () => void; outcome: RecentOutcome; now: number }) {
  return <UiCard className="overview-card overview-activity">
    <header>
      <UiHeading as="h2">Actividad de las últimas 24 horas</UiHeading>
      <UiText>Tareas completadas por hora.</UiText>
    </header>
    {activity ? <HourlyChart activity={activity} />
      : error ? <div className="overview-card-state" role="alert"><UiText>No se ha podido cargar la actividad.</UiText><UiButton variant="secondary" size="sm" onClick={onRetry}>Reintentar</UiButton></div>
      : <div className="overview-card-state" role="status"><UiText>Cargando actividad…</UiText></div>}
    <OutcomeBar outcome={outcome} now={now} />
  </UiCard>;
}

const CHART = { width: 720, height: 168, top: 12, bottom: 136, left: 4, right: 716 };

function barPath(x: number, width: number, top: number, bottom: number): string {
  const height = bottom - top;
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x} ${bottom}V${top + radius}Q${x} ${top} ${x + radius} ${top}H${x + width - radius}Q${x + width} ${top} ${x + width} ${top + radius}V${bottom}Z`;
}

export function HourlyChart({ activity }: { activity: HourlyActivity }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableId = useId();
  const maximum = Math.max(1, ...activity.hours.map((hour) => hour.completed));
  const slot = (CHART.right - CHART.left) / activity.hours.length;
  const barWidth = Math.max(2, slot - 4);
  const y = (value: number) => CHART.bottom - (value / maximum) * (CHART.bottom - CHART.top);
  const busiest = activity.hours.reduce((best, hour) => hour.completed > best.completed ? hour : best, activity.hours[0]!);
  const hourLabel = (start: number) => hourFormat.format(start);
  const summary = activity.completed > 0
    ? `${numbers.format(activity.completed)} tareas completadas en las últimas 24 horas. La hora con más actividad empezó a las ${hourLabel(busiest.start)}, con ${numbers.format(busiest.completed)} tareas.`
    : "No se han completado tareas en las últimas 24 horas.";
  const tooltip = hovered === null ? null : activity.hours[hovered]!;
  const leave = useCallback(() => setHovered(null), []);
  return <figure className="overview-chart">
    <div className="overview-chart-plot" onMouseLeave={leave}>
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={summary} aria-describedby={tableId} preserveAspectRatio="none">
        <line className="overview-chart-baseline" x1={CHART.left} x2={CHART.right} y1={CHART.bottom} y2={CHART.bottom} />
        <line className="overview-chart-grid" x1={CHART.left} x2={CHART.right} y1={CHART.top} y2={CHART.top} />
        {activity.hours.map((hour, index) => {
          const x = CHART.left + index * slot + (slot - barWidth) / 2;
          return <g key={hour.start}>
            <path className={`overview-chart-bar${hovered === index ? " active" : ""}`} d={barPath(x, barWidth, y(hour.completed), CHART.bottom)} />
            <rect className="overview-chart-hit" x={CHART.left + index * slot} y={0} width={slot} height={CHART.bottom} onMouseEnter={() => setHovered(index)}>
              <title>{`${hourLabel(hour.start)}: ${numbers.format(hour.completed)} tareas completadas`}</title>
            </rect>
          </g>;
        })}
      </svg>
      <span className="overview-chart-max" aria-hidden="true">{numbers.format(maximum)}</span>
      {tooltip && <span className="overview-chart-tooltip" aria-hidden="true" style={{ left: `${((hovered! + 0.5) / activity.hours.length) * 100}%` }}><strong>{numbers.format(tooltip.completed)}</strong> tareas · {hourLabel(tooltip.start)}</span>}
    </div>
    <div className="overview-chart-axis" aria-hidden="true">
      {activity.hours.filter((_, index) => index % 6 === 0).map((hour) => <span key={hour.start}>{hourLabel(hour.start)}</span>)}
      <span>Ahora</span>
    </div>
    <figcaption className="sr-only">{summary}</figcaption>
    <UiTable id={tableId} className="sr-only">
      <UiTableHead><UiTableRow><UiTableHeader>Hora</UiTableHeader><UiTableHeader>Tareas completadas</UiTableHeader></UiTableRow></UiTableHead>
      <UiTableBody>{activity.hours.map((hour) => <UiTableRow key={hour.start}><UiTableCell>{hourLabel(hour.start)}</UiTableCell><UiTableCell>{numbers.format(hour.completed)}</UiTableCell></UiTableRow>)}</UiTableBody>
    </UiTable>
  </figure>;
}

export function OutcomeBar({ outcome, now }: { outcome: RecentOutcome; now: number }) {
  if (outcome.total === 0) return <div className="overview-outcome"><UiText>Todavía no hay tareas recientes.</UiText></div>;
  const parts = [
    { key: "completed", label: "Completadas", value: outcome.completed },
    { key: "failed", label: "Fallidas", value: outcome.failed },
    { key: "running", label: "En curso", value: outcome.inProgress },
  ].filter((part) => part.value > 0);
  const span = outcome.since === null ? "" : ` (${sinceText(outcome.since, now).replace(/^hace /, "últimos ")})`;
  const description = parts.map((part) => `${numbers.format(part.value)} ${part.label.toLowerCase()}`).join(", ");
  return <div className="overview-outcome">
    <UiHeading as="h3">Cómo terminaron las últimas {numbers.format(outcome.total)} tareas{span}</UiHeading>
    <div className="overview-outcome-bar" role="img" aria-label={`Últimas ${outcome.total} tareas: ${description}.`}>
      {parts.map((part) => <span key={part.key} className={`overview-outcome-${part.key}`} style={{ flexGrow: part.value }} title={`${part.label}: ${numbers.format(part.value)}`} />)}
    </div>
    <ul className="overview-outcome-legend">
      {parts.map((part) => <li key={part.key}><i className={`overview-outcome-${part.key}`} aria-hidden="true" />{part.label} <strong>{numbers.format(part.value)}</strong></li>)}
    </ul>
  </div>;
}

function ModelsCard({ models }: { models: ReturnType<typeof modelRows> }) {
  const [showAll, setShowAll] = useState(false);
  const inService = models.filter((model) => model.state === "serving");
  const others = models.length - inService.length;
  const visible = showAll || inService.length === 0 ? models : inService;
  return <UiCard className="overview-card overview-models-card">
    <header>
      <UiHeading as="h2">Modelos</UiHeading>
      <UiText>Qué puede hacer la red ahora y cuántos equipos lo sirven.</UiText>
    </header>
    {models.length === 0 ? <UiText className="overview-card-state">Todavía no hay modelos. Añade un dispositivo para poner uno en servicio.</UiText> : <>
      <div className="overview-table-scroll" role="region" aria-label="Tabla de modelos" tabIndex={0}>
        <UiTable className="overview-table">
          <UiTableHead><UiTableRow><UiTableHeader>Modelo</UiTableHeader><UiTableHeader>Tipo</UiTableHeader><UiTableHeader>Nodos</UiTableHeader><UiTableHeader>Estado</UiTableHeader><UiTableHeader>Tareas recientes</UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visible.map((model) => <UiTableRow key={model.id}>
            <UiTableCell><span className="overview-cell-name"><strong>{model.name}</strong><small>{model.id}</small></span></UiTableCell>
            <UiTableCell>{MODEL_KIND_LABELS[model.kind]}</UiTableCell>
            <UiTableCell className="overview-number" data-label="Nodos">{numbers.format(model.nodes)}</UiTableCell>
            <UiTableCell><UiBadge tone={STATE_TONES[model.state]}>{MODEL_STATE_LABELS[model.state]}</UiBadge></UiTableCell>
            <UiTableCell className="overview-number" data-label="Tareas recientes">{numbers.format(model.recentTasks)}</UiTableCell>
          </UiTableRow>)}</UiTableBody>
        </UiTable>
      </div>
      <footer>
        <UiText as="small">«Tareas recientes» cuenta las últimas 100 tareas de la red.</UiText>
        {others > 0 && inService.length > 0 && <UiButton variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "Mostrar solo los modelos en servicio" : `Mostrar ${others} ${others === 1 ? "modelo" : "modelos"} sin servicio`}</UiButton>}
      </footer>
    </>}
  </UiCard>;
}

function DevicesCard({ devices, now }: { devices: DeviceRow[]; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const online = devices.filter((device) => device.online);
  const offline = devices.length - online.length;
  const visible = showAll || online.length === 0 ? devices : online;
  return <UiCard className="overview-card overview-devices-card">
    <header>
      <UiHeading as="h2">Dispositivos</UiHeading>
      <UiText>Equipos que aportan cómputo a la red.</UiText>
    </header>
    {devices.length === 0 ? <UiText className="overview-card-state">Todavía no hay dispositivos registrados.</UiText> : <>
      <div className="overview-table-scroll" role="region" aria-label="Tabla de dispositivos" tabIndex={0}>
        <UiTable className="overview-table">
          <UiTableHead><UiTableRow><UiTableHeader>Equipo</UiTableHeader><UiTableHeader>Tipo</UiTableHeader><UiTableHeader>Versión</UiTableHeader><UiTableHeader>Estado</UiTableHeader><UiTableHeader>Última señal</UiTableHeader></UiTableRow></UiTableHead>
          <UiTableBody>{visible.map((device) => <UiTableRow key={device.id}>
            <UiTableCell><span className="overview-cell-name"><strong>{device.hardware}</strong><small title={device.id}>{shortId(device.id)}</small></span></UiTableCell>
            <UiTableCell>{device.kind}</UiTableCell>
            <UiTableCell data-label="Versión">{device.version}</UiTableCell>
            <UiTableCell><UiBadge tone={device.online ? "success" : device.status === "offline" ? "neutral" : "warning"}>{WORKER_STATUS_LABELS[device.status]}</UiBadge></UiTableCell>
            <UiTableCell data-label="Última señal">{sinceText(Date.parse(device.lastSeenAt), now)}</UiTableCell>
          </UiTableRow>)}</UiTableBody>
        </UiTable>
      </div>
      {offline > 0 && online.length > 0 && <footer>
        <UiButton variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "Mostrar solo los equipos en línea" : `Mostrar ${offline} ${offline === 1 ? "equipo desconectado" : "equipos desconectados"}`}</UiButton>
      </footer>}
    </>}
  </UiCard>;
}
