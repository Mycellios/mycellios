import { loadWorkerConfig } from "../core/config.js";
import { resolve } from "node:path";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { WorkerAgent } from "./agent.js";
import {
  loadOrCreateWorkerAdmissionCredential,
  workerAdmissionSigner,
} from "./admission-credential.js";
import {
  createHeadlessRuntime,
  loadHeadlessWorkerEnvironment,
} from "./headless-runtime.js";
import { probeRuntimePerformanceProfile } from "../performance/runtime-profile-probe.js";
import { probeQwen3EngineRuntimeProfile } from "../performance/engine-runtime-profile-probe.js";

const environment = loadHeadlessWorkerEnvironment();
const runtimeMetadata = readNativeRuntimeBuildMetadata(resolve(import.meta.dirname, "../.."));
const runtime = await createHeadlessRuntime(environment);
const probedDevice = runtime.physicalProbe.devices[0];
if (!probedDevice) throw new Error("headless_worker_physical_probe_missing_device");
const profileDevice = `${runtime.verifiedGpuRuntime.backend === "directml" ? "directml" : "cuda"}:${probedDevice.index}`;
const profilePrecision = runtime.verifiedGpuRuntime.backend === "directml" ? "float32" : "float16";
const detectedVramMb = Math.floor(
  Math.min(probedDevice.totalMemoryBytes, probedDevice.runtimeTotalMemoryBytes) / (1024 * 1024),
);
const workerConfig = {
  ...loadWorkerConfig(environment.configPath),
  offeredVramMb: detectedVramMb,
};
const admissionSigner = environment.workerCredentialPath
  ? workerAdmissionSigner(
      loadOrCreateWorkerAdmissionCredential(environment.workerCredentialPath),
    )
  : undefined;
const agent = new WorkerAgent(workerConfig, {
  coordinatorUrl: environment.coordinatorUrl,
  identity: { kind: "device", id: environment.nodeId },
  ...(environment.networkToken ? { networkToken: environment.networkToken } : {}),
  ...(admissionSigner ? { admissionSigner } : {}),
  reconnect: true,
  advertiseDeployment: false,
  agentVersion: runtimeMetadata.version,
  ...(runtimeMetadata.buildIdentity ? { buildIdentity: runtimeMetadata.buildIdentity } : {}),
  verifiedGpuRuntime: runtime.verifiedGpuRuntime,
  preferredHardwareGpu: runtime.preferredHardwareGpu,
  hardwareCapacityOverride: {
    id: `physical-${probedDevice.index}`,
    vendor: runtime.preferredHardwareGpu.vendor,
    model: probedDevice.name,
    physicalVramMb: detectedVramMb,
  },
  distributedExecutor: runtime.executor,
  runtimePerformanceProfileProbe: () => probeRuntimePerformanceProfile({
    pythonExecutable: environment.pythonExecutable,
    pythonPath: [environment.pythonPath],
    backend: runtime.verifiedGpuRuntime.backend,
    device: profileDevice,
    precision: profilePrecision,
    expectedDeviceName: runtime.verifiedGpuRuntime.deviceName,
    cwd: process.cwd(),
    env: { HF_HOME: environment.cachePath },
  }),
  engineRuntimeProfileProbe: (challenge) => probeQwen3EngineRuntimeProfile(
    challenge,
    {
      pythonExecutable: environment.pythonExecutable,
      pythonPath: [environment.pythonPath],
      device: profileDevice,
      precision: profilePrecision,
      cwd: process.cwd(),
      env: { HF_HOME: environment.cachePath },
    },
  ),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void agent.stop());
}

await agent.start();
