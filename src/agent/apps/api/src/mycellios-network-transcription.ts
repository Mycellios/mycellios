import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { createOpenAiCompatibleFetch } from "@rakazo/adapters";
import { productBrand } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import { TRANSCRIPTION_MODEL, MAX_TRANSCRIPTION_RESULT_BYTES, transcriptionInputSchema,
  transcriptionAudio, verifiedTranscriptionEnvelope } from "../../../../contracts/transcription.js";
import { networkSpeechIdentityIds } from "./network-speech-placement.js";

export async function renderNetworkTranscription(token: string, input: {
  audio: Uint8Array; language?: string; workerIdentityIds?: readonly string[]; signal?: AbortSignal;
}, transport: typeof fetch = createOpenAiCompatibleFetch()) {
  const unavailable = () => new ORPCError("SERVICE_UNAVAILABLE", { message: "Mycellios network dictation is unavailable. Try again later or choose local dictation.", data: { voiceCode: "NETWORK_VOICE_UNAVAILABLE" } });
  let identities: string[];
  try { identities = networkSpeechIdentityIds(input.workerIdentityIds?.join(",")); }
  catch { throw unavailable(); }
  if (!identities.length) throw unavailable();
  const audio = Buffer.from(input.audio);
  let envelope;
  try {
    envelope = transcriptionInputSchema.parse({ schema: "mycellios-transcription-input/1",
      audio: { format: "wav", sha256: createHash("sha256").update(audio).digest("hex"), data: audio.toString("base64") },
      language: input.language ?? "auto" });
    transcriptionAudio(envelope);
  } catch { throw new ORPCError("BAD_REQUEST", { message: "Use a recording of up to 30 seconds in Spanish or English." }); }
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(input.signal ? [input.signal] : [])]);
  let response: Response;
  try {
    response = await transport(`${productBrand.apiBaseUrl}/chat/completions`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-mycellios-funding": "contribution-credits" },
      body: JSON.stringify({ model: TRANSCRIPTION_MODEL, messages: [{ role: "user", content: JSON.stringify(envelope) }],
        max_tokens: 1, deadline_ms: 55_000, stream: false, privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: identities } }), signal,
    });
  } catch { throw unavailable(); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 402) throw new ORPCError("PAYMENT_REQUIRED", { message: "You do not have enough Mycellios credits for dictation.", data: { voiceCode: "NETWORK_VOICE_CREDITS" } });
    if (response.status === 401 || response.status === 403) throw new ORPCError("FORBIDDEN", { message: "Check your Mycellios connection in Models.", data: { voiceCode: "NETWORK_VOICE_ACCESS_DENIED" } });
    if (response.status === 429) throw new ORPCError("TOO_MANY_REQUESTS", { message: "Mycellios network dictation is busy. Try again later.", data: { voiceCode: "NETWORK_VOICE_BUSY" } });
    throw unavailable();
  }
  try {
    const body = await readBoundedJsonResponse<{ choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }>(response, MAX_TRANSCRIPTION_RESULT_BYTES + 4096, signal);
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") throw new Error("Incomplete transcript");
    return { text: verifiedTranscriptionEnvelope(choice.message.content, envelope).text };
  } catch { throw new ORPCError("BAD_GATEWAY", { message: "Mycellios returned an invalid transcript." }); }
}
