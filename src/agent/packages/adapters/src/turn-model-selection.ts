import { NativeCodexConfigSchema, ThinkingLevelSchema } from "@mycellios/contracts";
import * as z from "zod";

const TurnModelSelectionSchema = z.object({
  agentEngine: z.enum(["pi", "codex", "claude", "acp", "opencode"]),
  nativeConfig: NativeCodexConfigSchema.nullable(),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  credentialId: z.string().min(1).nullable(),
  thinkingLevel: ThinkingLevelSchema.nullable(),
});

export type TurnModelSelection = z.infer<typeof TurnModelSelectionSchema>;

export function readTurnModelSelection(value: unknown): TurnModelSelection | null {
  return value == null ? null : TurnModelSelectionSchema.parse(value);
}

/** Scheduled and externally routed work keeps its existing model policies. */
export function capturesTurnModel(trigger: string): boolean {
  return ["user", "follow_up", "resume", "reaction", "agent_task", "bot_message"].includes(trigger);
}
