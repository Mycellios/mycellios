import type { NativeEngineInstallProgress, NativeEngineUpdate, NativeInstallEngine } from "@mycellios/contracts";

export const ENGINE_NAMES: Record<NativeInstallEngine, string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" };
export const INSTALL_ENGINES = Object.keys(ENGINE_NAMES) as NativeInstallEngine[];

/** What the PC reports about one CLI, and what this window remembers from its earlier reports. */
export interface EngineUpdateInput {
  engine: NativeInstallEngine;
  /** The newer version the PC offers, if any. */
  release?: NativeEngineUpdate;
  /** A running install or update, or why the last one failed. */
  progress?: NativeEngineInstallProgress;
  /** The versions of the last update this window saw offered or running, so progress and completion can name them. */
  target?: { current: string; version: string };
  /** The PC was installing or updating this CLI at the previous report. */
  wasRunning: boolean;
}

export type EngineUpdateStage = "available" | "running" | "failed" | "done";

export interface EngineUpdatePresentation {
  stage: EngineUpdateStage;
  /** "v2.1.330 → v2.1.332", or the new version alone once done. */
  versions: string | null;
  /** 0-100 while downloading with a known size; null for an unknown size or the final check. */
  percent: number | null;
  checking: boolean;
  error: string | null;
  /** The version the person can ask for (Update or Retry). */
  offer: string | null;
}

function percentOf(progress: NativeEngineInstallProgress, bytes?: number) {
  const total = progress.totalBytes ?? bytes;
  if (progress.state !== "downloading" || !total) return null;
  return Math.max(0, Math.min(100, Math.floor(((progress.receivedBytes ?? 0) / total) * 100)));
}

/**
 * Maps the PC's report on one CLI to the update notice: an offer while a newer version waits,
 * live progress while it downloads and is checked, the failure, then a short "updated" note.
 * Returns null when there is nothing to tell.
 */
export function presentEngineUpdate(input: EngineUpdateInput): EngineUpdatePresentation | null {
  const { release, progress, target, wasRunning } = input;
  const versionsOf = (from?: string, to?: string) => (from && to ? `v${from} → v${to}` : null);
  if (progress?.state === "downloading" || progress?.state === "checking") {
    const from = release?.current ?? target?.current;
    const to = release?.version ?? target?.version;
    return {
      stage: "running",
      versions: versionsOf(from, to),
      percent: percentOf(progress, release?.bytes),
      checking: progress.state === "checking",
      error: null,
      offer: null,
    };
  }
  if (progress?.state === "failed") {
    return {
      stage: "failed",
      versions: versionsOf(release?.current ?? target?.current, release?.version ?? target?.version),
      percent: null,
      checking: false,
      error: progress.error ?? null,
      offer: release?.version ?? null,
    };
  }
  if (release) {
    return {
      stage: "available",
      versions: versionsOf(release.current, release.version),
      percent: null,
      checking: false,
      error: null,
      offer: release.version,
    };
  }
  if (wasRunning) {
    return {
      stage: "done",
      versions: target ? `v${target.version}` : null,
      percent: null,
      checking: false,
      error: null,
      offer: null,
    };
  }
  return null;
}
