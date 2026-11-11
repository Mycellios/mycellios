import { getGeneralPreferences } from "./general-preferences";
import type { SettingsScope } from "@rakazo/contracts";
import { readBoundedResponseBytes, toUtterances } from "@rakazo/core";
import { appPath } from "./app-path";
import { rpc, selectedSpaceId, withSpaceHeaders } from "./rpc.js";
import { errorText, voiceAccountErrorText } from "./user-error.js";

export type SpeechStatus = "idle" | "preparing" | "speaking";

export interface SpeechSnapshot {
  status: SpeechStatus;
  botId?: string;
  messageId?: string;
  caption?: string;
  error?: string;
  level?: number;
}

interface SpeakOptions {
  speed?: number;
  /** Explicit manual playback using an installed device voice. No server request. */
  browser?: boolean;
  spaceId?: string | null;
  /** Which copy of the voice settings to use; omitted means whichever applies in the space. */
  scope?: SettingsScope;
  voiceId?: string;
  botId?: string;
  messageId?: string;
  networkLanguage?: "en" | "es";
}

type TtsErrorBody = { error?: string; code?: string };

const IDLE: SpeechSnapshot = { status: "idle" };
export const VOICE_RESPONSE_TIMEOUT_MS = 70_000;
export const MAX_VOICE_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_VOICE_ERROR_BYTES = 64 * 1024;

export function browserSpeechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export class Speaker {
  private localContext?: AudioContext;
  private finishLocal?: () => void;
  private localActive = false;
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<(s: SpeechSnapshot) => void>();
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settlePlayback: ((finished: boolean) => void) | null = null;
  private request: AbortController | null = null;
  private settleBrowser: (() => void) | null = null;
  private outputMeter?: { context: AudioContext; timer: ReturnType<typeof setInterval> };

  subscribe(fn: (s: SpeechSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): SpeechSnapshot {
    return this.snapshot;
  }

  private set(next: SpeechSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  isSpeaking(messageId?: string): boolean {
    if (this.snapshot.status === "idle") return false;
    return messageId ? this.snapshot.messageId === messageId : true;
  }

  stop() {
    this.token += 1;
    this.finishLocal?.(); this.finishLocal = undefined;
    void this.localContext?.close().catch(() => {}); this.localContext = undefined;
    if (this.localActive) void window.rakazoDesktop?.localVoice?.stop().catch(() => {});
    this.localActive = false;
    if (this.settleBrowser) {
      const settle = this.settleBrowser;
      this.settleBrowser = null;
      window.speechSynthesis.cancel();
      settle();
    }
    this.request?.abort();
    this.request = null;
    if (this.settlePlayback) this.settlePlayback(false);
    else this.teardownAudio();
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  private teardownAudio() {
    if (this.outputMeter) { clearInterval(this.outputMeter.timer); void this.outputMeter.context.close(); this.outputMeter = undefined; }
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** Resolves with this request's failure text; stopping or superseding it resolves with none. */
  async speak(text: string, opts: SpeakOptions = {}): Promise<string | undefined> {
    this.stop();
    const network = opts.networkLanguage !== undefined;
    if (!network && typeof window !== "undefined" && window.rakazoDesktop?.localVoice && getGeneralPreferences().speechEngine === "local") return this.speakLocal(text, opts);
    if (!network && opts.browser) return this.speakBrowser(text, opts);
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    const spaceId = opts.spaceId !== undefined ? opts.spaceId : selectedSpaceId();

    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    let utterances: string[];
    try {
      utterances = network
        ? toUtterances(text, { maxChars: 320 })
        : await withAbort(controller.signal, () => this.prepare(text, opts, controller.signal, spaceId));
    } catch (error) {
      const failure = live() ? errorText(error) : undefined;
      if (failure) this.set({ ...IDLE, error: failure });
      if (this.request === controller) this.request = null;
      return failure;
    }
    if (!live()) return;
    if (!utterances.length) {
      this.set(IDLE);
      if (this.request === controller) this.request = null;
      return;
    }

    type Rendered = { blob: Blob; error?: never } | { blob?: never; error: unknown };
    const render = (utterance: string): Promise<Rendered> =>
      this.render(utterance, opts, controller.signal, spaceId).then(
        (blob) => ({ blob }),
        (error: unknown) => ({ error }),
      );
    let next: Promise<Rendered> | null = render(utterances[0] ?? "");
    for (let i = 0; i < utterances.length; i += 1) {
      const current = next;
      next = !network && i + 1 < utterances.length ? render(utterances[i + 1] ?? "") : null;
      if (!current) break;
      const rendered = await current;
      if ("error" in rendered) {
        const failure = live() ? errorText(rendered.error) : undefined;
        if (failure) this.set({ ...IDLE, error: failure });
        if (this.request === controller) this.request = null;
        return failure;
      }
      if (!live()) return;
      this.set({
        status: "speaking",
        botId: opts.botId,
        messageId: opts.messageId,
        caption: utterances[i],
      });
      const finished = await this.play(rendered.blob, live, opts.speed ?? getGeneralPreferences().speechSpeed);
      if (!finished || !live()) {
        if (live()) this.set(IDLE);
        if (this.request === controller) this.request = null;
        return;
      }
      // Each network clip can use credits. Request the next one only after playback succeeds.
      if (network && i + 1 < utterances.length) next = render(utterances[i + 1] ?? "");
    }
    if (live()) this.set(IDLE);
    if (this.request === controller) this.request = null;
  }

  private async speakLocal(text: string, opts: SpeakOptions): Promise<string | undefined> {
    const native = window.rakazoDesktop!.localVoice!; const mine = this.token;
    this.localActive = true;
    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    try {
      const state = await native.status(); if (mine !== this.token) return;
      if (!(state.models?.tts.ready ?? state.ready)) throw Error("Descarga Supertonic en Ajustes > Voz.");
      const language = getGeneralPreferences().dictationLanguage === "auto" ? (navigator.language || "es").split("-")[0]! : getGeneralPreferences().dictationLanguage;
      for (const part of text.match(/[\s\S]{1,1800}/g) ?? []) {
        const result = await native.speak({ text: part, language, speed: opts.speed ?? getGeneralPreferences().speechSpeed });
        if (mine !== this.token) return;
        if (!result.samples?.length || !result.sampleRate) throw Error("No se ha podido generar la voz local.");
        const context = new AudioContext({ sampleRate: result.sampleRate }); this.localContext = context;
        const buffer = context.createBuffer(1, result.samples.length, result.sampleRate);
        buffer.copyToChannel(new Float32Array(result.samples), 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        this.set({status:"speaking",botId:opts.botId,messageId:opts.messageId,caption:part});
        await context.resume();
        if (mine !== this.token) { await context.close(); return; }
        await new Promise<void>(resolve => { this.finishLocal = resolve; source.onended = () => resolve(); source.start(); });
        this.finishLocal = undefined; await context.close().catch(() => {}); this.localContext = undefined;
        if (mine !== this.token) return;
      }
      this.set(IDLE);
    } catch (error) { if (mine === this.token) { const failure = errorText(error); this.set({...IDLE,error:failure}); return failure; } }
    finally { if (mine === this.token) { this.localActive = false; void this.localContext?.close().catch(() => {}); this.localContext = undefined; this.finishLocal = undefined; } }
  }

  private async speakBrowser(text: string, opts: SpeakOptions): Promise<string | undefined> {
    if (!browserSpeechAvailable()) return "Read aloud is not available on this device.";
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService);
    const language = navigator.language.split("-")[0];
    const preferred = getGeneralPreferences().deviceVoice;
    const voice = voices.find(item => item.voiceURI === preferred) ?? voices.find((item) => item.lang.split("-")[0] === language) ?? voices[0];
    if (!voice) return "No device voice is available. You can still read the reply.";
    const mine = this.token;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.rate = opts.speed ?? getGeneralPreferences().speechSpeed;
    utterance.lang = voice.lang;
    this.set({ status: "speaking", botId: opts.botId, messageId: opts.messageId, caption: text });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        utterance.onend = null;
        utterance.onerror = null;
        if (this.settleBrowser === cancel) this.settleBrowser = null;
        if (this.token === mine) this.set(error ? { ...IDLE, error } : IDLE);
        resolve(error);
      };
      const cancel = () => finish();
      this.settleBrowser = cancel;
      utterance.onend = () => finish();
      utterance.onerror = () => finish("The device could not read this reply.");
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish("The device could not read this reply.");
      }
    });
  }

  private async prepare(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<string[]> {
    const body = await rpc.voice.prepare(
      { text, voiceId: opts.voiceId, botId: opts.botId, scope: opts.scope },
      { signal, context: { spaceId } },
    );
    if (!body.ready) {
      throw new Error("Add a voice provider key and pick a voice in Voice settings.");
    }
    return body.utterances ?? [];
  }

  private async render(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<Blob> {
    const deadline = requestDeadline(signal, VOICE_RESPONSE_TIMEOUT_MS);
    try {
      const res = await withAbort(deadline.signal, () =>
        fetch(appPath("/api/voice/speak"), {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({
            text,
            voiceId: opts.voiceId,
            botId: opts.botId,
            scope: opts.scope,
            networkLanguage: opts.networkLanguage,
          }),
          signal: deadline.signal,
        }),
      );
      if (!res.ok) {
        const body = await readVoiceError(res, deadline.signal);
        throw new Error(voiceAccountErrorText(body) ?? body.error ?? "");
      }
      const bytes = await readResponseBytes(res, MAX_VOICE_AUDIO_BYTES, deadline.signal);
      return new Blob([new Uint8Array(bytes)], {
        type: res.headers.get("content-type") ?? "audio/mpeg",
      });
    } finally {
      deadline.dispose();
    }
  }

  private play(blob: Blob, live: () => boolean, speed = 1): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = speed;
      this.audio = audio;
      if (typeof AudioContext !== "undefined") {
        try {
          const context = new AudioContext(), analyser = context.createAnalyser();
          context.createMediaElementSource(audio).connect(analyser); analyser.connect(context.destination);
          const samples = new Uint8Array(analyser.fftSize);
          const timer = setInterval(() => { if (!live()) return; analyser.getByteTimeDomainData(samples);
            this.set({ ...this.snapshot, level: Math.min(1, Math.sqrt(samples.reduce((n,x)=>n+((x-128)/128)**2,0)/samples.length)*6) }); }, 80);
          this.outputMeter = {context,timer}; void context.resume();
        } catch { /* Playback remains available on hosts without Web Audio meters. */ }
      }
      this.objectUrl = url;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        resolve(ok);
      };
      this.settlePlayback = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.play().catch(() => done(false));
    });
  }
}

export const speaker = new Speaker();

function withAbort<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    run().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requestDeadline(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) abortFromParent();
  else parent.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Voice request timed out.")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}

async function readVoiceError(response: Response, signal: AbortSignal): Promise<TtsErrorBody> {
  const bytes = await readResponseBytes(response, MAX_VOICE_ERROR_BYTES, signal);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TtsErrorBody) : {};
  } catch {
    return {};
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelResponse(response);
    throw new Error("Voice response is too large.");
  }
  return readBoundedResponseBytes(response, {
    maxBytes,
    tooLargeMessage: "Voice response is too large.",
    read: (operation) => withAbort(signal, operation),
  });
}

function cancelResponse(response: Response): void {
  try {
    void Promise.resolve(response.body?.cancel()).catch(() => undefined);
  } catch {
    // Response cleanup is best-effort.
  }
}
