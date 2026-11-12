import { describe, expect, it } from "vitest";
import { MessageBlock } from "@rakazo/contracts";
import { askUserQuestionnaire } from "./ask-user-questionnaire.js";

describe("shared agent questionnaire", () => {
  it("preserves legacy choice IDs and the event shape used by continuations", () => {
    expect(askUserQuestionnaire({ question: "Where?", options: ["Paris", "London"] })).toEqual({
      text: "Where?", actions: [{ id: "choice-1", label: "Paris" }, { id: "choice-2", label: "London" }],
    });
  });
  it("carries descriptions, multiple selection and a grouped free-text question into persisted blocks", () => {
    const result = askUserQuestionnaire({ question: "Your trip", questions: [
      { question: "Where?", options: [{ label: "Paris", description: "Museums and food" }, "London"], multiSelect: true },
      { question: "When?" },
    ] });
    const block = MessageBlock.parse({ kind: "ask", ...result, status: "pending" });
    expect(block.kind === "ask" && block.questions?.[0]?.options[0]?.description).toBe("Museums and food");
    expect(result.questions?.[1]?.options).toEqual([]);
    expect(result.questions?.[0]?.multiSelect).toBe(true);
  });
  it("supports one free-text question without inventing options", () => {
    expect(askUserQuestionnaire({ question: "What time?" }).questions?.[0]?.options).toEqual([]);
  });
  it.each([
    { question: "Where?", options: [] },
    { question: "Where?", options: ["Paris", "Paris"] },
    { question: "Where?", options: ["Paris", "x".repeat(81)] },
    { question: "Where?", questions: [] },
    { question: "Where?", questions: Array.from({ length: 4 }, () => ({ question: "Where?" })) },
    { question: "Where?", questions: [{ id: "same", question: "One?" }, { id: "same", question: "Two?" }] },
    { question: "x".repeat(241) },
  ])("rejects malformed or unbounded forms: %j", args => {
    expect(() => askUserQuestionnaire(args)).toThrow();
  });
});
