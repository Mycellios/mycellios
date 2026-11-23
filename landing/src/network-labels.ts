import { placeWorker } from "./network-location";

interface LabelledWorker {
  kind: string;
  region: string;
  gpus: readonly { vendor: string; model: string }[];
}

/**
 * Public hardware label. CPU fallbacks and coordinator pipeline cells report
 * operator notes in their model field, so they are named by what they are.
 */
export function publicHardwareLabel(worker: LabelledWorker): string {
  const gpus = worker.gpus.filter(gpu => !["cpu", "mycellios", "sidecar-cell"].includes(gpu.vendor.toLowerCase()));
  if (worker.kind === "cell" || worker.gpus.some(gpu => ["mycellios", "sidecar-cell"].includes(gpu.vendor.toLowerCase()))) return "Pipeline cell";
  if (gpus.length) return gpus.map(gpu => gpu.model).join(", ");
  if (worker.gpus.some(gpu => gpu.vendor.toLowerCase() === "cpu")) return "CPU · system memory";
  return worker.kind === "browser" ? "Browser worker" : worker.kind;
}

/** A supported city, or null: operator tags such as private network names are not public locations. */
export function publicRegionLabel(region: string): string | null {
  return placeWorker(region) ? region : null;
}
