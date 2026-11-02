import type { NetworkSnapshot, NetworkTelemetryHistory, NetworkHistoryRange } from "./NetworkPage";
import { placeWorker } from "./network-location";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function parseStatsSnapshot(value: unknown): NetworkSnapshot {
  const summary = record(value) && record(value.summary) ? value.summary : null;
  if (!record(value) || !date(value.capturedAt) || !record(value.summary)
    || !summary || !["registered", "connected", "online", "mobile", "offeredVramMb", "completedJobs"].every(key => count(summary[key]))
    || !Array.isArray(value.workers) || !value.workers.every(worker => record(worker) && typeof worker.id === "string" && typeof worker.region === "string" && typeof worker.connected === "boolean" && typeof worker.status === "string" && typeof worker.kind === "string" && count(worker.offeredVramMb) && count(worker.jobsCompleted) && Array.isArray(worker.gpus) && worker.gpus.every(gpu => record(gpu) && typeof gpu.model === "string") && Array.isArray(worker.deployments))
    || !Array.isArray(value.models) || !value.models.every(model => record(model) && typeof model.id === "string" && count(model.replicas) && count(model.pipelines))
    || !Array.isArray(value.jobs) || !value.jobs.every(job => record(job) && typeof job.id === "string" && typeof job.model === "string" && typeof job.status === "string" && count(job.inputTokens) && count(job.outputTokens) && date(job.updatedAt))) throw new Error("The public snapshot has an unsupported format.");
  return value as unknown as NetworkSnapshot;
}

const sampleKeys = ["registeredNodes", "connectedNodes", "onlineNodes", "browserNodes", "activeModels", "modelReplicas", "modelPipelines", "offeredVramMb", "freeVramMb", "inflightJobs", "runningJobs", "completedJobs"];
export function parseStatsHistory(value: unknown, range: NetworkHistoryRange): NetworkTelemetryHistory {
  if (!record(value) || !date(value.capturedAt) || value.range !== range || !count(value.intervalMinutes) || !count(value.retentionDays) || !Array.isArray(value.samples) || !value.samples.every(sample => record(sample) && date(sample.capturedAt) && sampleKeys.every(key => count(sample[key])))) throw new Error("The public history has an unsupported format.");
  return value as unknown as NetworkTelemetryHistory;
}

export function statsOverview(snapshot: NetworkSnapshot) {
  const active = new Set(["queued", "leasing", "running", "streaming"]);
  const recentTokens = new Map<string, number>();
  snapshot.jobs.forEach(job => recentTokens.set(job.model, (recentTokens.get(job.model) ?? 0) + job.inputTokens + job.outputTokens));
  return {
    activeJobs: snapshot.jobs.filter(job => active.has(job.status)).length,
    servingModels: snapshot.models.filter(model => model.replicas > 0 || model.pipelines > 0).length,
    modelRows: snapshot.models.map(model => ({ ...model, recentTokens: recentTokens.get(model.id) ?? 0 })),
    located: snapshot.workers.filter(worker => placeWorker(worker.region) !== null).length,
  };
}
