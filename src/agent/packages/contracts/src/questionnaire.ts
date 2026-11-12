import { z } from "zod";

/** Plain questions only. Permissions and credentials keep their dedicated flows. */
export const AgentQuestion = z.object({
  id: z.string().min(1).max(80),
  question: z.string().min(1).max(240),
  options: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    description: z.string().max(160).optional(),
  })).max(4),
  multiSelect: z.boolean().optional(),
});
export type AgentQuestion = z.infer<typeof AgentQuestion>;
export const AgentQuestions = z.array(AgentQuestion).min(1).max(3).superRefine((questions, ctx) => {
  if (new Set(questions.map(q => q.id)).size !== questions.length)
    ctx.addIssue({ code: "custom", message: "Question IDs must be unique" });
  for (const question of questions) {
    if (new Set(question.options.map(option => option.id)).size !== question.options.length ||
      new Set(question.options.map(option => option.label)).size !== question.options.length)
      ctx.addIssue({ code: "custom", message: "Options must be unique" });
  }
});
