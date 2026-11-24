import { COMPUTER_UPDATE_STAGES, type ComputerUpdate } from "@mycellios/contracts";
import { isRetryableError, retryDelayMs } from "./retry-policy.js";

/** While an operation moves, its progress follows it closely. */
export const COMPUTER_UPDATES_ACTIVE_POLL_MS = 1_500;
/**
 * Otherwise nothing changes on its own: operations start only from an explicit action, this
 * client's own starts show at once, and a failed one waits for Dismiss or Recover. The slow check
 * only picks up operations started from another device or by a teammate.
 */
export const COMPUTER_UPDATES_IDLE_POLL_MS = 60_000;
/** A failed check with nothing moving retries sooner than the idle check. */
export const COMPUTER_UPDATES_RETRY_MS = 15_000;

/** How long to wait before the next check, from the operations just shown. */
export function computerUpdatesPollInterval(
  updates: readonly Pick<ComputerUpdate, "status">[],
): number {
  // An interrupted operation still settles on the server, so it is followed like a running one.
  return updates.some((item) => item.status !== "failed" && item.status !== "completed")
    ? COMPUTER_UPDATES_ACTIVE_POLL_MS
    : COMPUTER_UPDATES_IDLE_POLL_MS;
}

/** Shared polling and local presentation state; the server owns operation lifetime. */
export function createComputerUpdates(client: {
  list: () => Promise<ComputerUpdate[]>;
  start: (botId: string, action: "update" | "recover") => Promise<ComputerUpdate>;
  dismiss: (id: string) => Promise<unknown>;
  /** Checks wait while the app is hidden and resume as soon as it is shown again. */
  visibility?: { hidden: () => boolean; subscribe: (listener: () => void) => () => void };
}) {
  let state: { updates: ComputerUpdate[]; openId: string | null } = { updates: [], openId: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let revision = 0;
  // A check came due while hidden; the next show runs it.
  let parked = false;
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const poll = async (epoch: number) => {
    if (client.visibility?.hidden()) {
      parked = true;
      return;
    }
    parked = false;
    const stamp = revision;
    let failure: unknown;
    try {
      const updates = await client.list();
      if (epoch !== generation || stamp !== revision) return;
      if (JSON.stringify(state.updates) === JSON.stringify(updates)) return;
      state = {
        updates,
        openId: updates.some((item) => item.id === state.openId) ? state.openId : null,
      };
      emit();
    } catch (error) {
      // Keep the last known operation through transient failures; a 401 or other refusal stops
      // polling until the next watch, since asking again cannot change the answer.
      failure = error;
    } finally {
      if (epoch === generation) {
        clearTimeout(timer);
        if (failure === undefined || isRetryableError(failure)) {
          const interval = computerUpdatesPollInterval(state.updates);
          const delay =
            failure === undefined
              ? interval
              : retryDelayMs(failure, Math.min(interval, COMPUTER_UPDATES_RETRY_MS));
          timer = setTimeout(() => void poll(epoch), delay);
        }
      }
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch() {
      const epoch = ++generation;
      parked = false;
      const unsubscribe = client.visibility?.subscribe(() => {
        if (parked && epoch === generation) void poll(epoch);
      });
      void poll(epoch);
      return () => {
        generation++;
        unsubscribe?.();
        clearTimeout(timer);
        state = { updates: [], openId: null };
      };
    },
    open(id: string | null) {
      state = { ...state, openId: id };
      emit();
    },
    async start(botId: string, action: "update" | "recover" = "update") {
      const epoch = generation;
      const update = await client.start(botId, action);
      if (epoch !== generation) return;
      revision++;
      state = {
        updates: [update, ...state.updates.filter((item) => item.id !== update.id)],
        openId: update.id,
      };
      emit();
      clearTimeout(timer);
      timer = setTimeout(() => void poll(epoch), COMPUTER_UPDATES_ACTIVE_POLL_MS);
    },
    async dismiss(id: string) {
      const epoch = generation;
      await client.dismiss(id);
      if (epoch !== generation) return;
      revision++;
      state = {
        updates: state.updates.filter((item) => item.id !== id),
        openId: state.openId === id ? null : state.openId,
      };
      emit();
    },
  };
}

export function computerUpdateStages(
  action: ComputerUpdate["action"],
): readonly ComputerUpdate["stage"][] {
  return action === "recover"
    ? COMPUTER_UPDATE_STAGES.filter((stage) => stage !== "saving")
    : COMPUTER_UPDATE_STAGES;
}

export function computerUpdateNeedsAttention(update: ComputerUpdate): boolean {
  return update.status === "failed" || update.status === "interrupted";
}
