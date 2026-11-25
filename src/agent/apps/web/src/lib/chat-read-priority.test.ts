import { afterEach, describe, expect, it, vi } from "vitest";
import { prioritizeChatHistory, waitForSecondaryChatRead } from "./chat-read-priority";

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

describe("cold chat read priority", () => {
  it("holds secondary controls through the first paint without delaying history or writes", async () => {
    vi.useFakeTimers();
    const finish = prioritizeChatHistory();
    const background = vi.fn();
    void waitForSecondaryChatRead("models/list")?.then(background);

    for (const procedure of [
      "bootstrap", "threads/get", "threads/messages", "threads/head", "threads/subscribe",
      "threads/send", "threads/answer", "bots/update", "spaces/list",
    ]) {
      expect(waitForSecondaryChatRead(procedure)).toBeUndefined();
    }
    finish();
    await vi.advanceTimersByTimeAsync(249);
    expect(background).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(background).toHaveBeenCalledOnce();
    expect(waitForSecondaryChatRead("models/list")).toBeUndefined();
  });

  it("keeps a rapid switch together but releases at the original deadline", async () => {
    vi.useFakeTimers();
    const leaveFirst = prioritizeChatHistory();
    const background = vi.fn();
    void waitForSecondaryChatRead("tasks/overview")?.then(background);
    leaveFirst();
    await vi.advanceTimersByTimeAsync(200);
    const leaveSecond = prioritizeChatHistory();
    await vi.advanceTimersByTimeAsync(3_299);
    expect(background).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(background).toHaveBeenCalledOnce();
    leaveSecond();
    expect(waitForSecondaryChatRead("tasks/overview")).toBeUndefined();
  });

  it("rejects an aborted read while it is held", async () => {
    vi.useFakeTimers();
    const finish = prioritizeChatHistory();
    const controller = new AbortController();
    const result = waitForSecondaryChatRead("threads/queueState", controller.signal);
    const failure = new DOMException("Conversation left", "AbortError");

    const rejected = expect(result).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    await expect(waitForSecondaryChatRead("me", controller.signal)).rejects.toBe(failure);
    finish();
  });
});
