import type { Message, ToolCall } from "@earendil-works/pi-ai";
import type { AgentRunModel } from "@rakazo/adapter-kit";
import { withoutThinkingFrom } from "./thinking-signatures.js";

/** Internal, versioned transcript; never a client event payload. */
export interface TurnCheckpoint {
  version: 1;
  restartInterrupted?: boolean;
  provider: string;
  model: string;
  systemPrompt: string;
  pendingToolCallId: string;
  messages: Message[];
  historyMessageIds?: string[];
  /** Executor-assigned occurrences include canonical arguments and the paused call. */
  effectOccurrences?: Array<{ executionId: string; fingerprint: string; occurrence: number }>;
  /** Only explicit sequential checkpoints guarantee an unstarted tail. */
  executionMode?: "parallel" | "sequential";
}

export function serializeTurnCheckpoint(checkpoint: TurnCheckpoint): string {
  return JSON.stringify(checkpoint);
}

/** A restart never replays an unacknowledged action, including a parallel tail. */
export function interruptedTurnCheckpoint(blob: string, uncertain = true): string {
  const raw = JSON.parse(blob) as TurnCheckpoint;
  const saved = restoreTurnCheckpoint(blob, { provider: raw.provider, id: raw.model });
  const calls = unresolvedTurnCheckpointCalls(saved.messages);
  return serializeTurnCheckpoint({ ...saved, restartInterrupted: true, messages: [...saved.messages, ...calls.map(call => ({
    role: "toolResult" as const, toolCallId: call.id, toolName: call.name,
    content: [{ type: "text" as const, text: uncertain ? "Execution interrupted for a restart. The action may have completed. Inspect command_status and existing results before continuing; do not repeat an uncertain action." : "This action was not dispatched because the PC is restarting. Continue the original task after reconnecting." }],
    isError: true, timestamp: Date.now(),
  }))] });
}

export function restoreTurnCheckpoint(
  blob: string,
  model: Pick<AgentRunModel, "provider" | "id">,
): TurnCheckpoint {
  const checkpoint = JSON.parse(blob) as TurnCheckpoint;
  if (
    checkpoint.version !== 1 ||
    typeof checkpoint.systemPrompt !== "string" ||
    typeof checkpoint.provider !== "string" ||
    typeof checkpoint.model !== "string" ||
    typeof checkpoint.pendingToolCallId !== "string" ||
    !Array.isArray(checkpoint.messages)
  ) {
    throw new Error("Unsupported turn checkpoint");
  }
  const messages = [...checkpoint.messages];
  while (messages.at(-1)?.role === "assistant") {
    const tail = messages.at(-1)!;
    if (tail.role !== "assistant" || (tail.stopReason !== "aborted" && tail.stopReason !== "error"))
      break;
    messages.pop();
  }
  return {
    ...checkpoint,
    messages:
      checkpoint.provider === model.provider && checkpoint.model === model.id
        ? messages
        : withoutThinkingFrom(messages, 0),
  };
}

/** Match results in transcript order: wire IDs may repeat in later responses. */
export function unresolvedTurnCheckpointCalls(messages: Message[]): ToolCall[] {
  const pending = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.content) if (call.type === "toolCall") pending.set(call.id, call);
    } else if (message.role === "toolResult") {
      pending.delete(message.toolCallId);
    }
  }
  return [...pending.values()];
}
