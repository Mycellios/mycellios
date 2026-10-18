import { isKokoroDeployment, MAX_SPEECH_RESPONSE_BYTES, verifiedSpeechEnvelope, resolveSpeechOptions } from "../contracts/speech.js";
import type { ChatCompletionRequest, CompletionResult, ModelDeployment } from "../contracts/types.js";

export function replicaOutputByteLimit(deployment: ModelDeployment | undefined, maxTokens = 256): number {
  return isKokoroDeployment(deployment) ? MAX_SPEECH_RESPONSE_BYTES
    : Math.min(2 * 1024 * 1024, Math.max(4096, maxTokens * 32));
}
export function validateSpeechCompletion(request: ChatCompletionRequest, result: CompletionResult, output: string): { ok: true } | { ok: false; reason: string } {
  const users = request.messages.filter((m) => m.role === "user");
  if (users.length !== 1 || result.text !== output || result.metrics.outputTokens !== 0 || result.finishReason !== "stop"
    || Buffer.byteLength(output) > MAX_SPEECH_RESPONSE_BYTES) return { ok: false, reason: "Invalid speech completion" };
  try { verifiedSpeechEnvelope(output, users[0]!.content, resolveSpeechOptions(request)); }
  catch { return { ok: false, reason: "Speech integrity validation failed" }; }
  return { ok: true };
}
