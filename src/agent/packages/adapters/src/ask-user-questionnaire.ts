import { AgentQuestions } from "@mycellios/contracts";
import { PLAN_CARD_TOOL } from "@mycellios/core";
import { planCardQuestionnaire } from "./plan-card.js";

/** Same form payload for API and native models; old string choices remain compatible. */
export function askUserQuestionnaire(args: Record<string, unknown>) {
  if (args.questions !== undefined) {
    if (!Array.isArray(args.questions)) throw new Error("ask_user questions must be an array");
    const questions = AgentQuestions.parse(args.questions.map((raw, index) => {
      if (!raw || typeof raw !== "object") throw new Error("ask_user requires question objects");
      const question = raw as Record<string, unknown>;
      return { ...question, id: question.id ?? `question-${index + 1}`,
        options: normalizeOptions(question.options ?? []) };
    }));
    return { text: typeof args.question === "string" && args.question.trim() ? args.question : questions[0]!.question, questions };
  }
  const options = normalizeOptions(args.options ?? []);
  // Explicit empty or single choice lists are usually a malformed tool call.
  if (args.options !== undefined && options.length < 2)
    throw new Error("ask_user requires two to four unique, non-empty options");
  const questions = AgentQuestions.parse([{ id: "question-1", question: args.question,
    options, ...(args.multiSelect === true ? { multiSelect: true } : {}) }]);
  const actions = options.map(({ id, label }) => ({ id, label }));
  // Keep the old event shape for simple choices and existing continuation receipts.
  return { text: questions[0]!.question, ...(actions.length ? { actions } : {}),
    ...(options.some(option => option.description) || args.multiSelect === true || !options.length ? { questions } : {}) };
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) throw new Error("ask_user options must be an array");
  return value.map((raw, index) => {
    const option = typeof raw === "string" ? { label: raw.trim() } : raw;
    if (!option || typeof option !== "object") throw new Error("ask_user requires valid options");
    return { ...(option as Record<string, unknown>), id: `choice-${index + 1}` } as {
      id: string; label: string; description?: string;
    };
  });
}

const PAUSING_ASK_TOOLS = new Set(["ask_user", PLAN_CARD_TOOL]);

/** Tools that pause the turn on a card until the user answers. */
export function isPausingAskTool(name: string): boolean {
  return PAUSING_ASK_TOOLS.has(name);
}

/** The ask event for a pausing tool: an ask_user form or a plan card. */
export function pausingQuestionnaire(name: string, args: Record<string, unknown>) {
  return name === PLAN_CARD_TOOL ? planCardQuestionnaire(args) : askUserQuestionnaire(args);
}
