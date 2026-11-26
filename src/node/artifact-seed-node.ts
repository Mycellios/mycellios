import { join } from "node:path";
import type { NodeConfiguration } from "../contracts/node-configuration.js";
import type { LaunchAgent } from "../distribution/launch-supervisor.js";
import { ArtifactSeedPeer } from "../worker/artifact-seed-peer.js";
import { ArtifactSeedStore } from "../worker/artifact-seed-store.js";
import type { WorkerAgentOptions } from "../worker/agent.js";

const MIB = 1024 * 1024;
const REFRESH_INTERVAL_MS = 15 * 60_000;
/** Background verification stays far below a weak disk's sequential rate. */
const VERIFY_BYTES_PER_SECOND = 32 * MIB;

export interface NodeArtifactSeed {
  peer: ArtifactSeedPeer;
  /** Present only when the owner opted in to seeding. */
  store: ArtifactSeedStore | undefined;
  seedOnly: boolean;
  stop(): Promise<void>;
}

/**
 * Every native node can request planned seed blobs for its own stages. Serving
 * them is owner opt-in: absent or disabled configuration offers nothing. The
 * disk quota never exceeds the node's own disk ceiling, and no model, GPU
 * runtime or Python process is involved.
 */
export async function startNodeArtifactSeed(
  config: NodeConfiguration,
  logger: { warn(message: string): void } = console,
): Promise<NodeArtifactSeed> {
  const seed = config.artifactSeed?.enabled ? config.artifactSeed : undefined;
  const casRoot = join(config.runtime.cachePath, "stage-cas");
  const store = seed ? new ArtifactSeedStore({
    casRoot,
    quotaBytes: Math.min(seed.diskQuotaMiB, config.limits.maxDiskMiB) * MIB,
    maxTransferSlots: seed.maxTransferSlots,
    verifyBytesPerSecond: VERIFY_BYTES_PER_SECOND,
    indexPath: join(config.runtime.cachePath, "artifact-seed-index.json"),
  }) : undefined;
  const peer = new ArtifactSeedPeer({
    nodeId: config.nodeId,
    casRoot,
    seed: store && seed ? { store, maxUploadBytesPerSecond: seed.maxUploadMbps * 125_000 } : undefined,
    logger,
  });
  await peer.start();
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  if (store) {
    const refresh = () => {
      void store.refresh(abort.signal).catch(() => {
        if (!abort.signal.aborted) logger.warn("artifact_seed_refresh_failed");
      });
    };
    refresh();
    timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    timer.unref();
  }
  return {
    peer,
    store,
    seedOnly: seed?.seedOnly === true,
    stop: async () => {
      if (timer) clearInterval(timer);
      abort.abort();
      await peer.close();
    },
  };
}

/**
 * Seed-only executor identity: it joins the authenticated runtime-stream
 * fabric under its node id but admits no stage. Nothing here probes or
 * launches Python, and no performance evidence is ever claimed.
 */
export function seedOnlyExecutor(config: NodeConfiguration): NonNullable<WorkerAgentOptions["distributedExecutor"]> {
  const launchAgent: LaunchAgent = {
    id: `artifact-seed-only:${config.nodeId}`,
    start: async () => { throw new Error("seed_only_node_has_no_stage_runtime"); },
  };
  return {
    nodeId: config.nodeId,
    stageHost: `${config.nodeId}.relay`,
    stagePort: config.runtime.stagePort,
    launchAgent,
    computeMode: "gpu-only",
    cpuEligible: false,
    ...(config.runtime.transport === "relay-only" ? { directTransport: { enabled: false } } : {}),
  };
}
