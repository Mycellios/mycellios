import { TRANSCRIPTION_MODEL } from "../contracts/transcription.js";
import { speechCatalogEntry } from "../contracts/speech-catalog.js";
import { SpeechReplicaAdapter } from "./speech-replica.js";

/** Whisper transcription: the catalog's `transcribe` entry on the shared speech adapter. */
export class TranscriptionAdapter extends SpeechReplicaAdapter {
  constructor(options: { baseUrl: string; model: string; modelDigest: string }) {
    super(speechCatalogEntry(TRANSCRIPTION_MODEL)!, options);
  }
}