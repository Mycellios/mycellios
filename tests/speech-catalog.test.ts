import { describe, expect, it } from "vitest";
import { SPEECH_CATALOG, speechCatalogEntry, speechCatalogEntryForDeployment } from "../src/contracts/speech-catalog.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, MAX_SPEECH_RESPONSE_BYTES, isKokoroDeployment } from "../src/contracts/speech.js";
import { MAX_TRANSCRIPTION_RESULT_BYTES, TRANSCRIPTION_DIGEST, TRANSCRIPTION_MODEL, isTranscriptionDeployment } from "../src/contracts/transcription.js";
import { replicaOutputByteLimit } from "../src/coordinator/speech-completion.js";
import { KokoroAdapter } from "../src/adapters/kokoro.js";
import { TranscriptionAdapter } from "../src/adapters/transcription.js";
import { SpeechReplicaAdapter } from "../src/adapters/speech-replica.js";
import type { ModelDeployment } from "../src/contracts/types.js";

const deployment = (adapter: string, model: string, modelDigest: string) =>
  ({ adapter, model, modelDigest }) as unknown as ModelDeployment;

describe("speech catalog", () => {
  it("lists each pinned speech model once with its existing adapter kind", () => {
    expect(SPEECH_CATALOG.map(entry => [entry.model, entry.task, entry.adapterKind, entry.digest])).toEqual([
      [TRANSCRIPTION_MODEL, "transcribe", "transcription", TRANSCRIPTION_DIGEST],
      [KOKORO_MODEL, "synthesize", "kokoro", KOKORO_WEIGHT_DIGEST],
    ]);
    expect(new Set(SPEECH_CATALOG.map(entry => entry.model)).size).toBe(SPEECH_CATALOG.length);
    expect(Object.isFrozen(SPEECH_CATALOG) && SPEECH_CATALOG.every(Object.isFrozen)).toBe(true);
  });

  it("matches only exact pinned deployments, like the per-model predicates", () => {
    const cases = [
      deployment("transcription", TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST),
      deployment("kokoro", KOKORO_MODEL, KOKORO_WEIGHT_DIGEST),
      deployment("kokoro", TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST),
      deployment("transcription", TRANSCRIPTION_MODEL, KOKORO_WEIGHT_DIGEST),
      deployment("python", "other", "sha256:0"),
    ];
    for (const value of cases) {
      expect(Boolean(speechCatalogEntryForDeployment(value))).toBe(isTranscriptionDeployment(value) || isKokoroDeployment(value));
    }
    expect(speechCatalogEntryForDeployment(undefined)).toBeUndefined();
    expect(speechCatalogEntry("unknown")).toBeUndefined();
  });

  it("keeps the replica output limits", () => {
    expect(replicaOutputByteLimit(cases()[0])).toBe(MAX_TRANSCRIPTION_RESULT_BYTES);
    expect(replicaOutputByteLimit(cases()[1])).toBe(MAX_SPEECH_RESPONSE_BYTES);
    expect(replicaOutputByteLimit(undefined, 256)).toBe(8192);
    function cases() { return [deployment("transcription", TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST),
      deployment("kokoro", KOKORO_MODEL, KOKORO_WEIGHT_DIGEST)]; }
  });

  it("serves both models through the shared speech adapter with their existing kinds", () => {
    const origin = "http://127.0.0.1:9/";
    const kokoro = new KokoroAdapter({ baseUrl: origin, model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST });
    const whisper = new TranscriptionAdapter({ baseUrl: origin, model: TRANSCRIPTION_MODEL, modelDigest: TRANSCRIPTION_DIGEST });
    expect(kokoro).toBeInstanceOf(SpeechReplicaAdapter);
    expect(whisper).toBeInstanceOf(SpeechReplicaAdapter);
    expect([kokoro.kind, whisper.kind]).toEqual(["kokoro", "transcription"]);
    expect(() => new KokoroAdapter({ baseUrl: origin, model: KOKORO_MODEL, modelDigest: TRANSCRIPTION_DIGEST }))
      .toThrow("kokoro_model_digest_mismatch");
    expect(() => new TranscriptionAdapter({ baseUrl: origin, model: KOKORO_MODEL, modelDigest: TRANSCRIPTION_DIGEST })).toThrow();
  });
});
