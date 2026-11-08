import { readBoundedResponseBytes, speechLocaleTag } from "@rakazo/core";
import { isAndroidHost, startAndroidDictation } from "./android-host";
import { appPath } from "./app-path";
import { getActiveUiLocale } from "./i18n.js";
import { selectedSpaceId, withSpaceHeaders } from "./rpc.js";
import { errorText, voiceAccountErrorText } from "./user-error.js";

export type DictationMode = "hold" | "endpoint";

export type DictationSnapshot = {
  status: "idle" | "listening" | "transcribing";
  transcript: string;
  error?: string;
  level?: number;
  transcriptAfterStop?: boolean;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const IDLE: DictationSnapshot = { status: "idle", transcript: "" };
/**
 * Quiet gap that ends an utterance, measured on the page. Chrome's own end-of-speech
 * fires on any pause, which cuts a caller off mid-sentence; a natural breath is well
 * under this, a finished turn is well over it.
 */
const ENDPOINT_SILENCE_MS = 1200;
const ENDPOINT_TICK_MS = 80;
const SILENCE_RMS = 0.035;
export const TRANSCRIPTION_RESPONSE_TIMEOUT_MS = 70_000;
export const MAX_TRANSCRIPTION_RESPONSE_BYTES = 64 * 1024;
const ENDPOINT_UNSUPPORTED =
  "This browser can't detect when you stop talking. Use Chrome, the desktop app, or hold-to-talk in the composer.";
/** Web Speech codes that mean the cloud recognizer cannot be used. */
const WEB_SPEECH_SERVICE_ERRORS = new Set(["network", "service-not-allowed"]);

export function webSpeechAvailable(): boolean {
  return Boolean(speechRecognitionCtor()) && !electronSpeechHost();
}

/**
 * Electron exposes webkitSpeechRecognition without a speech-service key, so
 * recognition fails with `network`. Don't treat that API as available there.
 */
function electronSpeechHost(): boolean {
  if (typeof window !== "undefined") {
    const host = window as Window & { rakazoDesktop?: unknown };
    if (host.rakazoDesktop) return true;
  }
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  return typeof agent === "string" && agent.includes("Electron");
}

/**
 * Phones cannot hold a speech session open: `start()` replays the system tone on every
 * restart and the session ends at each pause, so Web Speech there means one beep per
 * phrase and a transcript that keeps getting cut. Server transcription records silently,
 * so prefer it on mobile browsers wherever a provider can transcribe.
 */
export function prefersServerDictation(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  if (/android|iphone|ipod|ipad|mobile/i.test(agent)) return true;
  // iPadOS 13+ reports a desktop Safari user agent, so fall back to touch support.
  const touchPoints = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  return touchPoints > 1 && /macintosh/i.test(agent);
}

/** Connected server transcription should take over after Web Speech cannot run. */
export function webSpeechNeedsServerFallback(
  error: string | undefined,
  transcribe: boolean,
): boolean {
  return transcribe && typeof error === "string" && WEB_SPEECH_SERVICE_ERRORS.has(error);
}

/**
 * Web Speech ends the session on its own, and every start() plays the recognizer's tone.
 * When the browser cannot hold the microphone the sessions end the moment they begin, so
 * an immediate restart turns into a stream of beeps. Back off, then hand the microphone
 * over instead of hammering it.
 */
const RESTART_SHORT_SESSION_MS = 400;
const RESTART_BACKOFF_AFTER = 2;
const RESTART_BACKOFF_MS = 900;
const RESTART_GIVE_UP_AFTER = 4;
const RESTART_GIVE_UP_ERROR =
  "The browser keeps dropping the microphone. Start dictation again to retry.";

/**
 * The language the recognizer listens in: the app's own language when the UI is
 * in another one, and the browser's otherwise.
 *
 * English is also the app's fallback for a browser language it ships no catalog
 * for, so an Italian browser would lose its Italian recognition by following the
 * app. The browser's language stays in that case.
 */
export function recognitionLanguage(): string {
  const browser = navigator.language || "en-US";
  const tag = speechLocaleTag(getActiveUiLocale());
  return tag && tag !== "en-US" ? tag : browser;
}

/**
 * Language hint for server transcription: the primary subtag of the app's own locale
 * (`es`, `pt`, `zh`). Undefined leaves detection to the provider.
 */
export function transcriptionLanguage(): string | undefined {
  const tag = speechLocaleTag(getActiveUiLocale());
  return tag ? tag.split("-")[0]?.toLowerCase() : undefined;
}

function normalizedTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function startsWithWholePrefix(text: string, prefix: string): boolean {
  const head = prefix.toLowerCase();
  const tail = text.toLowerCase();
  if (!tail.startsWith(head)) return false;
  // Index by code point. A supplementary-plane letter is two UTF-16 units, and
  // the first half alone is not a letter.
  const point = tail.codePointAt(head.length);
  if (point === undefined) return true;
  // Punctuation ends the retained word. Letters, numbers, and "_" continue it.
  return !/[\p{L}\p{N}_]/u.test(String.fromCodePoint(point));
}

/** Join carried Web Speech with a restarted session at their longest whole-word overlap. */
export function combineTranscript(prefix: string, speechText: string): string {
  const head = normalizedTranscript(prefix);
  const tail = speechText.trim();
  if (!head) return tail;
  if (!tail) return head;
  if (startsWithWholePrefix(tail, head)) return tail;
  const normalizedTail = normalizedTranscript(tail);
  for (let start = 0; start < head.length; start += 1) {
    if (start > 0 && !/\s/u.test(head[start - 1] ?? "")) continue;
    const overlap = head.slice(start);
    if (startsWithWholePrefix(normalizedTail, overlap)) {
      return head.slice(0, start) + normalizedTail;
    }
  }
  return `${head} ${normalizedTail}`;
}

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}

function audioContextCtor(): (new () => AudioContext) | undefined {
  if (typeof AudioContext === "function") return AudioContext;
  if (typeof window === "undefined") return undefined;
  const host = window as Window & { webkitAudioContext?: typeof AudioContext };
  return host.webkitAudioContext;
}

export class Dictation {
  private snapshot: DictationSnapshot = IDLE;
  private watchers = new Set<(s: DictationSnapshot) => void>();
  private nativeCapture: ReturnType<typeof startAndroidDictation> | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private token = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private transcribeAbort: AbortController | null = null;
  private audioContext: AudioContext | null = null;
  private meterStream: MediaStream | null = null;
  private vadTimer: ReturnType<typeof setInterval> | undefined;
  private onFinal: ((text: string) => void) | null = null;
  private onSpeechStart: (() => void) | undefined;
  private onRecording: ((audio: Blob) => void) | undefined;
  private skipRecordingTranscription = false;
  private waitForSpeechEnd = false;
  private finishingSpeech = false;
  private reportBufferedTranscript = false;
  private recordingLimit?: ReturnType<typeof setTimeout>;

  subscribe(fn: (s: DictationSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): DictationSnapshot {
    return this.snapshot;
  }

  owns(onFinal: (text: string) => void): boolean {
    return this.onFinal === onFinal;
  }

  private set(next: DictationSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  stop(reason: "submit" | "cancel" | "replace" = "cancel") {
    this.nativeCapture?.cancel();
    this.nativeCapture = null;
    clearTimeout(this.recordingLimit);
    this.token += 1;
    this.transcribeAbort?.abort();
    this.transcribeAbort = null;
    this.stopVad();
    clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        if (reason === "submit") rec.stop();
        else rec.abort();
      } catch {
        // already stopped
      }
    }
    const media = this.media;
    this.media = null;
    if (media && media.state !== "inactive") {
      try {
        media.stop();
      } catch {
        // already stopped
      }
    }
    this.chunks = [];
    this.onFinal = null;
    this.onRecording = undefined;
    this.skipRecordingTranscription = false;
    this.waitForSpeechEnd = false;
    this.finishingSpeech = false;
    this.reportBufferedTranscript = false;
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  async listen(opts: {
    mode: DictationMode;
    spaceId?: string | null;
    transcribe?: boolean;
    preferServer?: boolean;
    endpointMs?: number;
    onFinal: (text: string) => void;
    onSpeechStart?: () => void;
    onRecording?: (audio: Blob) => void;
    waitForSpeechEnd?: boolean;
    liveTranscript?: boolean;
  }): Promise<void> {
    this.stop("replace");
    const mine = this.token;
    const spaceId = opts.spaceId !== undefined ? opts.spaceId : selectedSpaceId();
    this.onFinal = opts.onFinal;
    this.onSpeechStart = opts.onSpeechStart;
    this.onRecording = opts.onRecording;
    this.skipRecordingTranscription = Boolean(opts.onRecording && opts.transcribe === false);
    this.waitForSpeechEnd = opts.waitForSpeechEnd === true;
    this.reportBufferedTranscript = Boolean(opts.liveTranscript || opts.onRecording);
    this.set({ status: "listening", transcript: "" });
    const transcribe = Boolean(opts.transcribe);
    if (opts.onRecording) {
      await this.listenRecorder(mine, "hold", ENDPOINT_SILENCE_MS, spaceId);
      return;
    }
    if (isAndroidHost()) {
      this.nativeCapture = startAndroidDictation({
        transcript: text => { if (this.token === mine) this.set({ status: "listening", transcript: text }); },
        final: text => this.finish(text, mine),
        error: message => { if (this.token === mine) { this.stop(); this.set({ ...IDLE, error: message }); } },
      });
      return;
    }
    const native = typeof window !== "undefined" ? window.rakazoDesktop?.localVoice : undefined;
    const nativeStatus = native ? await native.status().catch(() => null) : null;
    if (this.token !== mine) return;
    if (nativeStatus?.ready) {
      await this.listenRecorder(mine, opts.mode, opts.endpointMs ?? ENDPOINT_SILENCE_MS, spaceId);
      return;
    }
    // An unknown capability is not a refusal: a device whose browser cannot hold the
    // microphone open goes to the server even before the voice status has loaded.
    const liveTranscript = opts.liveTranscript === true && webSpeechAvailable();
    if (!liveTranscript && (opts.preferServer || prefersServerDictation()) && opts.transcribe !== false) {
      await this.listenRecorder(mine, opts.mode, opts.endpointMs ?? ENDPOINT_SILENCE_MS, spaceId);
      return;
    }
    if (webSpeechAvailable()) {
      this.listenWebSpeech(
        opts.mode,
        opts.endpointMs ?? ENDPOINT_SILENCE_MS,
        mine,
        transcribe,
        spaceId,
        liveTranscript,
      );
      return;
    }
    if (transcribe) {
      await this.listenRecorder(mine, opts.mode, opts.endpointMs ?? ENDPOINT_SILENCE_MS, spaceId);
      return;
    }
    this.set({
      ...IDLE,
      error:
        "This browser has no on-device dictation. Connect a voice provider with transcription, or use Chrome / the desktop app.",
    });
  }

  private listenWebSpeech(
    mode: DictationMode,
    endpointMs: number,
    mine: number,
    transcribe: boolean,
    spaceId: string | null,
    liveTranscript = false,
  ) {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    let live = true;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = recognitionLanguage();
    rec.onspeechstart = () => { if (live && this.token === mine) this.onSpeechStart?.(); };
    // Chrome numbers results per session, so a restart starts over: keep the earlier text.
    let carried = "";
    let sessionStartedAt = Date.now();
    let shortSessions = 0;
    let sessionHeardSpeech = false;
    rec.onresult = (event) => {
      if (!live || this.token !== mine) return;
      // Each result index is a separate phrase. Matching text within this session
      // may be a real repetition; only deduplicate against a previous session.
      const session = normalizedTranscript(
        Array.from(event.results, (result) => result?.[0]?.transcript ?? "").join(" "),
      );
      if (session.trim()) {
        sessionHeardSpeech = true;
        shortSessions = 0;
      }
      const transcript = combineTranscript(carried, session);
      this.set({ status: "listening", transcript });
      if (mode !== "endpoint") return;
      // Every result means the caller was just heard, so the quiet gap is measured from
      // here. That includes Chrome finalising a phrase it already reported: its phrase
      // boundary is a breath, and the words repeat, so a window tied to new text alone
      // expires before Chrome opens its first interim for the rest of the sentence.
      if (!transcript) return;
      clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        if (!live || this.token !== mine) return;
        this.finish(this.snapshot.transcript, mine);
      }, endpointMs);
    };
    rec.onerror = (event) => {
      if (!live || this.token !== mine) return;
      if (event.error === "aborted" || event.error === "no-speech" || this.finishingSpeech) return;
      if (webSpeechNeedsServerFallback(event.error, transcribe)) {
        live = false;
        this.fallbackToServer(rec, mine, mode, endpointMs, spaceId);
        return;
      }
      live = false;
      this.stopVad();
      this.releaseRecognition(rec);
      this.set({
        ...IDLE,
        error: event.error ? `Dictation failed: ${event.error}` : "Dictation failed.",
      });
    };
    rec.onend = () => {
      if (!live || this.token !== mine) return;
      if (this.snapshot.status !== "listening") return;
      if (mode === "hold" && (!liveTranscript || this.finishingSpeech)) {
        this.finish(this.snapshot.transcript, mine);
        return;
      }
      // Chrome ends the session on its own — after a pause, or its ~60s cap — and that
      // says nothing about whether the caller finished. Only the silence window above
      // ends an utterance; here we just pick the microphone back up — unless it keeps
      // ending straight away, which means the browser cannot hold the microphone at all.
      carried = this.snapshot.transcript;
      shortSessions =
        !sessionHeardSpeech && Date.now() - sessionStartedAt < RESTART_SHORT_SESSION_MS
          ? shortSessions + 1
          : 0;
      if (shortSessions >= RESTART_GIVE_UP_AFTER) {
        live = false;
        if (transcribe) {
          this.fallbackToServer(rec, mine, mode, endpointMs, spaceId);
          return;
        }
        this.releaseRecognition(rec);
        this.failListening(mine, RESTART_GIVE_UP_ERROR, true);
        return;
      }
      const restart = () => {
        if (!live || this.token !== mine) return;
        try {
          sessionStartedAt = Date.now();
          sessionHeardSpeech = false;
          rec.start();
        } catch {
          live = false;
          this.releaseRecognition(rec);
          this.failListening(mine, "Dictation ended unexpectedly.", true);
        }
      };
      if (shortSessions >= RESTART_BACKOFF_AFTER) {
        this.restartTimer = setTimeout(restart, RESTART_BACKOFF_MS);
        return;
      }
      restart();
    };
    this.recognition = rec;
    if (this.onSpeechStart) void this.startRecognitionMeter(mine);
    try {
      sessionStartedAt = Date.now();
      rec.start();
    } catch {
      if (!live || this.token !== mine) return;
      if (transcribe) {
        live = false;
        this.fallbackToServer(rec, mine, mode, endpointMs, spaceId);
        return;
      }
      live = false;
      this.releaseRecognition(rec);
      this.stopVad();
      this.set({ ...IDLE, error: "Dictation failed." });
    }
  }

  private fallbackToServer(
    rec: SpeechRecognitionLike,
    mine: number,
    mode: DictationMode,
    endpointMs: number,
    spaceId: string | null,
  ) {
    const recognized = normalizedTranscript(this.snapshot.transcript);
    this.releaseRecognition(rec);
    this.stopVad();
    clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    if (this.token !== mine) return;
    this.set({ status: "listening", transcript: recognized });
    void this.listenRecorder(mine, mode, endpointMs, spaceId);
  }

  private releaseRecognition(rec: SpeechRecognitionLike) {
    rec.onspeechstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    if (this.recognition === rec) this.recognition = null;
    try {
      rec.abort();
    } catch {
      // already stopped
    }
  }

  private async listenRecorder(
    mine: number,
    mode: DictationMode,
    endpointMs: number,
    spaceId: string | null,
  ) {
    if (mode === "hold" && this.reportBufferedTranscript && !this.skipRecordingTranscription) {
      this.set({ ...this.snapshot, transcriptAfterStop: true });
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      this.failListening(mine, errorText(error, "Microphone failed"));
      return;
    }
    if (this.token !== mine) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const keptSpeech = this.snapshot.transcript.trim().length > 0;
    if (mode === "endpoint" && !this.armSilence(stream, mine, endpointMs, keptSpeech)) {
      for (const track of stream.getTracks()) track.stop();
      this.failListening(mine, ENDPOINT_UNSUPPORTED);
      return;
    }
    let media: MediaRecorder | undefined;
    try {
      const mimeType = this.onRecording
        ? ["audio/mp4", "audio/ogg"].find(type => MediaRecorder.isTypeSupported?.(type))
        : undefined;
      media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.media = media;
      this.chunks = [];
      media.ondataavailable = (event) => {
        if (this.token !== mine) return;
        if (event.data.size) this.chunks.push(event.data);
      };
      media.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        if (this.token !== mine) return;
        clearTimeout(this.recordingLimit);
        this.stopVad();
        void this.transcribeChunks(mine, spaceId);
      };
      media.onerror = () => {
        for (const track of stream.getTracks()) track.stop();
        if (this.token !== mine) return;
        const prefix = this.snapshot.transcript;
        this.finish(prefix, mine, "Could not record audio.");
      };
      media.start(mode === "endpoint" ? 250 : undefined);
      if (mode === "hold" && (this.onRecording || this.onSpeechStart)) this.armSilence(stream, mine, null);
      this.recordingLimit = setTimeout(() => { if (this.token === mine && media && media.state !== "inactive") media.stop(); }, 60_000);
    } catch (error) {
      if (media) {
        media.ondataavailable = null;
        media.onstop = null;
      }
      for (const track of stream.getTracks()) track.stop();
      if (this.media === media) this.media = null;
      if (this.token !== mine) return;
      this.stopVad();
      this.failListening(mine, errorText(error, "Dictation failed."));
    }
  }

  private armSilence(
    stream: MediaStream,
    mine: number,
    endpointMs: number | null,
    alreadyHeard = false,
  ): boolean {
    const Ctor = audioContextCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      this.audioContext = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const data = new Uint8Array(analyser.fftSize);
      let heardSpeech = alreadyHeard;
      let silentFor = 0;
      let speechTicks = 0;
      this.vadTimer = setInterval(() => {
        const media = this.media;
        if (this.token !== mine || !media || media.state === "inactive") return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const n = (sample - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / data.length);
        this.set({ ...this.snapshot, level: Math.min(1, rms * 8) });
        if (endpointMs === null) return;
        if (rms > SILENCE_RMS) {
          if (++speechTicks === 4) this.onSpeechStart?.();
          heardSpeech = true;
          silentFor = 0;
          return;
        }
        speechTicks = 0;
        if (!heardSpeech) return;
        silentFor += ENDPOINT_TICK_MS;
        if (silentFor < endpointMs) return;
        this.stopVad();
        try {
          media.stop();
        } catch {
          // already stopped
        }
      }, ENDPOINT_TICK_MS);
      return true;
    } catch {
      this.stopVad();
      return false;
    }
  }

  private async startRecognitionMeter(mine: number) {
    const Ctor = audioContextCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (mine !== this.token || !this.recognition) { stream.getTracks().forEach(track => track.stop()); return; }
      const ctx = new Ctor(), analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.meterStream = stream; this.audioContext = ctx;
      void ctx.resume().catch(() => undefined);
      const samples = new Uint8Array(analyser.fftSize);
      this.vadTimer = setInterval(() => {
        if (mine !== this.token || !this.recognition) return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        this.set({ ...this.snapshot, level: Math.min(1, rms * 8) });
      }, ENDPOINT_TICK_MS);
    } catch { stream?.getTracks().forEach(track => track.stop()); }
  }

  private stopVad() {
    this.meterStream?.getTracks().forEach(track => track.stop());
    this.meterStream = null;
    clearInterval(this.vadTimer);
    this.vadTimer = undefined;
    const ctx = this.audioContext;
    this.audioContext = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private async transcribeChunks(mine: number, spaceId: string | null) {
    if (this.token !== mine) return;
    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" });
    this.chunks = [];
    if (!blob.size) {
      const prefix = normalizedTranscript(this.snapshot.transcript);
      if (!prefix) {
        this.set(IDLE);
        return;
      }
      this.finish(prefix, mine);
      return;
    }
    this.onRecording?.(blob);
    if (this.skipRecordingTranscription) {
      this.finish(this.snapshot.transcript, mine);
      return;
    }
    this.set({ status: "transcribing", transcript: this.snapshot.transcript });
    const abort = new AbortController();
    this.transcribeAbort = abort;
    const timer = setTimeout(
      () => abort.abort(new Error("Transcription request timed out.")),
      TRANSCRIPTION_RESPONSE_TIMEOUT_MS,
    );
    try {
      const native = typeof window !== "undefined" ? window.rakazoDesktop?.localVoice : undefined;
      const nativeStatus = native ? await native.status().catch(() => null) : null;
      if (this.token !== mine) return;
      if (native && nativeStatus?.ready) {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
          const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
          const samples = (await offline.startRendering()).getChannelData(0);
          if (this.token !== mine) return;
          const result = await native.transcribe(samples);
          if (this.token === mine) this.finish(result.text ?? "", mine);
          return;
        } finally { await context.close(); }
      }
      const audioBase64 = await blobToBase64(blob);
      if (this.token !== mine) return;
      const res = await withAbort(
        fetch(appPath("/api/voice/transcribe"), {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({
            audioBase64,
            mimeType: blob.type,
            language: transcriptionLanguage(),
          }),
          signal: abort.signal,
        }),
        abort.signal,
      );
      if (this.token !== mine) {
        cancelResponse(res);
        return;
      }
      const body = await readTranscriptionBody(res, abort.signal);
      if (this.token !== mine) return;
      if (!res.ok) {
        this.failListening(
          mine,
          voiceAccountErrorText(body) ?? body.error ?? "Could not transcribe that recording.",
        );
        return;
      }
      // The recorder captures fresh audio, so matching words are intentional repetitions.
      const prefix = normalizedTranscript(this.snapshot.transcript);
      const text = body.text ?? "";
      this.finish(
        prefix ? [prefix, normalizedTranscript(text)].filter(Boolean).join(" ") : text,
        mine,
      );
    } catch (error) {
      // User cancel bumps token in stop() before aborting, so a matching token
      // means the deadline timer fired. Browsers may reject fetch as AbortError
      // instead of signal.reason; surface the timeout either way.
      if (this.token !== mine) return;
      const timedOut =
        (abort.signal.reason instanceof Error &&
          abort.signal.reason.message === "Transcription request timed out.") ||
        (error instanceof Error && error.message === "Transcription request timed out.");
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        this.failListening(mine, "Transcription request timed out.");
        return;
      }
      this.failListening(mine, errorText(error, "Could not transcribe that recording."));
    } finally {
      clearTimeout(timer);
      if (this.transcribeAbort === abort) this.transcribeAbort = null;
    }
  }

  submitHold() {
    if (this.nativeCapture) { this.nativeCapture.finish(); return; }
    if (this.media && this.media.state !== "inactive") {
      this.media.stop();
      return;
    }
    if (this.recognition && this.waitForSpeechEnd) {
      this.waitForSpeechEnd = false;
      this.finishingSpeech = true;
      clearTimeout(this.restartTimer);
      const mine = this.token;
      this.recordingLimit = setTimeout(() => this.finish(this.snapshot.transcript, mine), 1500);
      try { this.recognition.stop(); return; } catch { /* Keep the last result if stop fails. */ }
    }
    this.finish(this.snapshot.transcript, this.token);
  }

  private failListening(mine: number, message: string, showError = false) {
    if (this.token !== mine) return;
    const prefix = normalizedTranscript(this.snapshot.transcript);
    if (prefix) {
      this.finish(prefix, mine, showError ? message : undefined);
      return;
    }
    this.stopVad();
    this.set({ ...IDLE, error: message });
  }

  private finish(text: string, mine: number, error?: string) {
    if (this.token !== mine) return;
    const trimmed = text.trim();
    const onFinal = this.onFinal;
    this.stop("submit");
    if (error) this.set({ ...IDLE, error });
    if (trimmed) onFinal?.(trimmed);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readTranscriptionBody(
  response: Response,
  signal: AbortSignal,
): Promise<{ text?: string; error?: string; code?: string }> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_TRANSCRIPTION_RESPONSE_BYTES) {
    cancelResponse(response);
    throw new Error("Transcription response is too large.");
  }
  const bytes = await readBoundedResponseBytes(response, {
    maxBytes: MAX_TRANSCRIPTION_RESPONSE_BYTES,
    tooLargeMessage: "Transcription response is too large.",
    read: (operation) => withAbort(operation(), signal),
  });
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { text?: string; error?: string; code?: string })
      : {};
  } catch {
    return {};
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Request aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        // Prefer abort reason over a bare AbortError from fetch/read.
        reject(signal.aborted ? (signal.reason ?? error) : error);
      },
    );
  });
}

function cancelResponse(response: Response): void {
  try {
    void Promise.resolve(response.body?.cancel()).catch(() => undefined);
  } catch {
    // Response cleanup is best-effort.
  }
}

export const dictation = new Dictation();
