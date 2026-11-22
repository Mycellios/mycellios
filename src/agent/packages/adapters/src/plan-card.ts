import type { ConnectorTool } from "@mycellios/adapter-kit";
import { PLAN_ALTERNATIVE, PLAN_CANCEL, PLAN_CARD_TOOL, PLAN_START } from "@mycellios/core";
import { z } from "zod";

const PlanCardArgs = z.object({
  message: z.string().trim().min(1).max(240),
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(24),
    step: z.string().trim().min(1).max(200),
  })).min(1).max(4),
  alternative: z.string().trim().min(1).max(80).optional(),
});

/** Offered only when the Mico's "Show a plan before long tasks" preference is on, in user runs. */
export const planCardTool: ConnectorTool = {
  name: PLAN_CARD_TOOL,
  description:
    "Before a long task, such as a fix, a build, research or a change across many files, show the user one card with a short acknowledgement and your plan, then wait for the answer. Call it first, before any other tool, when the work will take more than about a minute. Do not call it for a quick answer, a question, a small change, a routine run or work the user already approved in this chat. The card offers Start, an optional alternative and Cancel, and starts by itself when nobody answers within a few seconds. The result says what to do next. Write in the user's language.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", maxLength: 240, description: "One short sentence: you are on it and what the work is." },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            label: { type: "string", maxLength: 24, description: "A short label such as First or Then." },
            step: { type: "string", maxLength: 200, description: "What you will do, in one line." },
          },
          required: ["label", "step"],
          additionalProperties: false,
        },
      },
      alternative: { type: "string", maxLength: 80, description: "Optional: a smaller or different option the user can choose instead." },
    },
    required: ["message", "steps"],
    additionalProperties: false,
  },
};

/** The ask event a plan card pauses on: the acknowledgement, its steps and fixed answers. */
export function planCardQuestionnaire(args: Record<string, unknown>) {
  const parsed = PlanCardArgs.parse(args);
  return {
    text: parsed.message,
    actions: [
      { id: PLAN_START, label: "Start" },
      ...(parsed.alternative ? [{ id: PLAN_ALTERNATIVE, label: parsed.alternative }] : []),
      { id: PLAN_CANCEL, label: "Cancel" },
    ],
    plan: { steps: parsed.steps.map(({ label, step }) => ({ label, text: step })) },
  };
}
