import * as z from "zod";
import { Id, IsoDate } from "./ids.js";
import { AgentQuestions } from "./questionnaire.js";

/**
 * Scripts (specs/mico-automation phase 3): a person lets scripts, CI or other servers message one
 * of their Micos, run its routines and read the outcome over HTTPS, with a token scoped to that
 * Mico, account and Space. Scripts never approve anything.
 */

/** A Mico keeps at most this many script tokens at once. */
export const MICO_SCRIPT_TOKENS_MAX = 5;
/** Messages and routine runs a Mico accepts from scripts in any hour, unless its owner raises it. */
export const MICO_SCRIPT_REQUESTS_PER_HOUR = 60;
/** The highest hourly limit an owner can choose. */
export const MICO_SCRIPT_REQUESTS_PER_HOUR_MAX = 1_000;
/** The hourly limits the owner chooses from. */
export const MICO_SCRIPT_REQUESTS_PER_HOUR_CHOICES = [60, 120, 250, 500, 1_000] as const;
/** How long a clientMessageId (or clientRunId) is remembered, so a retry starts nothing new. */
export const MICO_SCRIPT_RETRY_KEY_HOURS = 24;
/** How long a delivery's status and answer stay readable. */
export const MICO_SCRIPT_DELIVERY_DAYS = 7;
/** Request bodies are at most this large. */
export const MICO_SCRIPT_MAX_BODY_BYTES = 64 * 1024;
/** Every script token starts with this, so it can be recognized and redacted. */
export const MICO_SCRIPT_TOKEN_PREFIX = "mycs_";
/** A message from a script is at most this long. */
export const MICO_SCRIPT_TEXT_MAX_LENGTH = 32_000;
/** A final answer returned to a script is cut at this length. */
export const MICO_SCRIPT_ANSWER_MAX_LENGTH = 16_000;

/** The base path of a Mico's script routes. */
export function micoScriptsPath(botId: string): string {
  return `/api/v1/micos/${encodeURIComponent(botId)}`;
}

/** A retry key: printable ASCII without spaces, as a sender's own request id would be. */
const RetryKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, "Use printable characters without spaces");

/** Where a script message goes: the main chat (default), a new conversation, or one by name. */
export const MicoScriptConversationSchema = z.union([
  z.literal("main"),
  z.literal("new"),
  z.object({ name: z.string().trim().min(1).max(120) }).strict(),
]);
export type MicoScriptConversation = z.infer<typeof MicoScriptConversationSchema>;

export const MicoScriptMessageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(MICO_SCRIPT_TEXT_MAX_LENGTH),
    /** The script's retry key: the same key within 24 hours returns the same delivery. */
    clientMessageId: RetryKeySchema.optional(),
    conversation: MicoScriptConversationSchema.optional(),
  })
  .strict();
export type MicoScriptMessageInput = z.infer<typeof MicoScriptMessageInputSchema>;

export const MicoScriptRoutineRunInputSchema = z
  .object({
    /** Any JSON value. The run reads it after the routine's instruction, as untrusted data. */
    payload: z.unknown().optional(),
    /** The script's retry key: the same key within 24 hours returns the same delivery. */
    clientRunId: RetryKeySchema.optional(),
  })
  .strict();
export type MicoScriptRoutineRunInput = z.infer<typeof MicoScriptRoutineRunInputSchema>;

export const MicoScriptAnswerInputSchema = z
  .object({ answer: z.string().trim().min(1).max(16_000) })
  .strict();

export const MICO_SCRIPT_DELIVERY_STATUSES = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MicoScriptDeliveryStatus = (typeof MICO_SCRIPT_DELIVERY_STATUSES)[number];

/** A message or routine run a script started, as the script reads it. */
export const MicoScriptDeliverySchema = z.object({
  id: Id,
  kind: z.enum(["message", "routine"]),
  status: z.enum(MICO_SCRIPT_DELIVERY_STATUSES),
  createdAt: IsoDate,
  conversationId: Id.nullable(),
  routineId: Id.nullable(),
  runId: Id.nullable(),
  /** When the work ended; null while it continues. */
  endedAt: IsoDate.nullable(),
  /**
   * While it waits for a person: a question a script can answer (see `pending`), or something
   * only the owner can do in Mycellios (an approval, a credential or a takeover).
   */
  waitingFor: z.enum(["question", "mycellios"]).nullable(),
  /** The Mico's final answer, redacted, once the work ended. */
  answer: z.string().nullable(),
  /** Why the work failed or stopped, when it did. */
  error: z.string().nullable(),
});
export type MicoScriptDelivery = z.infer<typeof MicoScriptDeliverySchema>;

/** The answer to a POST that started (or, on a retry, had already started) a delivery. */
export const MicoScriptAcceptedSchema = MicoScriptDeliverySchema.extend({
  /** True when the retry key matched an earlier request: nothing new started. */
  duplicate: z.boolean(),
});
export type MicoScriptAccepted = z.infer<typeof MicoScriptAcceptedSchema>;

/** An ordinary question from work a script started. Its text is the Mico's, read as data. */
export const MicoScriptQuestionSchema = z.object({
  id: Id,
  deliveryId: Id,
  conversationId: Id,
  askedAt: IsoDate,
  text: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  questions: AgentQuestions.optional(),
});
export type MicoScriptQuestion = z.infer<typeof MicoScriptQuestionSchema>;

export const MicoScriptPendingSchema = z.object({
  questions: z.array(MicoScriptQuestionSchema),
  /** Approvals, credential requests and takeovers: only that something waits in Mycellios. */
  inMycellios: z.array(z.object({ deliveryId: Id, since: IsoDate })),
});
export type MicoScriptPending = z.infer<typeof MicoScriptPendingSchema>;

/** What a token's own Mico looks like to a script: its name and the routines it can run. */
export const MicoScriptInfoSchema = z.object({
  mico: z.object({ id: Id, name: z.string() }),
  routines: z.array(z.object({ id: Id, name: z.string(), active: z.boolean() })),
  requestsPerHour: z.number().int(),
});
export type MicoScriptInfo = z.infer<typeof MicoScriptInfoSchema>;

export const MicoScriptRequestsPerHourSchema = z
  .number()
  .int()
  .refine((value) => (MICO_SCRIPT_REQUESTS_PER_HOUR_CHOICES as readonly number[]).includes(value), {
    message: "Choose one of the offered limits",
  });

/** A token as its owner sees it after creation: never the secret. */
export const MicoScriptTokenSchema = z.object({
  id: Id,
  /** The token's first characters, enough to tell tokens apart; not secret. */
  hint: z.string(),
  createdAt: IsoDate,
  lastUsedAt: IsoDate.nullable(),
});
export type MicoScriptToken = z.infer<typeof MicoScriptTokenSchema>;

export const MicoScriptsStateSchema = z.object({
  enabled: z.boolean(),
  requestsPerHour: z.number().int().min(1).max(MICO_SCRIPT_REQUESTS_PER_HOUR_MAX),
  tokens: z.array(MicoScriptTokenSchema).max(MICO_SCRIPT_TOKENS_MAX),
  /** The base path of this Mico's script routes. */
  path: z.string(),
});
export type MicoScriptsState = z.infer<typeof MicoScriptsStateSchema>;
