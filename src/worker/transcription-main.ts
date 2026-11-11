/** Source-bound native CUDA replica on an already consenting physical contributor. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import { loadWorkerConfig } from "../core/config.js";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { evaluateNodeWorkPolicy } from "../contracts/node-work-policy.js";
import { TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST } from "../contracts/transcription.js";
import { WorkerAgent } from "./agent.js";
import { loadOrCreateWorkerAdmissionCredential, workerAdmissionSigner } from "./admission-credential.js";

const configPath = process.env.MYCELLIOS_TRANSCRIPTION_GPU_CONFIG;
if (!configPath || !process.env.GPU_MESH_WORKER_CONFIG || !process.env.MYCELLIOS_WORKER_CREDENTIAL_PATH) throw new Error("transcription_configuration_missing");
const cfg = z.object({
  modelId: z.literal(TRANSCRIPTION_MODEL), modelDigest: z.literal(TRANSCRIPTION_DIGEST), nodeId: z.string().min(1),
  consumerId: z.string().min(1), memoryMiB: z.literal(2048), deviceName: z.string().min(1),
  gpuCoreSourceSha256: z.string().regex(/^[a-f0-9]{64}$/), guardSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  artifactsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  nativeConfigPath: z.string().min(1), nativeStatePath: z.string().min(1),
}).parse(JSON.parse(readFileSync(configPath, "utf8")));
const runtime = readNativeRuntimeBuildMetadata(resolve(import.meta.dirname, "../.."));
if (!runtime.buildIdentity || !runtime.revision) throw new Error("transcription_release_provenance_required");
const response = await fetch("http://127.0.0.1:8892/health", { redirect: "error", signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error("transcription_runtime_unavailable");
const health = await response.json() as { status?: string; artifact_identity?: string; execution?: {
  backend?: string; precision?: string; deviceName?: string; fallback?: boolean; tf32?: boolean;
  gpuCoreSourceSha256?: string; guardSourceSha256?: string; artifactsSha256?: string;
  reservation?: { nodeId?: string; consumerId?: string; memoryMiB?: number; expiresAt?: number };
} };
const gpu = health.execution;
if (health.status !== "ready" || health.artifact_identity !== cfg.modelDigest || gpu?.backend !== "cuda"
  || gpu.precision !== "float32" || gpu.fallback !== false || gpu.tf32 !== false || gpu.deviceName !== cfg.deviceName
  || gpu.gpuCoreSourceSha256 !== cfg.gpuCoreSourceSha256 || gpu.guardSourceSha256 !== cfg.guardSourceSha256
  || gpu.artifactsSha256 !== cfg.artifactsSha256
  || gpu.reservation?.nodeId !== cfg.nodeId || gpu.reservation.consumerId !== cfg.consumerId
  || gpu.reservation.memoryMiB !== cfg.memoryMiB || (gpu.reservation.expiresAt ?? 0) <= Date.now() + 20_000) {
  throw new Error("transcription_physical_runtime_not_qualified");
}
const workAdmissionPolicy = (model: string, at: Date) => {
  try {
    const node = JSON.parse(readFileSync(cfg.nativeConfigPath, "utf8"));
    const state = JSON.parse(readFileSync(cfg.nativeStatePath, "utf8"));
    if (node.nodeId !== cfg.nodeId || state.contributionEnabled !== true || state.draining !== false) return "physical_owner_paused";
    return evaluateNodeWorkPolicy(node.policy, model, at);
  } catch { return "physical_owner_policy_unavailable"; }
};
if (workAdmissionPolicy(cfg.modelId, new Date())) throw new Error("physical_owner_policy_rejected_transcription");
const buildIdentity = { schema: "mycellios-native-build-provenance/1" as const, version: runtime.version,
  sourceId: "sha256:" + createHash("sha256").update(JSON.stringify({ base: runtime.buildIdentity,
    worker: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
    core: cfg.gpuCoreSourceSha256, guard: cfg.guardSourceSha256, artifacts: cfg.artifactsSha256 })).digest("hex") };
const agent = new WorkerAgent(loadWorkerConfig(resolve(process.env.GPU_MESH_WORKER_CONFIG)), {
  coordinatorUrl: process.env.GPU_MESH_COORDINATOR ?? "https://www.mycellios.com",
  admissionSigner: workerAdmissionSigner(loadOrCreateWorkerAdmissionCredential(resolve(process.env.MYCELLIOS_WORKER_CREDENTIAL_PATH))),
  verifiedGpuRuntime: { status: "gpu-ready", backend: "cuda", deviceName: cfg.deviceName },
  hardwareCapacityOverride: { id: "cpu-memory", vendor: "cpu", model: "Host RAM; CUDA budget reserved on physical native node",
    physicalVramMb: 0, sharedMemoryMb: Math.floor(totalmem() / 4 / 1048576), unifiedMemory: true },
  workAdmissionPolicy, agentVersion: runtime.version, buildIdentity,
  ...(process.env.MYCELLIOS_NETWORK_TOKEN?.trim() ? { networkToken: process.env.MYCELLIOS_NETWORK_TOKEN.trim() } : {}),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void agent.stop());
await agent.start();
