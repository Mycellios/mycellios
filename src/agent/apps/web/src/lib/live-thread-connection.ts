export const LIVE_THREAD_DISCONNECT_MS = 5_000;

type LiveThreadState = "live" | "reconnecting";

let state: LiveThreadState = "live";
let disconnectedAt: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setLiveThreadConnection(next: LiveThreadState, now = Date.now()): void {
  if (next === "live") {
    if (state === "live" && disconnectedAt === null) return;
    state = "live";
    disconnectedAt = null;
  } else {
    if (state === "reconnecting") return;
    state = "reconnecting";
    disconnectedAt = now;
  }
  emit();
}

export function subscribeLiveThreadConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveThreadDisconnected(now = Date.now(), threshold = LIVE_THREAD_DISCONNECT_MS): boolean {
  return disconnectedAt !== null && now - disconnectedAt >= threshold;
}

export function resetLiveThreadConnection(): void {
  state = "live";
  disconnectedAt = null;
  emit();
}
