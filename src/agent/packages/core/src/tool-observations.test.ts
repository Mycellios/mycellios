import { expect, it } from "vitest";
import { observedTools, observeToolEvent } from "./tool-observations.js";
import { projectMessages } from "./events.js";
const at = "2026-11-03T09:00:00Z";
const called = {
  type: "agent.tool.called",
  createdAt: at,
  payload: { executionId: "one", name: "shell" },
};
const command = (status: "running" | "done", output = "") => ({
  type: "computer.command",
  createdAt: at,
  payload: {
    executionId: "one",
    kind: "shell",
    command: "git status --short",
    cwd: "C:/project",
    status,
    exitCode: status === "done" ? 0 : null,
    output,
  },
});
it("joins real output and keeps a background shell running after the tool returns", () => {
  let blocks = observeToolEvent([], called);
  blocks = observeToolEvent(blocks, command("running", "working"));
  blocks = observeToolEvent(blocks, {
    ...called,
    type: "agent.tool.completed",
    payload: { ...called.payload, outcome: "succeeded", durationMs: 2000 },
  });
  expect(observedTools(blocks)[0]).toMatchObject({
    outcome: "running",
    output: "working",
    commandStartedAt: at,
  });
  blocks = observeToolEvent(blocks, {
    ...command("done", " M app.ts"),
    createdAt: "2026-11-03T09:02:00Z",
  });
  expect(observedTools(blocks)[0]).toMatchObject({
    outcome: "succeeded",
    commandStatus: "done",
    exitCode: 0,
    commandFinishedAt: "2026-11-03T09:02:00Z",
    output: " M app.ts",
  });
  expect(observeToolEvent(blocks, command("running"))).toEqual(blocks);
});
it("bounds actual command output, preserves empty results and never infers a history start", () => {
  const blocks = observeToolEvent([], command("done", "x".repeat(14000)));
  expect(observedTools(blocks)[0].output).toHaveLength(12000);
  expect(observedTools(blocks)[0].commandStartedAt).toBeUndefined();
  expect(observedTools(observeToolEvent([], command("done")))[0].output).toBe("");
  expect(
    observeToolEvent([], {
      ...command("done"),
      payload: { executionId: "one", output: "untrusted" },
    }),
  ).toEqual([]);
});
it("projects command events and never recreates a terminal run from late output", () => {
  const base = { id: "e", seq: 1, runId: "run", botId: "bot", threadId: "thread" };
  const start = { ...base, ...command("running") };
  const done = { ...base, ...command("done", "ok"), seq: 3 };
  expect(observedTools(projectMessages([start, done])[0].blocks)[0].output).toBe("ok");
  expect(
    projectMessages([
      start,
      { ...base, type: "run.completed", payload: {}, createdAt: at, seq: 2 },
      done,
    ]),
  ).toEqual([]);
});
it("retains bounded execution observations, command details and explicit completion errors", () => {
  let blocks = observeToolEvent([], called);
  blocks = observeToolEvent(blocks, {
    type: "thread.progress",
    createdAt: at,
    payload: { activity: true, text: "Running: npm test" },
  });
  blocks = observeToolEvent(blocks, {
    type: "agent.tool.completed",
    createdAt: at,
    payload: {
      executionId: "one",
      name: "shell",
      outcome: "error",
      durationMs: 1200,
      error: "Tests failed",
    },
  });
  expect(observedTools(blocks)).toEqual([
    {
      id: "one",
      name: "shell",
      outcome: "error",
      durationMs: 1200,
      error: "Tests failed",
      detail: "Running: npm test",
      updatedAt: at,
    },
  ]);
  expect(observedTools(observeToolEvent(blocks, called))[0].outcome).toBe("error");
  for (let index = 0; index < 30; index++)
    blocks = observeToolEvent(blocks, {
      ...called,
      payload: { executionId: String(index), name: "shell" },
    });
  expect(observedTools(blocks)).toHaveLength(16);
});
it("keeps a called label until a later activity line replaces it", () => {
  const blocks = observeToolEvent([], {
    ...called,
    payload: { ...called.payload, label: "Running: git status" },
  });
  expect(observedTools(blocks)[0]?.detail).toBe("Running: git status");
  const again = observeToolEvent(blocks, called);
  expect(observedTools(again)[0]?.detail).toBe("Running: git status");
});
it("does not interpret arbitrary result bodies, absent identities or unknown outcomes", () => {
  expect(observeToolEvent([], { ...called, payload: { name: "shell" } })).toEqual([]);
  expect(
    observeToolEvent([], {
      ...called,
      type: "agent.tool.completed",
      payload: {
        executionId: "one",
        name: "shell",
        outcome: "unknown",
        result: { token: "private" },
      },
    }),
  ).toEqual([]);
});
it("projects called/completed audits into the matching live run and keeps legacy steps", () => {
  const events = [
    called,
    {
      ...called,
      type: "agent.tool.completed",
      payload: { ...called.payload, outcome: "succeeded", durationMs: 0 },
    },
  ].map((event, index) => ({
    ...event,
    id: `e${index}`,
    seq: index + 1,
    runId: "run",
    botId: "bot",
    threadId: "thread",
  }));
  const projected = projectMessages(events);
  expect(projected[0].runId).toBe("run");
  expect(observedTools(projected[0].blocks)[0]).toMatchObject({
    outcome: "succeeded",
    durationMs: 0,
  });
});
