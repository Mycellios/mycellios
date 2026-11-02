import { stagePackageBindingsSchema } from '../distribution/stage-package-bindings.js';
import type { AutoDistributionConfig } from "../distribution/auto-distribute.js";
import type { PythonLaunchConfiguration } from "../distribution/python-launcher.js";
import { normalizeTcpWritePolicy } from "../distribution/tcp-write-arguments.js";
import { normalizeStartupPolicy } from "../distribution/startup-policy.js";

export interface MeasuredRuntimePolicy {
  stagePackageIdentities?: Record<string, string> | undefined;
  tcpWriteChunkBytes?: number | undefined;
  independentParallelStartup?: boolean | undefined;
  rootStartupDelayMs?: number | undefined;
  prefillInflightChunks?: number | undefined;
}

function validatePrefillPolicy(policy: MeasuredRuntimePolicy): void {
  const value = policy.prefillInflightChunks;
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 64)) {
    throw new Error("measured_activation_prefill_policy_invalid");
  }
}

export function applyMeasuredRuntimePolicy(config: AutoDistributionConfig, policy?: MeasuredRuntimePolicy): AutoDistributionConfig {
  if (!policy) return config;
  normalizeStartupPolicy(policy); validatePrefillPolicy(policy);
  return { ...config, runtime: { ...config.runtime, ...normalizeTcpWritePolicy(policy),
    ...(policy.stagePackageIdentities === undefined ? {} : { stagePackageIdentities: stagePackageBindingsSchema.parse(policy.stagePackageIdentities) }),
    ...(policy.independentParallelStartup === undefined ? {} : { independentParallelStartup: policy.independentParallelStartup }),
    ...(policy.rootStartupDelayMs === undefined ? {} : { rootStartupDelayMs: policy.rootStartupDelayMs }),
    ...(policy.prefillInflightChunks === undefined ? {} : { prefillInflightChunks: policy.prefillInflightChunks }),
  } };
}

export function normalizedMeasuredRuntimeConfiguration(actual: PythonLaunchConfiguration, base: PythonLaunchConfiguration,
  policy?: MeasuredRuntimePolicy): PythonLaunchConfiguration {
  if (!policy) return actual;
  normalizeTcpWritePolicy(policy); normalizeStartupPolicy(policy); validatePrefillPolicy(policy);
  const result = { ...actual };
  if (policy.stagePackageIdentities !== undefined) {
    const expected = stagePackageBindingsSchema.parse(policy.stagePackageIdentities);
    const observed = stagePackageBindingsSchema.safeParse(actual.stagePackageIdentities);
    const ordered = (value: Record<string, string>) => JSON.stringify(Object.entries(value).sort());
    if (!observed.success || ordered(observed.data) !== ordered(expected)) {
      throw new Error("measured_activation_artifact_policy_mismatch");
    }
    if (base.stagePackageIdentities === undefined) delete result.stagePackageIdentities;
    else result.stagePackageIdentities = base.stagePackageIdentities;
  }
  if (policy.tcpWriteChunkBytes !== undefined) {
    if (actual.tcpWriteChunkBytes !== policy.tcpWriteChunkBytes) throw new Error("measured_activation_tcp_policy_mismatch");
    if (base.tcpWriteChunkBytes === undefined) delete result.tcpWriteChunkBytes;
    else result.tcpWriteChunkBytes = base.tcpWriteChunkBytes;
  }
  if (policy.independentParallelStartup !== undefined) {
    if ((actual.independentParallelStartup ?? false) !== policy.independentParallelStartup) throw new Error("measured_activation_startup_policy_mismatch");
    if (base.independentParallelStartup === undefined) delete result.independentParallelStartup;
    else result.independentParallelStartup = base.independentParallelStartup;
  }
  if (policy.rootStartupDelayMs !== undefined) {
    if ((actual.rootStartupDelayMs ?? 0) !== policy.rootStartupDelayMs) throw new Error("measured_activation_startup_delay_policy_mismatch");
    if (base.rootStartupDelayMs === undefined) delete result.rootStartupDelayMs;
    else result.rootStartupDelayMs = base.rootStartupDelayMs;
  }
  if (policy.prefillInflightChunks !== undefined) {
    if (actual.prefillInflightChunks !== policy.prefillInflightChunks) {
      throw new Error("measured_activation_prefill_policy_mismatch");
    }
    result.prefillInflightChunks = base.prefillInflightChunks;
  }
  return Object.fromEntries([...Object.keys(base), ...Object.keys(result).filter(key => !(key in base))]
    .map(key => [key, result[key as keyof PythonLaunchConfiguration]])) as unknown as PythonLaunchConfiguration;
}
