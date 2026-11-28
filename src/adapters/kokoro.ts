import { KOKORO_MODEL } from "../contracts/speech.js";
import { speechCatalogEntry } from "../contracts/speech-catalog.js";
import { SpeechReplicaAdapter } from "./speech-replica.js";

/** Kokoro speech synthesis: the catalog's `synthesize` entry on the shared speech adapter. */
export class KokoroAdapter extends SpeechReplicaAdapter {
  constructor(options: { baseUrl: string; model: string; modelDigest: string }) {
    super(speechCatalogEntry(KOKORO_MODEL)!, options);
  }
}