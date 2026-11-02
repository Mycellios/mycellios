export interface StartupOptions { independentParallelStartup?: boolean; rootStartupDelayMs?: number }

export function normalizeStartupPolicy(options: { independentParallelStartup?: boolean | undefined; rootStartupDelayMs?: number | undefined }): StartupOptions {
  if (options.independentParallelStartup !== undefined && typeof options.independentParallelStartup !== "boolean") {
    throw new Error("launch_parallel_startup_invalid");
  }
  const delay = options.rootStartupDelayMs;
  if (delay !== undefined && (!Number.isInteger(delay) || delay < 0 || delay > 60_000
      || (delay > 0 && options.independentParallelStartup !== true))) throw new Error("launch_root_startup_delay_invalid");
  return options.independentParallelStartup === true
    ? { independentParallelStartup: true, ...(delay ? { rootStartupDelayMs: delay } : {}) } : {};
}

export function resolveStartupPolicy(sealed: StartupOptions, supplied: StartupOptions): boolean {
  normalizeStartupPolicy(supplied);
  if (supplied.rootStartupDelayMs !== undefined && supplied.rootStartupDelayMs !== (sealed.rootStartupDelayMs ?? 0))
    throw new Error("launch_root_startup_delay_policy_mismatch");
  if (sealed.independentParallelStartup === true && supplied.independentParallelStartup === false) {
    throw new Error("launch_parallel_startup_policy_mismatch");
  }
  return sealed.independentParallelStartup === true || supplied.independentParallelStartup === true;
}
