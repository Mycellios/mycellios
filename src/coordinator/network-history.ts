import { networkInventory, type InventoryWorker } from "../contracts/network-inventory.js";
import type { StoredNetworkTelemetrySample } from "../storage/store.js";

/**
 * Public network history: ten-minute coordinator samples kept for 90 days.
 * Every field is a network total; no request content or account data.
 */
export const NETWORK_TELEMETRY_INTERVAL_MS = 10 * 60_000;
export const NETWORK_TELEMETRY_RETENTION_DAYS = 90;

export const networkHistoryRanges = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "90d": NETWORK_TELEMETRY_RETENTION_DAYS * 24,
} as const;

/**
 * Job statuses counted by the cumulative `failedJobs` history counter: terminal
 * failures the network caused or observed, including deadline expiry. Client
 * cancellations (`cancelled`) are excluded. Must match `MeshStore.countFailedJobs`.
 */
export const NETWORK_HISTORY_FAILED_STATUSES = ["failed", "expired"] as const;

interface TelemetrySnapshot {
  summary: { registered: number; connected: number; online: number; mobile: number; completedJobs: number };
  workers: ReadonlyArray<Omit<InventoryWorker, "gpus"> & {
    gpus: ReadonlyArray<InventoryWorker["gpus"][number] & { freeOfferedVramMb: number }>;
  }>;
  models: ReadonlyArray<{ replicas: number; pipelines: number }>;
  jobs: ReadonlyArray<{ status: string }>;
}

export function networkTelemetrySample(
  snapshot: TelemetrySnapshot,
  capturedAt: number,
  failedJobs: number,
): StoredNetworkTelemetrySample {
  const onlineWorkers = networkInventory(snapshot.workers).online;
  const offeredVramMb = onlineWorkers.reduce(
    (total, worker) => total + worker.offeredVramMb,
    0,
  );
  const freeVramMb = onlineWorkers.reduce(
    (total, worker) => total
      + worker.gpus.reduce((gpuTotal, gpu) => gpuTotal + gpu.freeOfferedVramMb, 0),
    0,
  );
  const inflightJobs = snapshot.jobs.filter(
    (job) => ["queued", "leasing", "running", "streaming"].includes(job.status),
  );
  return {
    capturedAt,
    registeredNodes: snapshot.summary.registered,
    connectedNodes: snapshot.summary.connected,
    onlineNodes: snapshot.summary.online,
    browserNodes: snapshot.summary.mobile,
    activeModels: snapshot.models.length,
    modelReplicas: snapshot.models.reduce((total, model) => total + model.replicas, 0),
    modelPipelines: snapshot.models.reduce((total, model) => total + model.pipelines, 0),
    offeredVramMb,
    freeVramMb: Math.min(offeredVramMb, freeVramMb),
    inflightJobs: inflightJobs.length,
    runningJobs: inflightJobs.filter(
      (job) => job.status === "running" || job.status === "streaming",
    ).length,
    completedJobs: snapshot.summary.completedJobs,
    failedJobs,
  };
}

/**
 * `GET /public/v1/history` body. `failedJobs` is cumulative like `completedJobs`;
 * a null value marks a sample recorded before failures were measured (unknown,
 * not zero), and `failedJobs.measuredSince` is the first measured sample in range.
 */
export function networkHistoryResponse(
  samples: readonly StoredNetworkTelemetrySample[],
  now: number,
  range: keyof typeof networkHistoryRanges,
) {
  const firstMeasured = samples.find((sample) => sample.failedJobs !== null);
  return {
    capturedAt: new Date(now).toISOString(),
    intervalMinutes: NETWORK_TELEMETRY_INTERVAL_MS / 60_000,
    retentionDays: NETWORK_TELEMETRY_RETENTION_DAYS,
    range,
    failedJobs: {
      counts: NETWORK_HISTORY_FAILED_STATUSES,
      excludes: ["cancelled"],
      measuredSince: firstMeasured ? new Date(firstMeasured.capturedAt).toISOString() : null,
    },
    samples: samples.map((sample) => ({
      ...sample,
      capturedAt: new Date(sample.capturedAt).toISOString(),
    })),
  };
}
