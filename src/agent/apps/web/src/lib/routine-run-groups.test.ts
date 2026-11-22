import type { RoutineRunOutcome, ThreadMessage } from "@mycellios/contracts";
import type { ThreadItem } from "@mycellios/core";
import { expect, it } from "vitest";
import { routineRunGroups } from "./routine-run-groups";

const at = new Date(0).toISOString();
const marker = (
  id: string,
  routineId: string,
  outcome: RoutineRunOutcome = "reported",
): ThreadItem<ThreadMessage> => ({
  kind: "message",
  message: {
    id,
    threadId: "main",
    seq: 1,
    role: "system",
    createdAt: at,
    blocks: [
      {
        kind: "routine_run",
        fromBotId: "mico",
        routineId,
        routineName: `Routine ${routineId}`,
        taskId: `thread-${routineId}`,
        runId: `run-${id}`,
        status: outcome,
      },
    ],
  },
});
const reply = (id: string): ThreadItem<ThreadMessage> => ({
  kind: "message",
  message: {
    id,
    threadId: "main",
    seq: 1,
    role: "bot",
    createdAt: at,
    blocks: [{ kind: "text", text: "Done." }],
  },
});

it("folds consecutive runs of one routine into one line, quiet runs included", () => {
  const groups = routineRunGroups([
    marker("a", "r1"),
    marker("b", "r1", "quiet"),
    marker("c", "r1", "failed"),
    reply("d"),
  ]);
  const group = groups.get("a");
  expect(group?.key).toBe("a");
  expect(group?.memberIds).toEqual(["a", "b", "c"]);
  expect(group?.runs.map((run) => run.block.status)).toEqual(["reported", "quiet", "failed"]);
  expect(groups.get("c")).toBe(group);
  expect(groups.has("d")).toBe(false);
});

it("starts a new line for another routine or after any other message", () => {
  const groups = routineRunGroups([
    marker("a", "r1"),
    marker("b", "r2"),
    marker("c", "r1"),
    reply("d"),
    marker("e", "r1"),
    marker("f", "r1"),
  ]);
  expect(groups.get("a")?.memberIds).toEqual(["a"]);
  expect(groups.get("b")?.memberIds).toEqual(["b"]);
  expect(groups.get("c")?.memberIds).toEqual(["c"]);
  expect(groups.get("e")?.memberIds).toEqual(["e", "f"]);
  expect(groups.get("e")).toBe(groups.get("f"));
});

it("leaves ordinary messages ungrouped", () => {
  expect(routineRunGroups([reply("a"), reply("b")]).size).toBe(0);
});
