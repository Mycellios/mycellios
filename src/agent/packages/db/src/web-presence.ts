import type { RealtimeFanout } from "@mycellios/adapter-kit";
import { HostedWebPresence } from "@mycellios/contracts";

/**
 * Transient "a Mico is reading or writing this app" signals. The worker publishes them
 * while it runs app_read/app_write; the owner's editor follows them. Nothing is stored.
 */
export interface WebPresence {
  notify(event: Omit<HostedWebPresence, "at">): Promise<void>;
  follow(siteId: string, signal?: AbortSignal): AsyncGenerator<HostedWebPresence>;
}

export function webPresenceTopic(siteId: string): string {
  return `web-presence:${siteId}`;
}

/** At most one signal per run in this window; a later one replaces nothing, it is dropped. */
const MIN_INTERVAL_MS = 250;
const MAX_QUEUE = 64;

export function createWebPresence(realtime?: RealtimeFanout, now = () => Date.now()): WebPresence {
  const lastByRun = new Map<string, number>();
  return {
    async notify(event) {
      if (!realtime) return;
      const key = event.runId ?? event.siteId;
      const at = now();
      if (at - (lastByRun.get(key) ?? 0) < MIN_INTERVAL_MS) return;
      lastByRun.set(key, at);
      if (lastByRun.size > 1000) {
        for (const [run, time] of lastByRun) if (at - time > 60_000) lastByRun.delete(run);
      }
      const parsed = HostedWebPresence.safeParse({ ...event, at: new Date(at).toISOString() });
      if (!parsed.success) return;
      await realtime
        .publish(webPresenceTopic(event.siteId), JSON.stringify(parsed.data))
        .catch(() => undefined);
    },
    async *follow(siteId, signal) {
      const queue: HostedWebPresence[] = [];
      const waiters = new Set<() => void>();
      const unsubscribe = realtime
        ? await realtime
            .subscribe(webPresenceTopic(siteId), (payload) => {
              let value: unknown;
              try {
                value = JSON.parse(payload);
              } catch {
                return;
              }
              const parsed = HostedWebPresence.safeParse(value);
              // The topic already names the site; a payload for another one is ignored.
              if (!parsed.success || parsed.data.siteId !== siteId) return;
              if (queue.length >= MAX_QUEUE) queue.shift();
              queue.push(parsed.data);
              for (const wake of [...waiters]) wake();
            })
            .catch(() => async () => {})
        : async () => {};
      try {
        while (!signal?.aborted) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            const wake = () => {
              waiters.delete(wake);
              signal?.removeEventListener("abort", wake);
              resolve();
            };
            waiters.add(wake);
            signal?.addEventListener("abort", wake, { once: true });
            if (signal?.aborted) wake();
          });
        }
      } finally {
        waiters.clear();
        await unsubscribe();
      }
    },
  };
}
