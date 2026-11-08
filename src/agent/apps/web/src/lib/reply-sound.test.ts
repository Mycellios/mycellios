import { describe, expect, it, vi } from "vitest";
import { createReplySoundGate, playReplySound, unlockReplySound } from "./reply-sound";

describe("reply sound", () => {
  it("announces only a new persisted reply whose run completed, once", () => {
    const check = createReplySoundGate();
    const reply = { threadId: "chat", runId: "run", type: "thread.message.created", seq: 8, payload: { role: "bot" } } as const;
    const completed = { ...reply, type: "run.completed", seq: 9 } as const;
    expect(check(reply, "other-chat", 7)).toBe(false);
    expect(check(reply, "chat", 8)).toBe(false);
    expect(check(completed, "chat", 7)).toBe(false);
    expect(check(reply, "chat", 7)).toBe(false);
    expect(check({ ...completed, type: "run.failed" }, "chat", 7)).toBe(false);
    expect(check(completed, "chat", 7)).toBe(false);
    expect(check(reply, "chat", 7)).toBe(false);
    expect(check(completed, "chat", 7)).toBe(true);
    expect(check(completed, "chat", 7)).toBe(false);
  });

  it("plays a short descending cue on the unlocked audio output", () => {
    const ramp = vi.fn();
    const stop = vi.fn();
    const start = vi.fn();
    const gain = {
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    vi.stubGlobal("AudioContext", class {
      state = "running";
      currentTime = 1;
      createGain = () => gain;
      createOscillator = () => ({
        connect: () => gain,
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: ramp },
        start,
        stop,
      });
    });
    try {
      unlockReplySound();
      playReplySound();
      expect(start).toHaveBeenCalledOnce();
      expect(ramp).toHaveBeenCalledWith(185, 1.15);
      expect(stop).toHaveBeenCalledWith(1.2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
