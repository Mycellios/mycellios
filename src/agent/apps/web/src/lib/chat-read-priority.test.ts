import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prioritizeChatHistory, runWithChatReadPriority } from "./chat-read-priority";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

const requestSignal = () => new AbortController().signal;

describe("cold chat read priority", () => {
  it("holds secondary controls through the first paint and keeps critical calls direct", async () => {
    const finish = prioritizeChatHistory();
    const background = vi.fn(async () => "models");
    const deferred = runWithChatReadPriority("models/list", requestSignal(), background);

    for (const procedure of [
      "bootstrap", "threads/get", "threads/messages", "threads/head", "threads/subscribe",
      "threads/send", "threads/answer", "bots/update", "spaces/list",
    ]) {
      const call = vi.fn(async () => procedure);
      const result = runWithChatReadPriority(procedure, requestSignal(), call);
      expect(call).toHaveBeenCalledOnce();
      await expect(result).resolves.toBe(procedure);
    }

    finish();
    await vi.advanceTimersByTimeAsync(249);
    expect(background).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(deferred).resolves.toBe("models");
  });

  it("keeps a rapid switch together but starts secondary reads by the original deadline", async () => {
    const leaveFirst = prioritizeChatHistory();
    const background = vi.fn(async () => "tasks");
    const done = runWithChatReadPriority("tasks/overview", requestSignal(), background);
    leaveFirst();
    await vi.advanceTimersByTimeAsync(200);
    const leaveSecond = prioritizeChatHistory();
    await vi.advanceTimersByTimeAsync(3_299);
    expect(background).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe("tasks");
    leaveSecond();
  });

  it("drains accumulated secondary reads two at a time, including new arrivals", async () => {
    const finish = prioritizeChatHistory();
    const complete: Array<() => void> = [];
    const background = vi.fn(() => new Promise<void>((resolve) => { complete.push(resolve); }));
    const queued = Array.from({ length: 4 }, () =>
      runWithChatReadPriority("tasks/overview", requestSignal(), background));
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(background).toHaveBeenCalledTimes(2);

    queued.push(runWithChatReadPriority("models/list", requestSignal(), background));
    expect(background).toHaveBeenCalledTimes(2);
    complete.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(background).toHaveBeenCalledTimes(3);
    complete.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(background).toHaveBeenCalledTimes(4);
    complete.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(background).toHaveBeenCalledTimes(5);
    for (const finishRead of complete) finishRead();
    await Promise.all(queued);
  });

  it("cancels queued reads before they reach the transport", async () => {
    const finish = prioritizeChatHistory();
    const controller = new AbortController();
    const read = vi.fn(async () => undefined);
    const result = runWithChatReadPriority("threads/queueState", controller.signal, read);
    const failure = new DOMException("Conversation left", "AbortError");

    const rejected = expect(result).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    await expect(runWithChatReadPriority("me", controller.signal, read)).rejects.toBe(failure);
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).not.toHaveBeenCalled();
  });
});
