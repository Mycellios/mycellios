import { describe, expect, it } from "vitest";
import { historyAcrossAllowed } from "./history-access.js";

const run = { botId: "bot", trigger: "user", routineId: null };
const main = { botId: "bot", groupId: null, externalConversationId: null, taskBotId: null, projectKey: null, taskKey: null };
const side = (taskKey: string, projectKey = "mico:bot") => ({
  botId: null,
  groupId: null,
  externalConversationId: null,
  taskBotId: "bot",
  projectKey,
  taskKey,
});
const options = { messagingChannelRun: false };

describe("historyAcrossAllowed", () => {
  it("reaches across from the Mico's main chat and its ordinary side conversations", () => {
    expect(historyAcrossAllowed(run, main, options)).toBe(true);
    expect(historyAcrossAllowed(run, side("mico-task:bot:person"), options)).toBe(true);
    expect(historyAcrossAllowed({ ...run, trigger: "agent_task" }, side("mico-task:bot:agent:key"), options)).toBe(true);
    expect(historyAcrossAllowed({ ...run, trigger: "task_report" }, main, options)).toBe(true);
  });

  it("keeps routine, delegated and project threads, groups and outside chats to their own conversation", () => {
    expect(historyAcrossAllowed(run, side("routine:r1", "routine:r1"), options)).toBe(false);
    expect(historyAcrossAllowed(run, side("delegation:d1", "work:bot"), options)).toBe(false);
    expect(historyAcrossAllowed(run, side("p1", "project:p1"), options)).toBe(false);
    expect(historyAcrossAllowed(run, { ...main, botId: null, groupId: "group" }, options)).toBe(false);
    expect(historyAcrossAllowed(run, { ...main, externalConversationId: "chat" }, options)).toBe(false);
  });

  it("never reaches across for unattended, intro, background or messaging-channel runs, or another Mico's chat", () => {
    for (const trigger of ["routine", "workflow", "webhook", "created", "tickets", "project_prepare"])
      expect(historyAcrossAllowed({ ...run, trigger }, main, options), trigger).toBe(false);
    expect(historyAcrossAllowed({ ...run, routineId: "routine" }, main, options)).toBe(false);
    expect(historyAcrossAllowed(run, main, { messagingChannelRun: true })).toBe(false);
    expect(historyAcrossAllowed({ ...run, botId: "other" }, main, options)).toBe(false);
    expect(historyAcrossAllowed({ ...run, botId: "other" }, side("mico-task:bot:person"), options)).toBe(false);
  });
});
