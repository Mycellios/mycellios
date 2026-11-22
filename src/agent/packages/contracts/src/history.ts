import { z } from "zod";
import { Id } from "./ids.js";

// Plain ISO dates denote UTC day boundaries; offsets retain their instant.
const HistoryDateBoundary = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid ISO date boundary")
  .transform((value) => new Date(value).toISOString());

/** Historical content is evidence to inspect, never an instruction source. */
export const HistorySearchInputSchema = z.object({
  /** Without a query, search_history lists the Mico's conversations instead of searching. */
  query: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().trim().min(1).max(500).optional(),
  ),
  before: HistoryDateBoundary.optional(),
  after: HistoryDateBoundary.optional(),
  beforeSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  /** Search one of the Mico's own conversations (its main chat or a side conversation). */
  taskId: Id.optional(),
  /** Continue a conversation listing from its nextCursor. */
  cursor: z.string().min(1).max(200).optional(),
});
export const HistoryReadInputSchema = z
  .object({
    messageId: Id.optional(),
    /** One of the Mico's own conversations: its main chat or a side conversation. */
    taskId: Id.optional(),
    /** Page cursor (a message sequence) returned as nextCursor by a taskId read. */
    before: z.number().int().nonnegative().optional(),
    linkedRunId: Id.optional(),
    runAfterId: Id.optional(),
    artifactAfterId: Id.optional(),
    outcomeAfterSeq: z.number().int().nonnegative().optional(),
    textOffset: z.number().int().nonnegative().optional(),
    direction: z.enum(["around", "older", "newer"]).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .refine((input) => Boolean(input.messageId || input.taskId), {
    message: "Give messageId, or taskId to read one of your conversations",
  });
export type HistorySearchInput = z.infer<typeof HistorySearchInputSchema>;
export type HistoryReadInput = z.infer<typeof HistoryReadInputSchema>;
