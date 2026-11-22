import type { MessageQueueConflictCode } from "@mycellios/contracts";
import { HOSTED_MODEL_CREDITS_REQUIRED_ERROR, normalizeRunError } from "./run-error.js";

/**
 * Messages that wait in a conversation while its Mico works (specs/mico-message-queue).
 * The queue holds the person's own `queued_user` rows; the running turn never takes them.
 * Limits, wait reasons and conflict codes live in @mycellios/contracts (message-queue).
 */

const CONFLICT_MESSAGES: Record<MessageQueueConflictCode, string> = {
  gone: "This message is no longer waiting: it already started or was removed.",
  held: "This message is being edited somewhere else.",
  not_held: "This edit is no longer open. The message was saved, cancelled or removed meanwhile.",
  stale: "The queue changed meanwhile. Refresh it and try again.",
  empty: "A queued message needs text or a file.",
  not_alone: "Only a message you sent to this Mico alone can move to a new conversation.",
  idle: "Nothing is running here now, so the message waits for its turn in the queue.",
  routine: "A routine is running now, so the message waits in the queue.",
  own_work: "The Mico is working on its own task here, so the message waits in the queue.",
  waiting: "The current turn waits for you, so the message waits in the queue.",
};

/** A queue action that lost a race or does not apply now. The API answers it as a conflict. */
export class MessageQueueConflictError extends Error {
  constructor(readonly code: MessageQueueConflictCode) {
    super(CONFLICT_MESSAGES[code]);
    this.name = "MessageQueueConflictError";
  }
}

export function messageQueueConflictMessage(code: MessageQueueConflictCode): string {
  return CONFLICT_MESSAGES[code];
}

/**
 * A failed turn whose cause would fail the next queued message the same way. The queue then
 * waits for the person (Send now, or a new message) instead of spending its messages.
 */
export function queueHoldingFailure(error: string | null | undefined): "usage" | "signin" | null {
  const text = error?.trim();
  if (!text) return null;
  if (text === HOSTED_MODEL_CREDITS_REQUIRED_ERROR) return "usage";
  if (/^Install and sign in to \S+ on the computer running this server first\.$/.test(text))
    return "signin";
  const { kind } = normalizeRunError(text);
  if (kind === "quota" || kind === "credit" || kind === "spending" || kind === "key")
    return "usage";
  if (kind === "auth") return "signin";
  return null;
}

/**
 * Framing for a message the person sends into a turn that is already working. Only the model
 * sees it; the chat keeps the person's own words.
 */
export const STEERING_FRAMING_NOTE =
  "The person wrote this while you were working. It adds to the work in progress. " +
  "If it asks something, answer it in a sentence or two and continue. If it corrects " +
  "something, follow the correction from this point on. Keep working on what is unfinished " +
  "unless the message asks you to stop.";

/** The person's message as a running turn receives it, behind the framing note. */
export function framedSteeringText(text: string): string {
  return `<mycellios_steering>\n${STEERING_FRAMING_NOTE}\n</mycellios_steering>\n\n${text}`;
}
