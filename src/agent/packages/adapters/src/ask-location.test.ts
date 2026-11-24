import { describe, expect, it } from "vitest";
import { isPausingAskTool, pausingQuestionnaire } from "./ask-user-questionnaire.js";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectBuiltinToolsForRun } from "./executor.js";

function offered(overrides: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]> = {}) {
  return selectBuiltinToolsForRun({
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
    ...overrides,
  }).some((tool) => tool.name === "ask_location");
}

describe("ask_location", () => {
  it("is a built-in tool with a short reason", () => {
    const tool = builtinAgentTools.find((candidate) => candidate.name === "ask_location");
    expect(tool?.inputSchema).toMatchObject({ required: ["reason"], additionalProperties: false });
  });

  it("is offered only to turns the person started in the chat", () => {
    expect(offered()).toBe(true);
    expect(offered({ groupId: "group-1" })).toBe(true);
    expect(offered({ trigger: "follow_up", followUpFromUser: true })).toBe(true);
    for (const trigger of [
      "routine",
      "webhook",
      "tickets",
      "project_prepare",
      "bot_message",
      "agent_task",
      "created",
      "call_end",
      "messaging",
    ])
      expect(offered({ trigger }), trigger).toBe(false);
    expect(offered({ trigger: "follow_up", followUpFromUser: false })).toBe(false);
    expect(offered({ messagingChannelRun: true })).toBe(false);
    expect(offered({ voiceCall: true })).toBe(false);
    expect(offered({ disabledBuiltinTools: ["ask_location"] })).toBe(false);
  });

  it("pauses the turn on a location card that carries only the reason", () => {
    expect(isPausingAskTool("ask_location")).toBe(true);
    expect(
      pausingQuestionnaire("ask_location", { reason: "  To find restaurants near you.  " }),
    ).toEqual({
      text: "To find restaurants near you.",
      location: true,
    });
    expect(() => pausingQuestionnaire("ask_location", { reason: " " })).toThrow();
  });
});
