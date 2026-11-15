/** Serial artifact work with cancellation scoped to its owning connection. */
export class RuntimePreparationQueue {
  private generation = 0;
  private controller: AbortController | null = null;
  private tail: Promise<void> = Promise.resolve();

  run(operation: (generation: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    this.cancel("distributed_runtime_preparation_superseded");
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const work = this.tail.then(async () => {
      controller.signal.throwIfAborted();
      await operation(generation, controller.signal);
    }).finally(() => {
      if (this.controller === controller) this.controller = null;
    });
    this.tail = work.catch(() => undefined);
    return work;
  }

  cancel(reason: string): void {
    this.generation += 1;
    this.controller?.abort(new Error(reason));
    this.controller = null;
  }

  assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new Error("distributed_runtime_preparation_superseded");
  }
}
