/** Coalesce presentation only. Callers still reduce every durable event in order. */
export function createFramePublisher<T>(
  present: (value: T) => void,
  schedule: (callback: FrameRequestCallback) => number = (callback) =>
    requestAnimationFrame(callback),
  unschedule: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frame: number | null = null;
  let pending: { value: T } | undefined;
  const cancel = () => {
    if (frame !== null) unschedule(frame);
    frame = null;
    pending = undefined;
  };
  return {
    publish(value: T, deferred = false) {
      if (!deferred) {
        cancel();
        present(value);
        return;
      }
      pending = { value };
      if (frame !== null) return;
      frame = schedule(() => {
        frame = null;
        const next = pending;
        pending = undefined;
        if (next) present(next.value);
      });
    },
    cancel,
  };
}
