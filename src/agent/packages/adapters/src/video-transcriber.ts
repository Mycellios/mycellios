import type { AdapterContext, SecretStore } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { findDefaultVoiceCredential } from "@mycellios/db";
import { OPENAI_COMPATIBLE_VOICE_PROVIDER_ID } from "./openai-compatible-voice.js";
import type { VideoTranscriber } from "./video-reader.js";
import { createVoiceProvider, MAX_TRANSCRIBE_BYTES } from "./voice-factory.js";

/**
 * The owner's own speech-recognition connection from Voice settings, as used for dictation.
 * Undefined when none is set up or the provider cannot transcribe: read_video then relies on
 * published captions only and never falls back to another payer or provider.
 */
export async function videoTranscriberFor(
  deps: { prisma: PrismaClient; secretStore: SecretStore; mcpAllowPrivateEndpoint?: boolean },
  scope: { userId: string; spaceId: string },
  context: AdapterContext,
): Promise<VideoTranscriber | undefined> {
  const credential = await findDefaultVoiceCredential(deps.prisma, scope);
  if (!credential) return undefined;
  const provider = createVoiceProvider(credential.provider, {
    allowPrivateEndpoint:
      credential.provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID &&
      deps.mcpAllowPrivateEndpoint === true,
  });
  if (!provider.transcribe) return undefined;
  const secret = await deps.prisma.secret.findFirst({
    where: { id: credential.secretId, userId: scope.userId, spaceId: null },
  });
  if (!secret) return undefined;
  const apiKey = await deps.secretStore.load(secret.ciphertext, secret.id);
  return {
    async transcribe(wav, signal, language) {
      if (wav.byteLength > MAX_TRANSCRIBE_BYTES) throw new Error("Audio part is too large.");
      const result = await provider.transcribe!(
        { audio: wav, mimeType: "audio/wav", apiKey, language, signal },
        { ...context, signal },
      );
      return result.text;
    },
  };
}
