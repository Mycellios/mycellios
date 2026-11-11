import { ORPCError } from "@orpc/server";
import { createOpenAiCompatibleFetch } from "@rakazo/adapters";
import { productBrand } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import {
  KOKORO_MODEL,
  MAX_SPEECH_RESPONSE_BYTES,
  resolveSpeechOptions,
  verifiedSpeechEnvelope,
} from "../../../../contracts/speech.js";

export async function renderNetworkSpeech(
  token: string,
  input: { text: string; language: "en" | "es"; signal?: AbortSignal },
  transport: typeof fetch = createOpenAiCompatibleFetch(),
) {
  const text = input.text.trim();
  if (!text || text.length > 400) {
    throw new ORPCError("BAD_REQUEST", { message: "Network speech needs between 1 and 400 characters." });
  }
  const options = resolveSpeechOptions({ language: input.language });
  const signal = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(input.signal ? [input.signal] : []),
  ]);
  let response: Response;
  try {
    response = await transport(`${productBrand.apiBaseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-mycellios-funding": "contribution-credits",
      },
      body: JSON.stringify({
        model: KOKORO_MODEL,
        messages: [{ role: "user", content: text }],
        stream: false,
        ...options,
      }),
      signal,
    });
  } catch {
    if (signal.aborted && !input.signal?.aborted) {
      throw new ORPCError("GATEWAY_TIMEOUT", { message: "Mycellios network voice took too long. Try again later or choose local voice.", data: { voiceCode: "NETWORK_VOICE_TIMEOUT" } });
    }
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Mycellios network voice is unavailable.", data: { voiceCode: "NETWORK_VOICE_UNAVAILABLE" } });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401) {
      throw new ORPCError("FORBIDDEN", { message: "Your Mycellios key was rejected. Reconnect it in Models.", data: { voiceCode: "NETWORK_VOICE_KEY_REJECTED" } });
    }
    if (response.status === 403) {
      throw new ORPCError("FORBIDDEN", { message: "Your Mycellios connection cannot use this voice model. Check its access in Models.", data: { voiceCode: "NETWORK_VOICE_ACCESS_DENIED" } });
    }
    if (response.status === 402) {
      throw new ORPCError("PAYMENT_REQUIRED", { message: "You do not have enough Mycellios credits for this reply.", data: { voiceCode: "NETWORK_VOICE_CREDITS" } });
    }
    if (response.status === 429) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: "Mycellios network voice is busy. Try again later or choose local voice.", data: { voiceCode: "NETWORK_VOICE_BUSY" } });
    }
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Mycellios network voice is unavailable.", data: { voiceCode: "NETWORK_VOICE_UNAVAILABLE" } });
  }
  try {
    const body = await readBoundedJsonResponse<{
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
    }>(
      response, MAX_SPEECH_RESPONSE_BYTES, signal,
    );
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.finish_reason !== "stop" || typeof content !== "string") throw new Error("Incomplete speech envelope");
    const verified = verifiedSpeechEnvelope(content, text, options);
    return { bytes: Buffer.from(verified.audio.data, "base64"), mimeType: "audio/wav" };
  } catch {
    throw new ORPCError("BAD_GATEWAY", { message: "Mycellios returned invalid speech audio.", data: { voiceCode: "NETWORK_VOICE_INVALID_AUDIO" } });
  }
}
