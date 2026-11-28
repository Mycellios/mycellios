import type { ModelDeployment } from "./types.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, MAX_SPEECH_RESPONSE_BYTES } from "./speech.js";
import { MAX_TRANSCRIPTION_RESULT_BYTES, TRANSCRIPTION_DIGEST, TRANSCRIPTION_MODEL } from "./transcription.js";

/**
 * Catalog of the network's speech models (specs/speech-replica). Every entry
 * is pinned by artifact digest and served by a loopback speech runtime; the
 * task decides the request and result envelopes. Adding a model is a catalog
 * entry plus its own native qualification, never a new adapter.
 */
export type SpeechTask = "transcribe" | "synthesize";

export interface SpeechCatalogEntry {
  /** Public model id callers request. */
  readonly model: string;
  readonly task: SpeechTask;
  readonly digest: string;
  /** Worker adapter kind that existing deployments already declare for this model. */
  readonly adapterKind: "transcription" | "kokoro";
  /** Runtime identity the loopback service reports in `/health`. */
  readonly runtime: string;
  /** Loopback path that runs the task. */
  readonly endpoint: "transcribe" | "synthesize";
  readonly maxResponseBytes: number;
  /** Prefix of the adapter's stable error codes. */
  readonly errorPrefix: string;
  /** Human name of the runtime in diagnostic messages. */
  readonly runtimeLabel: string;
}

export const SPEECH_CATALOG: readonly SpeechCatalogEntry[] = Object.freeze([
  Object.freeze({
    model: TRANSCRIPTION_MODEL, task: "transcribe", digest: TRANSCRIPTION_DIGEST, adapterKind: "transcription",
    runtime: "mycellios-transcription-runtime/1", endpoint: "transcribe", maxResponseBytes: MAX_TRANSCRIPTION_RESULT_BYTES,
    errorPrefix: "transcription", runtimeLabel: "Transcription",
  } as const),
  Object.freeze({
    model: KOKORO_MODEL, task: "synthesize", digest: KOKORO_WEIGHT_DIGEST, adapterKind: "kokoro",
    runtime: "mycellios-kokoro/2", endpoint: "synthesize", maxResponseBytes: MAX_SPEECH_RESPONSE_BYTES,
    errorPrefix: "kokoro", runtimeLabel: "Kokoro",
  } as const),
]);

export function speechCatalogEntry(model: string): SpeechCatalogEntry | undefined {
  return SPEECH_CATALOG.find(entry => entry.model === model);
}

/** The catalog entry an exact pinned deployment serves, or undefined for any other deployment. */
export function speechCatalogEntryForDeployment(
  deployment: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined,
): SpeechCatalogEntry | undefined {
  if (!deployment) return undefined;
  const entry = speechCatalogEntry(deployment.model);
  return entry && entry.adapterKind === deployment.adapter && entry.digest === deployment.modelDigest ? entry : undefined;
}
