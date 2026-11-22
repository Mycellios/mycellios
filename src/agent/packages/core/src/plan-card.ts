/**
 * The plan card: before a long task a Mico shows a one-line acknowledgement and up to four steps,
 * and waits for Start, an alternative or Cancel. When nobody answers within the wait, the server
 * presses Start. The behavior follows the reference app's acknowledgement card (a behavior reference only);
 * these names and texts are our own.
 */
export const PLAN_CARD_TOOL = "acknowledge_request";
export const PLAN_START = "start";
export const PLAN_ALTERNATIVE = "alternative";
export const PLAN_CANCEL = "cancel";

/** The answer a question card sends when the user skips it. */
const SKIPPED = /^(?:skip(?:ped)?|\[question skipped\b[^\]]*\])$/i;

/** What the Mico reads when its plan card is answered: one plain instruction for each outcome. */
export function planCardResumeText(input: {
  choiceId?: string;
  choiceLabel?: string;
  answer: string;
  autoStarted?: boolean;
}): string {
  if (input.autoStarted) return "Nobody answered the plan card in time, so it started by itself. Carry out the plan now.";
  if (input.choiceId === PLAN_START) return "The user pressed Start. Carry out the plan now.";
  if (input.choiceId === PLAN_ALTERNATIVE)
    return `The user chose the alternative "${input.choiceLabel ?? ""}". Do only that, not the plan.`;
  if (input.choiceId === PLAN_CANCEL)
    return "The user cancelled. Do not start the work; ask in one sentence what they want instead.";
  const answer = input.answer.trim();
  if (!answer || SKIPPED.test(answer)) return "The user skipped the plan card. Do not start the work; answer briefly.";
  return `The user answered the plan card: "${answer}". Follow that answer.`;
}
