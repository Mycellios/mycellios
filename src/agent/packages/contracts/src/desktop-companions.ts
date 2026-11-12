import { z } from "zod";
import { AgentQuestions } from "./questionnaire.js";

export const DesktopQuestionPromptSchema = z.object({
  id: z.string().min(1).max(384), botId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128), messageId: z.string().min(1).max(128),
  questions: AgentQuestions, legacy: z.boolean(),
}).strict();
export type DesktopQuestionPrompt = z.infer<typeof DesktopQuestionPromptSchema>;
export const DesktopQuestionAnswerSchema = z.object({
  scope: z.string().min(1).max(256), promptId: z.string().min(1).max(384),
  nonce: z.string().min(1).max(128),
  answers: z.array(z.object({ questionId: z.string().min(1).max(80),
    optionIds: z.array(z.string().min(1).max(80)).max(4), text: z.string().max(1600),
  }).strict()).min(1).max(3),
}).strict();
export type DesktopQuestionAnswer = z.infer<typeof DesktopQuestionAnswerSchema>;
export type DesktopQuestionRequest = DesktopQuestionAnswer & { prompt: DesktopQuestionPrompt };
export type DesktopQuestionResult = { nonce: string; scope: string; outcome: "ok" | "stale" | "error" };

/** Revalidate against the authoritative pending card, not caller-provided run/choice IDs. */
export function desktopQuestionAnswerText(prompt: DesktopQuestionPrompt, reply: DesktopQuestionAnswer): string {
  if (reply.promptId !== prompt.id || reply.answers.length !== prompt.questions.length ||
      new Set(reply.answers.map(answer => answer.questionId)).size !== reply.answers.length)
    throw new Error("This question is no longer available");
  const values = prompt.questions.map(question => {
    const answer = reply.answers.find(answer => answer.questionId === question.id);
    if (!answer || new Set(answer.optionIds).size !== answer.optionIds.length ||
        answer.optionIds.some(id => !question.options.some(option => option.id === id)))
      throw new Error("Invalid question answer");
    const text = answer.text.trim();
    if (!question.multiSelect && (answer.optionIds.length > 1 || (answer.optionIds.length && text)))
      throw new Error("Choose one answer");
    const selected = question.options.filter(option => answer.optionIds.includes(option.id));
    if (!selected.length && !text) throw new Error("An answer is required");
    return { question: question.question, text, selected };
  });
  if (prompt.legacy && values.length === 1) return values[0]!.text || values[0]!.selected[0]!.id;
  return values.map(value => `${value.question}\n${[...value.selected.map(option => option.label), ...(value.text ? [value.text] : [])].join("; ")}`).join("\n\n");
}

export const DesktopCompanionPreferencesSchema = z.object({
  island: z.object({ shown: z.boolean(), idle: z.boolean(), additionalDisplays: z.boolean(),
    width: z.number().int().min(75).max(150), height: z.number().int().min(75).max(150) }).strict(),
  dock: z.object({ shown: z.boolean(), edge: z.enum(["left", "right", "bottom"]),
    chatAction: z.enum(["main", "floating"]).default("main"),
    display: z.union([z.literal("primary"), z.number().int()]), autoHide: z.boolean(),
    edgeStrip: z.boolean(), results: z.boolean(), agents: z.record(z.string().min(1).max(128), z.boolean()).refine(value => Object.keys(value).length <= 256) }).strict(),
}).strict();
export type DesktopCompanionPreferences = z.infer<typeof DesktopCompanionPreferencesSchema>;
export const DEFAULT_DESKTOP_COMPANIONS: DesktopCompanionPreferences = {
  island: { shown: false, idle: true, additionalDisplays: false, width: 100, height: 100 },
  dock: { shown: false, edge: "right", chatAction: "main", display: "primary", autoHide: false, edgeStrip: true, results: false, agents: {} },
};
export const DesktopCompanionSnapshotSchema = z.object({
  scope: z.string().max(256), theme: z.enum(["light", "dark"]),
  questions: z.array(DesktopQuestionPromptSchema).max(32).optional(),
  labels: z.object({ questions: z.string().max(80), asks: z.string().max(80), later: z.string().max(80),
    open: z.string().max(80), placeholder: z.string().max(120), more: z.string().max(80),
    send: z.string().max(80), error: z.string().max(160), next: z.string().max(80),
  }).strict().optional(),
  palette: z.object({
    surface: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    foreground: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    hover: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
    muted: z.string().max(80).regex(/^(#[a-fA-F0-9]{3,8}|rgba?\([\d.,% ]+\))$/),
  }).strict().optional(),
  agents: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().max(120),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/), status: z.string().max(120), result: z.string().max(300),
    working: z.boolean(), unread: z.boolean(), avatar: z.string().max(32_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).optional() }).strict()).max(100),
}).strict();
export type DesktopCompanionSnapshot = z.infer<typeof DesktopCompanionSnapshotSchema>;
