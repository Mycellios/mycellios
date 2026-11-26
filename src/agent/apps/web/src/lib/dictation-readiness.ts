import { readBoundedResponseBytes } from "@mycellios/core";
import type { MycelliosDesktop } from "./desktop";
import { appPath } from "./app-path";
import { withSpaceHeaders } from "./rpc.js";
import { errorText, voiceAccountErrorText } from "./user-error.js";

/**
 * Checks made while a dictation starts recording, so a recording that could never become
 * text stops at once with its reason instead of after the person has said everything.
 */

/** How long the transcription check may take before the recording goes on unchecked. */
export const READINESS_TIMEOUT_MS = 15_000;
/** How long a microphone may deliver exact silence before dictation stops. */
export const MICROPHONE_SIGNAL_MS = 1_500;
export const MICROPHONE_SILENT =
  "The microphone is not sending any sound. Check that Mycellios may use the microphone in your system settings, then try again.";
const MAX_CHECK_RESPONSE_BYTES = 16 * 1024;

type LocalVoice = NonNullable<MycelliosDesktop["localVoice"]>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * A working microphone always carries some noise. Exact zeros for the whole window mean the
 * system gave the app a muted stream (for example, without microphone permission).
 * Resolves undefined when the signal cannot be measured, which is not a refusal.
 */
export async function microphoneDeliversSignal(
  stream: MediaStream,
  windowMs = MICROPHONE_SIGNAL_MS,
): Promise<boolean | undefined> {
  const Ctor: (new () => AudioContext) | undefined = typeof AudioContext === "function"
    ? AudioContext
    : typeof window === "undefined" ? undefined
      : (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  let ctx: AudioContext | undefined;
  try {
    ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    if (typeof analyser.getFloatTimeDomainData !== "function") return undefined;
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    if (ctx.state === "suspended") await ctx.resume();
    const data = new Float32Array(analyser.fftSize);
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (stream.getAudioTracks().every((track) => track.readyState === "ended")) return undefined;
      analyser.getFloatTimeDomainData(data);
      if (data.some((sample) => sample !== 0)) return true;
    }
    return ctx.state === "running" ? false : undefined;
  } catch {
    return undefined;
  } finally {
    void ctx?.close().catch(() => undefined);
  }
}

/**
 * The reason this recording could not be transcribed, or null when it can. Rejects when the
 * answer is unknown (slow or unreachable): that is not a refusal and the recording goes on.
 */
export function transcriptionProblem(input: {
  local: boolean;
  native: LocalVoice | undefined;
  network: { accountId: string; botId: string } | null;
  spaceId: string | null;
  timeoutMs?: number;
}): Promise<string | null> {
  const timeoutMs = input.timeoutMs ?? READINESS_TIMEOUT_MS;
  if (input.local) {
    if (!input.native) return Promise.resolve("Local transcription is unavailable.");
    // A short silence also loads the model, so the real transcription starts warm.
    return withTimeout(input.native.transcribe(new Float32Array(8_000)).then(
      () => null,
      (error: unknown) => errorText(error, "Local transcription failed."),
    ), timeoutMs);
  }
  const network = input.network;
  return withTimeout(fetch(appPath("/api/voice/transcribe/check"), {
    method: "POST",
    headers: withSpaceHeaders({ "content-type": "application/json" }, input.spaceId),
    credentials: "include",
    body: JSON.stringify(network ? { networkAccountId: network.accountId, botId: network.botId } : {}),
  }).then(async (res) => {
    // An older server has no check; the recording then reports at the end as before.
    if (res.ok || res.status === 404) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    let body: { error?: string; code?: string } = {};
    try {
      const bytes = await readBoundedResponseBytes(res, { maxBytes: MAX_CHECK_RESPONSE_BYTES, tooLargeMessage: "Response is too large.", read: (operation) => operation() });
      body = JSON.parse(new TextDecoder().decode(bytes)) as typeof body;
    } catch {
      // The status alone still means transcription is not available.
    }
    return voiceAccountErrorText(body) ?? body.error ?? "Transcription is unavailable right now.";
  }), timeoutMs);
}
