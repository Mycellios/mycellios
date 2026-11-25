/** How many native CLI processes one PC runs for turns at once (specs/native-engines/spec.md phase 4). */
export const NATIVE_PROCESS_LIMIT = 6;

/** The status a native turn shows while every slot on its PC is taken. */
export function nativeProcessWaitText(limit: number) {
  const running = limit === 1 ? "1 agent engine turn is" : `${limit} agent engine turns are`;
  return `Waiting for this PC: ${running} already running on it. This one starts when one finishes.`;
}

/**
 * Bounds the CLI processes that native turns run at once on one computer. A turn above the bound
 * waits for a slot, first come first served, instead of failing; a turn stopped while it waits
 * leaves the line without taking one. Each slot is released once, when its turn ends.
 */
export class NativeProcessSlots {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit = NATIVE_PROCESS_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid native process limit");
  }

  /** Turns holding a slot and turns waiting for one. */
  get state() {
    return { running: this.running, waiting: this.waiting.length };
  }

  /**
   * Resolves with the release for a free slot. `onWait` runs once when the turn has to wait.
   * Rejects without a slot when the signal aborts first.
   */
  async acquire(signal: AbortSignal, onWait?: () => void): Promise<() => void> {
    signal.throwIfAborted();
    if (this.running < this.limit && !this.waiting.length) {
      this.running += 1;
      return this.release();
    }
    onWait?.();
    await new Promise<void>((resolve, reject) => {
      const granted = () => {
        signal.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        signal.removeEventListener("abort", aborted);
        const index = this.waiting.indexOf(granted);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("The turn stopped while it waited"),
        );
      };
      this.waiting.push(granted);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
    return this.release();
  }

  private release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // The slot passes straight to the next turn in line, so nobody can overtake it.
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    };
  }
}
