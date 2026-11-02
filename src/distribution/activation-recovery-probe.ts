/** Read-only health checks for a sealed native activation. No inference jobs. */
export interface RootHealthIdentity {
  model: string;
  artifactIdentity: string;
  stages: number;
  boundaries: readonly number[];
}

export type RootRecoveryState = "ready" | "recovering" | "invalid";
export type RootRecoveryProbe = (signal: AbortSignal) => Promise<RootRecoveryState>;

function validIdentity(value: unknown, expected: RootHealthIdentity): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  return health.model === expected.model
    && health.artifact_identity === expected.artifactIdentity
    && typeof health.pipeline_snapshot_identity === "string"
    && Boolean(health.pipeline_snapshot_identity.trim())
    && health.pipeline_snapshot_identity.length <= 256
    && health.stages === expected.stages
    && JSON.stringify(health.boundaries) === JSON.stringify(expected.boundaries);
}

export async function verifyRootHealth(apiBaseUrl: string,
  expected: RootHealthIdentity): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`distributed_root_health_http_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("distributed_root_health_is_invalid");
  }
  if (!validIdentity(value, expected) || value.status !== "ready") {
    throw new Error("distributed_root_health_identity_mismatch");
  }
  return value;
}

/** Closure stays inside the live launch. It exposes neither URL nor credentials. */
export function createRootRecoveryProbe(apiBaseUrl: string, expected: RootHealthIdentity,
  initialSnapshot: string, shutdownSignal?: AbortSignal): RootRecoveryProbe {
  if (!initialSnapshot.trim() || initialSnapshot.length > 256) {
    throw new Error("distributed_root_recovery_snapshot_is_invalid");
  }
  const identity = { ...expected, boundaries: [...expected.boundaries] };
  return async (signal) => {
    if (signal.aborted || shutdownSignal?.aborted) return "invalid";
    const combined = AbortSignal.any([signal, ...(shutdownSignal ? [shutdownSignal] : []), AbortSignal.timeout(30_000)]);
    try {
      const response = await fetch(`${apiBaseUrl}/health`, { signal: combined });
      if (!response.ok) return "invalid";
      const value: unknown = await response.json();
      if (combined.aborted || !validIdentity(value, identity)
          || value.pipeline_snapshot_identity !== initialSnapshot) return "invalid";
      if (value.status === "ready") return "ready";
      return value.status === "recovering" ? "recovering" : "invalid";
    } catch (error) {
      return combined.aborted || error instanceof SyntaxError ? "invalid" : "recovering";
    }
  };
}
