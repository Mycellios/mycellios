import { describe, expect, it } from "vitest";
import { taskThreadInput, taskThreadResult } from "./task-thread-scope.js";

describe("owned task conversation client", () => {
  const scope = { botId: "mico", taskThreadId: "private-task" };
  it("pins reads, sends, streams, Stop and bootstrap without mutating caller inputs", () => {
    for (const method of ["get", "head", "messages", "send", "subscribe", "stop", "retry", "prepareProject"]) {
      const input = { botId: "mico", clientNonce: "nonce" };
      expect(taskThreadInput(["threads", method], input, scope)).toEqual({ ...input, taskThreadId: "private-task" });
      expect(input).not.toHaveProperty("taskThreadId");
    }
    expect(taskThreadInput(["bootstrap"], { botId: "mico" }, scope)).toEqual({ botId: "mico", taskThreadId: "private-task" });
    expect(taskThreadInput(["bootstrap"], {}, scope)).toEqual({ botId: "mico", taskThreadId: "private-task" });
  });
  it("retains other chats, groups, settings and unscoped clients", () => {
    for (const [path, input] of [
      [["threads", "send"], { botId: "other" }],
      [["threads", "get"], { groupId: "group", botId: "mico" }],
      [["bots", "update"], { botId: "mico" }],
    ] as const) expect(taskThreadInput(path, input, scope)).toBe(input);
    const input = { botId: "mico" };
    expect(taskThreadInput(["threads", "send"], input)).toBe(input);
  });
  it("refuses a stale caller naming a different private task", () => {
    expect(() => taskThreadInput(["threads", "send"], { botId: "mico", taskThreadId: "old" }, scope)).toThrow("different task");
  });
  it("refuses an older or incorrect server's main-chat snapshot before rendering it as a private task", () => {
    const input = { botId: "mico", taskThreadId: "private-task" };
    expect(() => taskThreadResult(["bootstrap"], input, { thread: { threadId: "main" } }, scope)).toThrow("did not return this task");
    expect(() => taskThreadResult(["threads", "get"], input, { threadId: "main" }, scope)).toThrow();
    const result = { thread: { threadId: "private-task" } };
    expect(taskThreadResult(["bootstrap"], input, result, scope)).toBe(result);
    expect(taskThreadResult(["threads", "send"], input, { runId: "accepted" }, scope)).toEqual({ runId: "accepted" });
  });
});
