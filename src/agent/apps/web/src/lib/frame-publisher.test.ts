import { describe, expect, it, vi } from "vitest";
import { createFramePublisher } from "./frame-publisher";

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  const present = vi.fn();
  const publisher = createFramePublisher(
    present,
    (callback) => {
      callbacks.set(++id, callback);
      return id;
    },
    (frame) => {
      callbacks.delete(frame);
    },
  );
  const frame = () => {
    const batch = [...callbacks.values()];
    callbacks.clear();
    for (const callback of batch) callback(0);
  };
  return { publisher, present, callbacks, frame };
}

describe("thread frame presentation", () => {
  it("presents first progress immediately and one latest snapshot for a burst", () => {
    const f = fixture();
    f.publisher.publish(0);
    for (let seq = 1; seq <= 1000; seq++) f.publisher.publish(seq, true);
    expect(f.present.mock.calls).toEqual([[0]]);
    expect(f.callbacks.size).toBe(1);
    f.frame();
    expect(f.present.mock.calls).toEqual([[0], [1000]]);
  });
  it.each(["completed", "failed", "waiting_input", "stopped", "new-thread", "streaming-off"])(
    "flushes %s without waiting for a frame or allowing older progress to return",
    (state) => {
      const f = fixture();
      f.publisher.publish("old-progress", true);
      f.publisher.publish(state);
      f.frame();
      expect(f.present.mock.calls).toEqual([[state]]);
    },
  );
  it("cancels pending work on unmount and remains reusable during StrictMode cleanup", () => {
    const f = fixture();
    f.publisher.publish("old", true);
    f.publisher.cancel();
    f.frame();
    expect(f.present).not.toHaveBeenCalled();
    f.publisher.publish(null, true);
    f.frame();
    expect(f.present).toHaveBeenCalledExactlyOnceWith(null);
  });
});
