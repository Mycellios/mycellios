import { getGeneralPreferences, useGeneralPreferences } from "../../lib/general-preferences";
import type { LocalVoiceStatus } from "@rakazo/contracts";
import { useLingui } from "@lingui/react/macro";
import { isEchoOfSpeech, isRunWorking, isSecretAskBlock, normalizeRunError, speakable, speechFromBlocks, toUtterances } from "@rakazo/core";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Mic, MicOff, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dictation, webSpeechAvailable } from "../../lib/dictation";
import type { RpcClient } from "../../lib/rpc";
import { browserSpeechAvailable, speaker } from "../../lib/tts";
import { registerContinuousVoiceCloser } from "../../lib/continuous-voice-owner";
import { endCall } from "../../lib/call-session";
import { isAndroidHost } from "../../lib/android-host";
import { translateRunError } from "../../lib/run-error";
import { errorText } from "../../lib/user-error";

export function VoiceConversation({ hidden = false, rpc, accountId, spaceId, taskThreadId, bot, transcribe, voiceReady, onClose, onSettings }: {
  hidden?: boolean; rpc: RpcClient; accountId?: string; spaceId?: string | null; taskThreadId?: string;
  bot: { id: string; name: string; color: string }; transcribe?: boolean; voiceReady?: boolean;
  onClose: () => void; onSettings: () => void;
}) {
  const { t, i18n } = useLingui();
  const target = { botId: bot.id, taskThreadId };
  const [phase, setPhase] = useState("ready");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [speed, setSpeed] = useState(() => getGeneralPreferences().speechSpeed);
  const [model, setModel] = useState<LocalVoiceStatus | null>(null);
  const alive = useRef(true), generation = useRef(0), enabled = useRef(false), mute = useRef(false), rate = useRef(getGeneralPreferences().speechSpeed);
  const output = useRef<AudioContext | null>(null);
  const abort = useRef(new AbortController());
  const spoken = useRef("");
  const preparing = useRef(false);
  const preparationTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const native = window.rakazoDesktop?.localVoice;
  const preferences = useGeneralPreferences();
  const networkDictation = Boolean(accountId && preferences.networkTranscriptionAccount === accountId);
  const canCapture = Boolean(networkDictation || transcribe || isAndroidHost() || webSpeechAvailable());
  const networkReplies = Boolean(accountId && preferences.networkSpeechAccount === accountId);
  const localReplies = !networkReplies && preferences.speechEngine === "local";
  const modelsReady = (status: LocalVoiceStatus | null) => localReplies
    ? (networkDictation ? Boolean(status?.models?.tts.ready ?? status?.ready) : status?.ready === true)
    : canCapture || Boolean(status?.models?.asr.ready ?? status?.ready);
  const refresh = async () => { if (native) { const status = await native.status(); if (alive.current) setModel(status); } };
  useEffect(() => {
    alive.current = true;
    if (abort.current.signal.aborted) abort.current = new AbortController();
    let mounted = true;
    void (async () => {
      try {
        if (native) { const status = await native.status(); if (!mounted) return; setModel(status); if (modelsReady(status)) await start(); }
        else if (canCapture) await start();
      } catch { if (mounted) setError(t`Could not check local voice. Try again.`); }
    })();
    const stop = dictation.subscribe(s => { if (!alive.current) return; setLevel(s.level ?? 0); if (s.transcript) setCaption(s.transcript); if (s.error && enabled.current) stopWithError(errorText(s.error, t`Could not use the microphone. Check its permission and try again.`)); });
    const stopSpeaker = speaker.subscribe(s => {
      if (!alive.current || s.botId !== bot.id) return;
      if (s.level !== undefined) setLevel(s.level);
      if (s.status === "speaking") {setPhase("speaking"); if(s.caption) setCaption(s.caption);}
      else if (s.status === "preparing") setPhase("thinking");
    });
    const release = () => {
      if (!alive.current) return;
      clearInterval(preparationTimer.current);
      alive.current = false; enabled.current = false; generation.current++; abort.current.abort();
      dictation.stop("cancel"); speaker.stop(); void output.current?.close().catch(() => {}); void native?.stop().catch(() => {});
    };
    const unregister = registerContinuousVoiceCloser(() => { release(); onClose(); });
    return () => { mounted = false; unregister(); release(); stop(); stopSpeaker(); };
  }, []);
  function silence() {
    generation.current++; dictation.stop("cancel"); speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; void native?.stop().catch(() => {}); setLevel(0);
  }
  function stopWithError(message: string) {
    enabled.current = false;
    silence();
    setError(message);
    setPhase("ready");
  }
  async function listen(background = false) {
    if (!alive.current || !enabled.current || mute.current) return;
    if (!background) setPhase("listening"); setError(null);
    try { await dictation.listen({ spaceId, botId: bot.id, mode: "endpoint", transcribe, preferServer: transcribe,
      onSpeechStart: () => { if (!background) return; generation.current++; speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; void native?.stop().catch(() => {}); setPhase("listening"); },
      onFinal: text => { if (background) { generation.current++; speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; } void send(text); } }); }
    catch { if (alive.current && enabled.current) stopWithError(t`Could not use the microphone. Check its permission and try again.`); }
  }
  async function speak(text: string, own: number) {
    if (!alive.current || own !== generation.current) return;
    spoken.current = speakable(text); setCaption(text); setPhase("thinking");
    if (native && localReplies) {
      // Capture and synthesis share one local worker. Stop capture before inference.
      dictation.stop("cancel");
      // Native synthesis is bounded; play sequential parts, never truncate the reply.
      for (const part of toUtterances(text, { minChars: 12, maxChars: 1200 })) {
        if (!alive.current || own !== generation.current) return;
        setPhase("thinking");
        const audio = await native.speak({ text: part, language: i18n.locale.slice(0, 2), speed: rate.current });
        if (!alive.current || own !== generation.current) return;
        if (!audio.samples || !audio.sampleRate) throw new Error("No audio");
        const ctx = new AudioContext(); output.current = ctx; await ctx.resume();
        if (!alive.current || own !== generation.current) { if(ctx.state !== "closed") await ctx.close(); return; }
        const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate); buffer.copyToChannel(new Float32Array(audio.samples), 0);
        const source = ctx.createBufferSource(), analyser = ctx.createAnalyser(); source.buffer = buffer; source.connect(analyser); analyser.connect(ctx.destination);
        setPhase("speaking"); setCaption(part);
        const samples = new Uint8Array(analyser.fftSize);
        const timer = setInterval(() => { analyser.getByteTimeDomainData(samples); setLevel(Math.min(1, Math.sqrt(samples.reduce((n,x) => n + ((x-128)/128)**2, 0)/samples.length)*6)); }, 80);
        await new Promise<void>(resolve => { source.onended = () => resolve(); ctx.onstatechange = () => { if (ctx.state === "closed") resolve(); }; source.start(); });
        clearInterval(timer); if (ctx.state !== "closed") await ctx.close();
      }
    } else {
      const language = (preferences.dictationLanguage === "auto" ? i18n.locale : preferences.dictationLanguage).split("-")[0];
      if (networkReplies && language !== "es" && language !== "en") {
        stopWithError(t`Mycellios network voice supports Spanish and English. Set a dictation language in Voice settings.`);
        return;
      }
      const failure = await speaker.speak(speakable(text), {
        browser: !networkReplies && !voiceReady && browserSpeechAvailable(),
        networkLanguage: networkReplies ? language as "en" | "es" : undefined,
        botId: bot.id,
        spaceId,
        speed: rate.current,
      });
      if (failure && networkReplies) { stopWithError(failure); return; }
      if (failure) throw new Error(failure);
    }
  }
  async function send(text: string) {
    if (!text.trim() || !alive.current || !enabled.current || mute.current) { void listen(); return; }
    if (isEchoOfSpeech(text, spoken.current)) { void listen(); return; }
    const own = ++generation.current;
    setCaption(text); setPhase("thinking");
    let failureMessage = t`Could not send your voice message. Check the chat before trying again.`;
    try {
      const before = await rpc.threads.get(target, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      before.messages.forEach(m => seen.current.add(m.id));
      const sent = await rpc.threads.send({ ...target, text, clientNonce: crypto.randomUUID() }, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      const runIds = new Set([sent.runId, ...(sent.runIds ?? [])]);
      failureMessage = t`Could not follow the Mico’s response. Check the chat.`;
      const deadline = Date.now() + 5 * 60_000;
      void listen(true);
      while (alive.current && own === generation.current && Date.now() < deadline) {
        const snapshot = await rpc.threads.get(target, { signal: abort.current.signal });
        if (!alive.current || own !== generation.current) return;
        const matchesRun = (run: { id: string; taskId: string }) =>
          runIds.has(run.id) || run.taskId === sent.taskId;
        const run = snapshot.run && matchesRun(snapshot.run) ? snapshot.run : null;
        const activeRuns = snapshot.activeRuns?.filter(matchesRun) ?? [];
        if (run?.status === "failed" || run?.status === "cancelled") {
          stopWithError(run.error
            ? normalizeRunError(run.error, translateRunError, i18n.locale).summary
            : t`The Mico stopped responding. Check the chat.`);
          return;
        }
        for (const active of activeRuns) runIds.add(active.id);
        if (run) runIds.add(run.id);
        const messages = snapshot.messages.filter(m =>
          m.role === "bot" && !seen.current.has(m.id) && m.runId && runIds.has(m.runId),
        );
        if (messages.some(m => m.blocks.some(b => b.kind === "ask" && b.status !== "answered" && isSecretAskBlock(b)))) {
          silence(); enabled.current = false; setPhase("ready"); setCaption(t`Enter the requested secret on screen, then restart voice.`); return;
        }
        const waitingForInput = run?.status === "waiting_input" || activeRuns.some(active => active.status === "waiting_input");
        const stillWorking = isRunWorking(run?.status) || activeRuns.some(active => isRunWorking(active.status));
        if (snapshot.cursor >= sent.seq && (waitingForInput || (!stillWorking && (run?.status === "completed" || messages.length)))) {
          messages.forEach(m => seen.current.add(m.id));
          const text = messages.map(m => speechFromBlocks(m.blocks)).filter(Boolean).join("\n\n");
          failureMessage = t`Could not play the reply. You can read it in the chat.`;
          if (text) await speak(text, own);
          if (own === generation.current) { setCaption(""); setLevel(0); await listen(); }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (alive.current && own === generation.current) stopWithError(failureMessage);
    } catch { if (alive.current && own === generation.current) stopWithError(failureMessage); }
  }
  async function start() {
    if (!alive.current) return;
    const own = ++generation.current;
    setError(null); setPhase("starting"); endCall();
    try {
      const snapshot = await rpc.threads.get(target, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      snapshot.messages.forEach(m => seen.current.add(m.id));
      enabled.current = true; await listen();
    } catch { if (alive.current && own === generation.current) stopWithError(t`Could not open this chat for voice. Try again.`); }
  }
  async function prepare() {
    if (!native || preparing.current) return;
    preparing.current = true;
    setPhase("preparing"); setError(null);
    preparationTimer.current = setInterval(() => void refresh().catch(() => {}), 1000);
    try {
      if (networkDictation && localReplies && native.prepareModel) await native.prepareModel("tts");
      else if (!localReplies && native.prepareModel) await native.prepareModel("asr");
      else await native.prepare();
      await refresh();
      if (alive.current) await start();
    }
    catch { if (alive.current) stopWithError(t`Could not prepare local voice. Try again.`); }
    finally { clearInterval(preparationTimer.current); preparationTimer.current = undefined; preparing.current = false; }
  }
  const needsModels = Boolean(native && !modelsReady(model));
  const canStart = native ? modelsReady(model) : canCapture;
  const download = localReplies ? model : model?.models?.asr ?? model;
  return <aside style={{ display: hidden ? "none" : undefined }} aria-hidden={hidden || undefined} role="dialog" data-continuous-voice aria-label={t`Voice conversation`} className="fixed inset-y-0 end-0 z-40 flex w-full flex-col border-s border-border bg-background md:w-[400px]">
    <header data-testid="voice-panel-header" className="flex h-[50px] shrink-0 items-center justify-between border-b border-border px-4"><span className="text-sm font-medium">{bot.name}</span><Button variant="ghost" size="icon" aria-label={t`Close voice`} onClick={onClose}><X /></Button></header>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
    <p aria-live="polite" className="mt-2 text-center text-sm text-muted-foreground">{phase === "listening" ? t`Listening` : phase === "speaking" ? t`Speaking` : phase === "thinking" ? t`Thinking` : phase === "preparing" ? t`Preparing local voice…` : t`Voice`}</p>
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
      <div style={{ transform: `scale(${1 + level * .12})` }}><BotAvatar identity={bot.id} color={bot.color} size={112} /></div>
      <div className="flex h-6 items-center gap-1" aria-hidden="true">{Array.from({length: 24}, (_, i) => <span key={i} className="w-0.5 rounded-full bg-muted-foreground" style={{ height: 2 + level * 24 * (1 - Math.abs(i-11.5)/24) }} />)}</div>
      <p className="max-h-40 overflow-y-auto text-center text-sm text-muted-foreground" dir="auto">{caption || (phase === "listening" ? t`Speak now` : "")}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {needsModels ? <Button disabled={phase === "preparing"} onClick={() => void prepare()}>{phase === "preparing" ? `${Math.round((download?.downloaded ?? 0)/1024/1024)} / ${Math.round((download?.total ?? 0)/1024/1024)} MB` : t`Activate local voice`}</Button> : phase === "ready" ? <Button disabled={!canStart} onClick={() => void start()}>{t`Start talking`}</Button> : null}
      {needsModels ? <p className="max-w-xs text-center text-xs text-muted-foreground">{localReplies ? t`Parakeet and Supertonic 3. Download once, then process audio on this computer without credits.` : t`Download Parakeet to transcribe on this computer.`}</p> : null}
      {!canStart && !needsModels ? <p className="text-center text-sm text-muted-foreground">{t`Connect a transcription provider in Voice settings, or use local voice in Desktop.`}</p> : null}
      {!native ? <Button variant="ghost" onClick={onSettings}>{t`Voice settings`}</Button> : null}
    </div>
    </div>
    <footer className="flex shrink-0 justify-center gap-3 px-6 py-4">
      <Button className="rounded-full" variant="secondary" aria-label={t`Playback speed`} onClick={() => { rate.current = rate.current === 1 ? 1.25 : rate.current === 1.25 ? 1.5 : 1; setSpeed(rate.current); }}>{speed}×</Button>
      <Button className="rounded-full" variant="secondary" size="icon" aria-label={t`Mute microphone`} aria-pressed={muted} onClick={() => { mute.current = !mute.current; setMuted(mute.current); silence(); if (!mute.current) void listen(); }}>{muted ? <MicOff/> : <Mic/>}</Button>
      <Button className="rounded-full" variant="secondary" size="icon" aria-label={t`Interrupt reply`} onClick={() => { silence(); void listen(); }}><Square/></Button>
      <Button className="rounded-full" variant="destructive" size="icon" aria-label={t`End voice conversation`} onClick={onClose}><X/></Button>
    </footer>
  </aside>;
}
