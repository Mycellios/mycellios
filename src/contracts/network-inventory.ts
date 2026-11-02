/** Resource inventory; virtual pipeline workers never contribute hardware. */
export interface InventoryWorker {
  id: string;
  connected: boolean;
  status: string;
  executionNodeId?: string | undefined;
  /** Coordinator-managed migration alias; never used for authentication. */
  resourceDeviceId?: string | undefined;
  physicalIdentity?: { hostFingerprintSha256: string } | undefined;
  gpus: readonly { vendor: string; offeredVramMb: number }[];
  offeredVramMb: number;
}

export function networkInventory<T extends InventoryWorker>(workers: readonly T[]) {
  const groups = new Map<string, T[]>();
  let virtualWorkers = 0;
  for (const worker of workers) {
    if (worker.gpus.some((gpu) => ["mycellios", "sidecar-cell"].includes(gpu.vendor.toLowerCase()))) {
      virtualWorkers += Number(worker.connected);
      continue;
    }
    const fingerprint = worker.physicalIdentity?.hostFingerprintSha256;
    const key = worker.resourceDeviceId ? `device:${worker.resourceDeviceId}` : fingerprint && /^(?:sha256:)?[a-f0-9]{64}$/i.test(fingerprint)
      ? `host:${fingerprint}` : `node:${worker.executionNodeId || worker.id}`;
    groups.set(key, [...(groups.get(key) ?? []), worker]);
  }
  // Prefer an online session, then the largest single advertised capacity.
  // Never add two advertisements of the same host together.
  const representatives = [...groups.values()].map((group) => group.slice().sort((a, b) =>
    Number(b.connected && b.status === "online") - Number(a.connected && a.status === "online")
    || Number(b.connected) - Number(a.connected)
    || b.offeredVramMb - a.offeredVramMb || a.id.localeCompare(b.id))[0]!);
  const online = representatives.filter((worker) => worker.connected && worker.status === "online");
  const gpuCount = online.reduce((sum, worker) => sum + worker.gpus.filter((gpu) =>
    ["nvidia", "amd", "intel", "apple"].includes(gpu.vendor.toLowerCase())).length, 0);
  return {
    workers: representatives,
    online,
    connected: representatives.filter((worker) => worker.connected).length,
    gpuCount,
    offeredMemoryMb: online.reduce((sum, worker) => sum + worker.offeredVramMb, 0),
    unidentifiedSessions: online.filter((worker) => !/^(?:sha256:)?[a-f0-9]{64}$/i.test(worker.physicalIdentity?.hostFingerprintSha256 ?? "")).length,
    virtualWorkers,
  };
}
