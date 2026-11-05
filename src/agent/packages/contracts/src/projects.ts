import * as z from "zod";

export const ProjectId = z.string().uuid();
export const ProjectName = z.string().trim().min(1).max(100);
export const ProjectSummary = z.object({
  id: ProjectId, name: ProjectName,
  conversations: z.array(z.object({
    threadId: z.string(), botId: z.string(), title: z.string(), unread: z.boolean(),
  })),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;
