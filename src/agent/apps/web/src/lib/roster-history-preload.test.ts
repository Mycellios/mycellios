import { expect, it } from "vitest";
import { rosterHistoryPreloads } from "./roster-history-preload";

const bot = (id: string, status = "idle", waitingTaskThreadId: string | null = null) =>
  ({ kind: "bot" as const, chat: { id, status, waitingTaskThreadId } });
const group = (id: string) => ({ kind: "group" as const, chat: { id } });

const groups = [
  { spaceId: "s1", bots: [bot("pinned")] },
  { spaceId: "s1", bots: [bot("active"), group("team"), bot("pinned"), bot("waiting", "waiting_input", "task-1")] },
  { spaceId: "s2", bots: [bot("other-space")] },
  { spaceId: "s1", bots: [bot("a"), bot("b"), bot("c")] },
];

it("warms the current Space's Micos in sidebar order, skipping the open chat, groups and repeats", () => {
  expect(rosterHistoryPreloads(groups, "s1", "active")).toEqual([
    ["pinned", null], ["waiting", "task-1"], ["a", null], ["b", null],
  ]);
});

it("targets the pending task a waiting Mico's row opens, and only while it waits", () => {
  const rows = [{ spaceId: "s1", bots: [bot("w", "waiting_input", "t"), bot("idle", "idle", "stale")] }];
  expect(rosterHistoryPreloads(rows, "s1", undefined)).toEqual([["w", "t"], ["idle", null]]);
});

it("never crosses into another Space and needs a resolved Space", () => {
  expect(rosterHistoryPreloads(groups, "s2", undefined)).toEqual([["other-space", null]]);
  expect(rosterHistoryPreloads(groups, null, undefined)).toEqual([]);
  expect(rosterHistoryPreloads(groups, "s1", undefined, 0)).toEqual([]);
});
