/**
 * Plain-language statistics for the public dashboard Overview. Everything here is
 * derived from data the coordinator already publishes: the public snapshot (summary,
 * workers, models, requested models and the latest jobs) and the telemetry history.
 * The dashboard is public, so these helpers never read account data.
 */

export type ModelKind = "voice" | "transcription" | "embeddings" | "chat" | "decisions";
export type ModelServiceState = "serving" | "preparing" | "no_capacity" | "unavailable";

interface StatsGpu { vendor: string; model: string; offeredVramMb: number }
interface StatsDeployment { model: string; adapter?: string; mode?: string }
export interface StatsWorker {
  id: string;
  kind: string;
  status: "online" | "suspect" | "offline" | "draining";
  connected: boolean;
  lastSeenAt: string;
  agentVersion?: string;
  gpus: StatsGpu[];
  deployments: StatsDeployment[];
}
export interface StatsJob { id: string; model: string; status: string; createdAt: string; updatedAt: string }
export interface StatsRequestedModel { id: string; status: "profiling" | "waiting_capacity" | "ready" | "activating" | "active" | "incompatible" | "failed" }
export interface StatsSnapshot {
  summary: { registered: number; online: number; completedJobs: number };
  workers: StatsWorker[];
  models: Array<{ id: string; replicas: number; pipelines: number }>;
  requestedModels: StatsRequestedModel[];
  jobs: StatsJob[];
}
/**
 * One persisted history sample. Both counters are cumulative. `failedJobs` counts
 * failed and deadline-expired tasks (not client cancellations); it is null or absent
 * for samples recorded before the coordinator measured failures.
 */
export interface StatsHistorySample { capturedAt: string; completedJobs: number; failedJobs?: number | null }

const ADAPTER_KINDS: Record<string, ModelKind> = {
  kokoro: "voice",
  transcription: "transcription",
  whisper: "transcription",
  embedding: "embeddings",
  decision: "decisions",
};

/** The job a model does, from its runtime adapter first and its id otherwise. */
export function modelKind(id: string, adapters: readonly string[] = []): ModelKind {
  for (const adapter of adapters) {
    const kind = ADAPTER_KINDS[adapter.toLowerCase()];
    if (kind) return kind;
  }
  const value = id.toLowerCase();
  if (/kokoro|(^|-)tts(-|$)|speech/.test(value)) return "voice";
  if (/whisper|transcri/.test(value)) return "transcription";
  if (/embed/.test(value)) return "embeddings";
  if (value === "jev" || /decision/.test(value)) return "decisions";
  return "chat";
}

const FAMILY_NAMES: Record<string, string> = {
  kokoro: "Kokoro",
  whisper: "Whisper",
  qwen: "Qwen",
  qwen3: "Qwen3",
  smollm2: "SmolLM2",
  llama: "Llama",
  gpt2: "GPT-2",
  gpu: "GPU",
  cpu: "CPU",
};
export type ModelLanguage = "es" | "en";
const LANGUAGE_NAMES: Record<ModelLanguage, string> = { es: "español", en: "inglés" };
const isModelLanguage = (value: string): value is ModelLanguage => value === "es" || value === "en";
const DROPPED_PREFIXES = ["mycellios-", "agent-credit-lab-"];

/** A readable name for a raw model id; the id itself stays available as secondary text. */
export function modelDisplayName(id: string, languageName: (language: ModelLanguage) => string = (language) => LANGUAGE_NAMES[language]): string {
  let value = id.trim();
  for (const prefix of DROPPED_PREFIXES) if (value.toLowerCase().startsWith(prefix)) value = value.slice(prefix.length);
  const words: string[] = [];
  const languages: string[] = [];
  for (const token of value.split(/[-_\s]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    // Dates and short hashes identify a build, not the model a reader recognises.
    if (/^\d{8}$/.test(lower) || (/^[0-9a-f]{8}$/.test(lower) && /\d/.test(lower))) continue;
    if (isModelLanguage(lower)) { languages.push(languageName(lower)); continue; }
    if (/^\d+(\.\d+)?[bm]$/.test(lower)) { words.push(lower.toUpperCase()); continue; }
    words.push(FAMILY_NAMES[lower] ?? `${token.charAt(0).toUpperCase()}${token.slice(1)}`);
  }
  const name = words.join(" ") || id;
  return languages.length > 0 ? `${name} (${languages.join(", ")})` : name;
}

export interface ModelRow {
  id: string;
  name: string;
  kind: ModelKind;
  state: ModelServiceState;
  nodes: number;
  recentTasks: number;
}

function requestedState(status: StatsRequestedModel["status"] | undefined): ModelServiceState {
  if (status === "waiting_capacity") return "no_capacity";
  if (status === "failed" || status === "incompatible") return "unavailable";
  return "preparing";
}

/** Models in service first, then the ones still being prepared or lacking capacity. */
export function modelRows(snapshot: StatsSnapshot): ModelRow[] {
  const rows = new Map<string, ModelRow>();
  const requests = new Map(snapshot.requestedModels.map((request) => [request.id.toLowerCase(), request]));
  const servingWorkers = (id: string) => snapshot.workers.filter((worker) =>
    worker.connected && worker.deployments.some((deployment) => deployment.model.toLowerCase() === id));
  const adaptersFor = (id: string) => snapshot.workers.flatMap((worker) => worker.deployments)
    .filter((deployment) => deployment.model.toLowerCase() === id)
    .map((deployment) => deployment.adapter ?? deployment.mode ?? "");
  const recentTasks = (id: string) => snapshot.jobs.filter((job) => job.model.toLowerCase() === id).length;
  for (const model of snapshot.models) {
    const key = model.id.toLowerCase();
    const nodes = servingWorkers(key).length;
    const request = requests.get(key);
    rows.set(key, {
      id: model.id,
      name: modelDisplayName(model.id),
      kind: modelKind(model.id, adaptersFor(key)),
      state: nodes > 0 ? "serving" : request ? requestedState(request.status === "active" ? "activating" : request.status) : "no_capacity",
      nodes,
      recentTasks: recentTasks(key),
    });
  }
  for (const request of snapshot.requestedModels) {
    const key = request.id.toLowerCase();
    if (rows.has(key)) continue;
    rows.set(key, {
      id: request.id,
      name: modelDisplayName(request.id),
      kind: modelKind(request.id, adaptersFor(key)),
      state: requestedState(request.status === "active" ? "activating" : request.status),
      nodes: servingWorkers(key).length,
      recentTasks: recentTasks(key),
    });
  }
  const order: Record<ModelServiceState, number> = { serving: 0, preparing: 1, no_capacity: 2, unavailable: 3 };
  return [...rows.values()].sort((left, right) =>
    order[left.state] - order[right.state] || right.recentTasks - left.recentTasks || left.name.localeCompare(right.name));
}

export interface GpuCapacity { gpus: number; sharedMb: number; devices: number }

/** Graphics cards on devices online now; CPU fallbacks and pooled native capacity are not GPUs. */
export function onlineGpuCapacity(workers: readonly StatsWorker[]): GpuCapacity {
  const online = workers.filter((worker) => worker.connected && worker.status === "online");
  const gpus = online.flatMap((worker) => worker.gpus.filter(isPhysicalGpu));
  return {
    gpus: gpus.length,
    sharedMb: gpus.reduce((total, gpu) => total + Math.max(0, gpu.offeredVramMb), 0),
    devices: online.filter((worker) => worker.gpus.some(isPhysicalGpu)).length,
  };
}

function isPhysicalGpu(gpu: StatsGpu): boolean {
  const vendor = gpu.vendor.toLowerCase();
  return vendor !== "cpu" && vendor !== "mycellios";
}

/** Worker kinds the panel names; other kinds are shown as reported. */
export const WORKER_KINDS = ["node", "cell", "desktop", "browser"] as const;
export type KnownWorkerKind = (typeof WORKER_KINDS)[number];
export function isKnownWorkerKind(kind: string): kind is KnownWorkerKind {
  return (WORKER_KINDS as readonly string[]).includes(kind);
}

export interface DeviceRow {
  id: string;
  /** The contributed card, "CPU", or null for native capacity without a physical GPU. */
  hardware: string | null;
  /** The reported worker kind; the panel names known kinds in its language. */
  kind: string;
  /** "v1.2.3", or null when the worker did not report a version. */
  version: string | null;
  status: StatsWorker["status"];
  online: boolean;
  lastSeenAt: string;
}

/** The hardware a device contributes: its card, a CPU, or null for native capacity. */
export function deviceHardware(worker: StatsWorker): string | null {
  const gpus = worker.gpus.filter(isPhysicalGpu);
  if (gpus.length > 0) {
    const name = gpus[0]!.model.replace(/\((?:R|TM)\)/gi, "").replace(/\s+/g, " ").trim() || "GPU";
    return gpus.length > 1 ? `${name} +${gpus.length - 1}` : name;
  }
  if (worker.gpus.some((gpu) => gpu.vendor.toLowerCase() === "mycellios")) return null;
  return "CPU";
}

export function deviceRows(workers: readonly StatsWorker[]): DeviceRow[] {
  return workers.map((worker) => ({
    id: worker.id,
    hardware: deviceHardware(worker),
    kind: worker.kind,
    version: worker.agentVersion ? `v${worker.agentVersion}` : null,
    status: worker.connected ? worker.status : "offline",
    online: worker.connected && worker.status === "online",
    lastSeenAt: worker.lastSeenAt,
  })).sort((left, right) => Number(right.online) - Number(left.online) || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
}

export interface HourlyActivity {
  /**
   * 24 hourly buckets, oldest first; `start` is the bucket's start time.
   * `failed` is null when no measured failure counter covers that hour ("sin datos").
   */
  hours: Array<{ start: number; completed: number; failed: number | null }>;
  completed: number;
  /** Failed tasks over the hours that have failure data. */
  failed: number;
  /** When the history actually begins inside the 24-hour window. */
  coverageStart: number | null;
  fullDay: boolean;
  /** When failure data begins inside the window; null when no hour has it. */
  failedCoverageStart: number | null;
  failedFullDay: boolean;
}

const HOUR = 3_600_000;

function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Completed and failed tasks per hour over the last 24 hours, from the cumulative
 * counters in the telemetry history. Each increase is attributed to the sample that
 * observed it. Failures are only counted between two samples that both measured them,
 * so hours before the coordinator recorded failures stay unknown instead of zero.
 */
export function hourlyTasks(samples: readonly StatsHistorySample[], now: number): HourlyActivity {
  const end = Math.floor(now / HOUR) * HOUR + HOUR;
  const start = end - 24 * HOUR;
  const hours: HourlyActivity["hours"] = Array.from({ length: 24 }, (_, index) => ({ start: start + index * HOUR, completed: 0, failed: null }));
  const ordered = samples
    .map((sample) => ({ at: Date.parse(sample.capturedAt), value: sample.completedJobs, failed: counter(sample.failedJobs) }))
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.value))
    .sort((left, right) => left.at - right.at);
  let completed = 0;
  let failed = 0;
  let coverageStart: number | null = null;
  let failedCoverageStart: number | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.at < start || current.at >= end) continue;
    coverageStart ??= previous.at;
    const hour = hours[Math.floor((current.at - start) / HOUR)]!;
    // A lower counter is a reset, not negative work.
    const delta = Math.max(0, current.value - previous.value);
    hour.completed += delta;
    completed += delta;
    if (previous.failed === null || current.failed === null) continue;
    failedCoverageStart ??= previous.at;
    const failedDelta = Math.max(0, current.failed - previous.failed);
    hour.failed = (hour.failed ?? 0) + failedDelta;
    failed += failedDelta;
  }
  return {
    hours,
    completed,
    failed,
    coverageStart,
    fullDay: coverageStart !== null && coverageStart <= now - 23 * HOUR,
    failedCoverageStart,
    failedFullDay: failedCoverageStart !== null && failedCoverageStart <= now - 23 * HOUR,
  };
}
