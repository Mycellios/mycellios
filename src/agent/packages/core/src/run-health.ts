/** Presentation only: absence of output never cancels or retries execution. */
export type HealthRun = {
  id: string;
  botId: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  updatedAt?: string;
  leaseExpiresAt?: string | null;
  wakeAt?: string | null;
  observedAt?: string;
};
export type RunHealthState =
  | "idle"
  | "waiting"
  | "queued"
  | "blocked"
  | "starting"
  | "recovering"
  | "running"
  | "quiet"
  | "unknown";
const date = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);

export function runHealth(
  run: HealthRun,
  options: { now: number; missingComputer?: boolean; lastOutputAt?: string | null },
) {
  const { now, missingComputer = false, lastOutputAt = null } = options;
  const start = Number.isFinite(date(run.startedAt)) ? date(run.startedAt) : date(run.createdAt);
  const elapsedMs = Number.isFinite(start) ? Math.max(0, now - start) : 0;
  const outputAgeMs = Number.isFinite(date(lastOutputAt))
    ? Math.max(0, now - date(lastOutputAt))
    : null;
  let state: RunHealthState;
  if (["completed", "failed", "cancelled"].includes(run.status)) state = "idle";
  else if (["waiting_input", "waiting_takeover"].includes(run.status)) state = "waiting";
  else if (!run.startedAt && missingComputer) state = "blocked";
  else if (run.status === "queued" || date(run.wakeAt) > now) state = "queued";
  else if (!run.startedAt) state = "starting";
  else if (!Number.isFinite(date(run.leaseExpiresAt))) state = "unknown";
  else if (date(run.leaseExpiresAt) <= now) state = "recovering";
  else state = (outputAgeMs ?? elapsedMs) >= 5 * 60_000 ? "quiet" : "running";
  return { state, elapsedMs, outputAgeMs, lastSignalAt: run.updatedAt ?? null, lastOutputAt };
}

export function lastRunOutput(
  run: HealthRun,
  messages: ReadonlyArray<{ role: string; createdAt: string; runId?: string; botId?: string }>,
) {
  return messages
    .filter(
      (m) =>
        m.role === "bot" &&
        (m.runId === run.id ||
          (!m.runId && m.botId === run.botId && date(m.createdAt) >= date(run.createdAt))),
    )
    .reduce<string | null>(
      (last, m) => (!last || date(m.createdAt) > date(last) ? m.createdAt : last),
      null,
    );
}
