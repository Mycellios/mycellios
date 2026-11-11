import { useLingui } from "@lingui/react/macro";
import { isAttachmentAudioMimeType } from "@rakazo/contracts";
import { Button, Spinner } from "@rakazo/ui-web";
import { Check, Mic, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isAndroidHost } from "../../lib/android-host";
import { dictation } from "../../lib/dictation";

type Capture = {
  scope: string;
  startedAt: number;
  audio: Blob | null;
  words: string;
  onFinal: (words: string) => void;
  phase: "recording" | "finishing";
  finalizing: boolean;
};

export function appendSpeech(draft: string, speech: string) {
  const words = speech.trim();
  return words ? `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${words}` : draft;
}

async function voiceFile(audio: Blob, name: string): Promise<File> {
  const mime = audio.type.split(";")[0] ?? "";
  if (isAttachmentAudioMimeType(mime)) {
    const extension = mime === "audio/mp4" ? "m4a" : mime === "audio/mpeg" ? "mp3" : mime.slice(6);
    return new File([audio], `${name}.${extension}`, { type: mime });
  }
  // Some recorders only emit WebM. Use the existing WAV attachment format.
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    if (decoded.duration > 62) throw new Error("Voice recording too long");
    const rate = 16_000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
      new Uint8Array(wav, offset, 4).set(new TextEncoder().encode(value));
    }
    view.setUint32(4, wav.byteLength - 8, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + index * 2, clamped * (clamped < 0 ? 32768 : 32767), true);
    });
    return new File([wav], `${name}.wav`, { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

export function useComposerVoice({ scope, botId, transcribe, blocked, onText, onAudio }: {
  scope: string;
  botId?: string;
  transcribe?: boolean;
  blocked: boolean;
  onText: (words: string) => void;
  onAudio: (file: File) => boolean;
}) {
  const { t } = useLingui();
  const capture = useRef<Capture | null>(null);
  const labels = {
    name: t`Voice message`,
    attach: t`Could not attach the recording.`,
    prepare: t`Could not prepare the recording.`,
    empty: t`No speech was detected.`,
  };
  const latest = useRef({ scope, onText, onAudio, labels });
  latest.current = { scope, onText, onAudio, labels };
  const [state, setState] = useState<{ phase: Capture["phase"]; startedAt: number } | null>(null);
  const [preview, setPreview] = useState("");
  const [transcriptAfterStop, setTranscriptAfterStop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function owns(session: Capture) {
    return capture.current === session && session.scope === latest.current.scope;
  }

  useLayoutEffect(() => {
    setState(null);
    setPreview("");
    setTranscriptAfterStop(false);
    setError(null);
    return () => {
      const current = capture.current;
      capture.current = null;
      if (current && dictation.owns(current.onFinal)) dictation.stop("cancel");
    };
  }, [scope]);

  useEffect(() => dictation.subscribe(snapshot => {
    const session = capture.current;
    if (!session || !owns(session)) return;
    if (snapshot.status !== "idle") {
      if (!dictation.owns(session.onFinal)) return;
      session.words = snapshot.transcript || session.words;
      setPreview(session.words);
      setTranscriptAfterStop(Boolean(snapshot.transcriptAfterStop));
      if (snapshot.status === "transcribing" && session.phase === "recording") {
        session.phase = "finishing";
        setState({ phase: "finishing", startedAt: session.startedAt });
      }
      return;
    }
    // The recognizer publishes idle just before it supplies its final words.
    queueMicrotask(async () => {
      if (!owns(session) || (dictation.state.status !== "idle" && dictation.owns(session.onFinal)) || session.finalizing) return;
      session.finalizing = true;
      let failure = snapshot.error ?? dictation.state.error ?? null;
      if (session.audio) {
        try {
          const file = await voiceFile(session.audio, latest.current.labels.name);
          if (!owns(session)) return;
          if (!latest.current.onAudio(file)) failure = latest.current.labels.attach;
        } catch {
          failure = latest.current.labels.prepare;
        }
      }
      if (!owns(session)) return;
      if (session.words.trim()) latest.current.onText(session.words);
      capture.current = null;
      setState(null);
      setPreview("");
      setTranscriptAfterStop(false);
      setError(failure ?? (!session.words.trim() && !session.audio ? latest.current.labels.empty : null));
    });
  }), []);

  function start(recordAudio = false) {
    if (capture.current || blocked || dictation.state.status !== "idle") return;
    const session: Capture = {
      scope, startedAt: Date.now(), audio: null, words: "", phase: "recording", finalizing: false,
      onFinal: words => { if (owns(session)) session.words = words; },
    };
    capture.current = session;
    setState({ phase: "recording", startedAt: session.startedAt });
    setError(null);
    void dictation.listen({
      mode: "hold", botId,
      transcribe,
      preferServer: transcribe,
      liveTranscript: !recordAudio,
      onSpeechStart: () => {},
      waitForSpeechEnd: true,
      onRecording: recordAudio ? audio => { if (owns(session)) session.audio = audio; } : undefined,
      onFinal: session.onFinal,
    }).catch(() => {
      if (!owns(session)) return;
      capture.current = null;
      if (dictation.owns(session.onFinal)) dictation.stop("cancel");
      setState(null);
      setPreview("");
      setTranscriptAfterStop(false);
      setError(t`Could not start the microphone. Try again.`);
    });
  }

  function finish() {
    const session = capture.current;
    if (!session || session.phase !== "recording" || !dictation.owns(session.onFinal)) return;
    session.phase = "finishing";
    setState({ phase: "finishing", startedAt: session.startedAt });
    dictation.submitHold();
  }

  function cancel() {
    const session = capture.current;
    if (!session) return;
    capture.current = null;
    if (dictation.owns(session.onFinal)) dictation.stop("cancel");
    setState(null);
    setPreview("");
    setTranscriptAfterStop(false);
    setError(null);
  }

  useEffect(() => {
    if (state?.phase !== "recording") return;
    if (blocked) { finish(); return; }
    const visibility = () => {
      if (!isAndroidHost() && document.visibilityState === "hidden") finish();
    };
    document.addEventListener("visibilitychange", visibility);
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    void navigator.wakeLock?.request("screen").then(value => {
      if (disposed) void value.release(); else lock = value;
    }).catch(() => {});
    return () => {
      disposed = true;
      void lock?.release();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [state?.phase, blocked]);

  return { state, preview, transcriptAfterStop, error, start, finish, cancel };
}

function VoiceWave({ startedAt, compact = false }: { startedAt: number; compact?: boolean }) {
  const [levels, setLevels] = useState(() => Array<number>(compact ? 14 : 64).fill(0));
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      const level = Math.max(0, Math.min(1, dictation.state.level ?? 0));
      setLevels(previous => level === 0 && previous.every(sample => sample === 0) ? previous : [...previous.slice(1), level]);
    }, 90);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <>
    {!compact ? <span className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" aria-hidden /> : null}
    <span className={compact ? "sr-only" : "shrink-0 tabular-nums"}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    <span dir="ltr" className={`flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden ${compact ? "h-4 text-foreground/75" : "h-6 text-status-working"}`} aria-hidden>
      {levels.map((level, index) => <span key={index} className={`${compact ? "h-[14px]" : "h-[22px]"} w-[3px] shrink-0 rounded-full bg-current transition-transform duration-100 motion-reduce:transition-none`} style={{ transform: `scaleY(${0.2 + Math.min(1, level * 1.3) * 0.8})` }} />)}
    </span>
  </>;
}

export function ComposerVoiceStrip({ voice, compact = false }: { voice: ReturnType<typeof useComposerVoice>; compact?: boolean }) {
  const { t } = useLingui();
  if (!voice.state) return null;
  const recording = voice.state.phase === "recording";
  if (compact) return (
    <div data-testid="composer-voice-strip" className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-muted-foreground">
      <div className="flex w-[74px] items-center justify-center ps-1">
        {recording ? <VoiceWave startedAt={voice.state.startedAt} compact /> : <Spinner className="size-3.5" />}
      </div>
      <span role="status" className="sr-only">{recording ? t`Listening…` : t`Transcribing…`}</span>
      <Button type="button" variant="ghost" size="icon" className="size-6 rounded-full" aria-label={t`Discard recording`} onClick={voice.cancel}>
        <X className="size-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" size="icon" className="size-6 rounded-full" aria-label={t`Stop recording`} disabled={!recording} onClick={voice.finish}>
        <Check className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
  return <div data-testid="composer-voice-strip" className="flex min-h-10 w-full min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
    {recording ? <VoiceWave startedAt={voice.state.startedAt} /> : <Spinner />}
    <span role="status" className={recording ? "sr-only" : undefined}>{recording ? t`Listening…` : t`Transcribing…`}</span>
  </div>;
}

export function ComposerVoiceButton({ voice, disabled }: { voice: ReturnType<typeof useComposerVoice>; disabled?: boolean }) {
  const { t } = useLingui();
  const recording = voice.state?.phase === "recording";
  return <Button type="button" variant="ghost" size="icon"
    className="size-10 shrink-0 rounded-full bg-muted text-muted-foreground transition-[transform,color] hover:bg-accent hover:text-foreground active:scale-95 motion-reduce:transition-none md:size-7"
    aria-label={recording ? t`Stop recording` : t`Dictate message`}
    title={recording ? t`Stop recording` : t`Dictate message`}
    disabled={voice.state ? !recording : disabled}
    onClick={() => recording ? voice.finish() : voice.start()}>
    {recording ? <Check size={16} aria-hidden /> : voice.state ? <Spinner /> : <Mic size={16} aria-hidden />}
  </Button>;
}

export function DraftAudioPreview({ file }: { file: File }) {
  const { t } = useLingui();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  return <audio controls preload="metadata" aria-label={t`Voice message`} src={url} className="h-10 min-w-0 max-w-full flex-1" />;
}
