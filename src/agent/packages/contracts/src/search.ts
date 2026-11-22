import * as z from "zod";
import { Id } from "./ids.js";

export const SearchHitKindSchema = z.enum(["conversation", "message", "file", "link", "routine"]);
export type SearchHitKind = z.infer<typeof SearchHitKindSchema>;

/** One kind of result at a time, or everything. Micos and groups are matched by name. */
export const SearchFilterSchema = z.enum(["all", "messages", "micos", "groups", "files", "routines"]);
export type SearchFilter = z.infer<typeof SearchFilterSchema>;

export const SearchHitSchema = z
  .object({
    kind: SearchHitKindSchema,
    botId: Id.optional(),
    botName: z.string().optional(),
    groupId: Id.optional(),
    groupName: z.string().optional(),
    title: z.string(),
    snippet: z.string(),
    messageId: Id.optional(),
    seq: z.number().int().nonnegative().optional(),
    artifactId: Id.optional(),
    routineId: Id.optional(),
    url: z.string().optional(),
    /** A message in one of the Mico's side conversations; opens it with ?task=. */
    taskThreadId: Id.optional(),
    conversationTitle: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    const hasBot = Boolean(input.botId);
    const hasGroup = Boolean(input.groupId);
    if (hasBot === hasGroup) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of botId or groupId",
        path: ["botId"],
      });
    }
  });
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchQueryOutputSchema = z.object({
  hits: z.array(SearchHitSchema).max(25),
});
export type SearchQueryOutput = z.infer<typeof SearchQueryOutputSchema>;

/** In-chat search: matching messages of one conversation, newest first. */
export const ThreadSearchOutputSchema = z.object({
  threadId: Id,
  matches: z
    .array(z.object({ messageId: Id, seq: z.number().int().nonnegative(), snippet: z.string() }))
    .max(100),
  /** More messages matched than were returned. */
  more: z.boolean(),
});
export type ThreadSearchOutput = z.infer<typeof ThreadSearchOutputSchema>;
