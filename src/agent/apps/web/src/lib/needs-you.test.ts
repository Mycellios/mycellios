import { expect, it } from "vitest";
import { needsYouEntries, needsYouPath } from "./needs-you";

const bot = (id: string, status: string, waiting = 0) => ({
  id, spaceId: "space", name: id, color: "#123456", status, ...(waiting ? { conversations: { waiting } } : {}),
});

it("lists what waits for the person: answers, takeovers and conversations to review", () => {
  const entries = needsYouEntries([{ bots: [bot("idle", "idle"), bot("asks", "waiting_input", 2), bot("screen", "waiting_takeover"), bot("side", "running", 1)] },
    { bots: [bot("asks", "waiting_input")] }]);
  expect(entries.map(entry => [entry.botId, entry.action, entry.count])).toEqual([
    ["asks", "answer", 0], ["asks", "review", 2], ["screen", "takeover", 0], ["side", "review", 1],
  ]);
  expect(needsYouEntries([{ bots: [bot("idle", "idle"), bot("busy", "running")] }])).toEqual([]);
});

it("leads an answer to the question and the rest to the Mico's main chat", () => {
  expect(needsYouPath({ botId: "a b", action: "answer" })).toBe("/app/a%20b?respond=1");
  expect(needsYouPath({ botId: "mico", action: "review" })).toBe("/app/mico");
  expect(needsYouPath({ botId: "mico", action: "takeover" })).toBe("/app/mico");
});
