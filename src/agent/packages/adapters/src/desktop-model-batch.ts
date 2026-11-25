/**
 * One Desktop model read crosses the PC relay, so each read costs a full round trip.
 * Every stream event carries the whole partial message, which makes the events of a
 * long tool call (a file being written) tens of kilobytes each. A read therefore
 * merges consecutive deltas of one content block and answers with everything already
 * buffered, instead of a fixed handful of events per round trip.
 */
const MERGEABLE = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);
/** Bounds one read's result; the relay itself carries up to HOST_COMPUTER_MAX_BYTES. */
export const MODEL_BATCH_MAX_BYTES = 2 * 1024 * 1024;
export const MODEL_BATCH_MAX_EVENTS = 64;
/** After the first event, how long a read keeps collecting before it answers. */
export const MODEL_BATCH_WINDOW_MS = 20;

type StreamEvent = { type?: unknown; contentIndex?: unknown; delta?: unknown };

/**
 * Appends `event`, merging it into the previous one when both are deltas of the same
 * content block. The merged delta keeps the later partial message, which already
 * holds every earlier delta.
 */
export function appendModelEvent(events: unknown[], event: unknown): void {
  const next = event as StreamEvent;
  const last = events.at(-1) as StreamEvent | undefined;
  if (
    last &&
    next &&
    typeof next.type === "string" &&
    MERGEABLE.has(next.type) &&
    last.type === next.type &&
    last.contentIndex === next.contentIndex &&
    typeof last.delta === "string" &&
    typeof next.delta === "string"
  ) {
    events[events.length - 1] = { ...next, delta: last.delta + next.delta };
    return;
  }
  events.push(event);
}

export type ModelBatch =
  | { events: unknown[]; done: false }
  | { events: unknown[]; done: true; result: unknown };
export type ModelBatchState = {
  /** An unread `next()`, kept across reads. */
  pending?: Promise<IteratorResult<unknown>>;
  /** Events held back by the byte bound; they open the next batch. */
  carried?: unknown[];
  /** The stream ended while events were still held back. */
  finished?: { result: unknown };
};

/** Reads one batch from a model event stream. */
export async function readModelBatch(
  iterator: AsyncIterator<unknown>,
  state: ModelBatchState,
  finish: () => Promise<unknown>,
  limits: { windowMs?: number; maxBytes?: number; maxEvents?: number } = {},
): Promise<ModelBatch> {
  const windowMs = limits.windowMs ?? MODEL_BATCH_WINDOW_MS;
  const maxBytes = limits.maxBytes ?? MODEL_BATCH_MAX_BYTES;
  const maxEvents = limits.maxEvents ?? MODEL_BATCH_MAX_EVENTS;
  const events: unknown[] = [];
  for (const event of state.carried?.splice(0) ?? []) appendModelEvent(events, event);
  let ended = state.finished;
  state.finished = undefined;
  if (!ended) {
    const deadline = Date.now() + windowMs;
    while (events.length < maxEvents) {
      state.pending ??= iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = events.length
        ? await Promise.race([
            state.pending,
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
            }),
          ]).finally(() => clearTimeout(timer))
        : await state.pending;
      if (next === null) break;
      state.pending = undefined;
      if (next.done) {
        ended = { result: await finish() };
        break;
      }
      appendModelEvent(events, next.value);
      if (Date.now() >= deadline) break;
    }
  }
  // Events share one live partial message, so size the batch once, as it will be sent.
  // Hold back trailing events (never the first) until it fits.
  const sizes = events.map((event) => Buffer.byteLength(JSON.stringify(event)));
  let total = sizes.reduce((sum, size) => sum + size, 0);
  const held: unknown[] = [];
  while (events.length > 1 && total > maxBytes) {
    held.unshift(events.pop());
    total -= sizes.pop()!;
  }
  if (held.length) {
    state.carried = held;
    state.finished = ended;
    return { events, done: false };
  }
  return ended ? { events, done: true, result: ended.result } : { events, done: false };
}
