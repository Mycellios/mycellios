import { expect, it } from "vitest";
import { routineThreadPath } from "./routine-thread-path.js";

it("opens private routine work in its thread while retaining legacy and group history links", () => {
  const run = { botId: "mico", groupId: null, messageId: "message" };
  expect(routineThreadPath(run)).toBe("/app/mico?m=message");
  expect(routineThreadPath({ ...run, taskThreadId: "private" })).toBe("/app/mico?m=message&task=private");
  expect(routineThreadPath({ ...run, messageId: null, taskThreadId: "private" })).toBe("/app/mico?task=private");
  expect(routineThreadPath({ ...run, groupId: "group", taskThreadId: "private" })).toBe("/app/g/group?m=message");
  expect(routineThreadPath({ ...run, messageId: null })).toBeNull();
});
