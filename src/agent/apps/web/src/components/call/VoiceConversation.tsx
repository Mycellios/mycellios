import { useLingui } from "@lingui/react/macro";
import { isEchoOfSpeech, isSecretAskBlock, speakable, speechFromBlocks, toUtterances } from "@rakazo/core";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Mic, MicOff, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dictation, webSpeechAvailable } from "../../lib/dictation";
import type { RpcClient } from "../../lib/rpc";
import { browserSpeechAvailable, speaker } from "../../lib/tts";
import { registerContinuousVoiceCloser } from "../../lib/continuous-voice-owner";
import { endCall } from "../../lib/call-session";

export function VoiceConversation({ rpc, spaceId, taskThreadId, bot, transcribe, onClose, onSettings }: {
  rpc: RpcClient; spaceId?: string | null; taskThreadId?: string;
  bot: { id: string; name: string; color: string }; transcribe?: boolean;
  onClose: () => void; onSettings: () => void;
}) {
  const { t, i18n } = useLingui();
  const target = { botId: bot.id, taskThreadId };
  const [phase, setPhase] = useState("ready");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [model, setModel] = useState<{ ready: boolean; preparing: boolean; downloaded: number; total: number } | null>(null);
  const alive = useRef(true), generation = useRef(0), enabled = useRef(false), mute = useRef(false), rate = useRef(1);
  const output = useRef<AudioContext | null>(null);
  const abort = useRef(new AbortController());
  const spoken = useRef("");
  const seen = useRef(new Set<string>());
  const native = window.rakazoDesktop?.localVoice;
  const refresh = async () => { if (native) { const status = await native.status(); if (alive.current) setModel(status); } };
  useEffect(() => {
    alive.current = true;
    if (abort.current.signal.aborted) abort.current = new AbortController();
    let mounted = true;
    void (async () => {
      try {
        if (native) { const status = await native.status(); if (!mounted) return; setModel(status); if (status.ready) await start(); }
        else if (transcribe || webSpeechAvailable()) await start();
      } catch { if (mounted) setError(true); }
    })();
    const stop = dictation.subscribe(s => { if (!alive.current) return; setLevel(s.level ?? 0); if (s.transcript) setCaption(s.transcript); if (s.error) {enabled.current = false; silence(); setError(true); setPhase("ready");} });
    const stopSpeaker = speaker.subscribe(s => {
      if (!alive.current || s.botId !== bot.id) return;
      if (s.level !== undefined) setLevel(s.level);
      if (s.status === "speaking") {setPhase("speaking"); if(s.caption) setCaption(s.caption);}
      else if (s.status === "preparing") setPhase("thinking");
    });
    const release = () => {
      if (!alive.current) return;
      alive.current = false; enabled.current = false; generation.current++; abort.current.abort();
      dictation.stop("cancel"); speaker.stop(); void output.current?.close().catch(() => {}); void native?.stop().catch(() => {});
    };
    const unregister = registerContinuousVoiceCloser(() => { release(); onClose(); });
    return () => { mounted = false; unregister(); release(); stop(); stopSpeaker(); };
  }, []);
  function silence() {
    generation.current++; dictation.stop("cancel"); speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; void native?.stop().catch(() => {}); setLevel(0);
  }
  async function listen(background = false) {
    if (!alive.current || !enabled.current || mute.current) return;
    if (!background) setPhase("listening"); setError(false);
    try { await dictation.listen({ spaceId, mode: "endpoint", transcribe, preferServer: transcribe,
      onSpeechStart: () => { if (!background) return; generation.current++; speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; void native?.stop().catch(() => {}); setPhase("listening"); },
      onFinal: text => { if (background) { generation.current++; speaker.stop(); void output.current?.close().catch(() => {}); output.current = null; } void send(text); } }); }
    catch { if (alive.current) { enabled.current = false; silence(); setError(true); setPhase("ready"); } }
  }
  async function speak(text: string, own: number) {
    if (!alive.current || own !== generation.current) return;
    spoken.current = speakable(text); setCaption(text); setPhase("thinking");
    if (native) {
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
        void listen(true);
        const samples = new Uint8Array(analyser.fftSize);
        const timer = setInterval(() => { analyser.getByteTimeDomainData(samples); setLevel(Math.min(1, Math.sqrt(samples.reduce((n,x) => n + ((x-128)/128)**2, 0)/samples.length)*6)); }, 80);
        await new Promise<void>(resolve => { source.onended = () => resolve(); ctx.onstatechange = () => { if (ctx.state === "closed") resolve(); }; source.start(); });
        clearInterval(timer); if (ctx.state !== "closed") await ctx.close();
      }
    } else {
      void listen(true);
      const failure = await speaker.speak(speakable(text), { browser: !transcribe && browserSpeechAvailable(), botId: bot.id, spaceId, speed: rate.current });
      if (failure) throw new Error(failure);
    }
  }
  async function send(text: string) {
    if (!text.trim() || !alive.current || !enabled.current || mute.current) { void listen(); return; }
    if (isEchoOfSpeech(text, spoken.current)) { void listen(); return; }
    const own = ++generation.current;
    setCaption(text); setPhase("thinking");
    try {
      const before = await rpc.threads.get(target, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      before.messages.forEach(m => seen.current.add(m.id));
      await rpc.threads.send({ ...target, text, clientNonce: crypto.randomUUID() }, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      void listen(true);
      while (alive.current && own === generation.current) {
        const snapshot = await rpc.threads.get(target, { signal: abort.current.signal });
        if (!alive.current || own !== generation.current) return;
        if (snapshot.run?.status === "failed") throw new Error("Chat run failed");
        if (snapshot.messages.some(m => m.blocks.some(b => b.kind === "ask" && b.status !== "answered" && isSecretAskBlock(b)))) {
          silence(); enabled.current = false; setPhase("ready"); setCaption(t`Enter the requested secret on screen, then restart voice.`); return;
        }
        if (snapshot.run?.status === "waiting_input" || (!snapshot.activeRuns?.length && !["running", "queued", "leased"].includes(snapshot.run?.status ?? ""))) {
          const messages = snapshot.messages.filter(m => m.role === "bot" && !seen.current.has(m.id));
          snapshot.messages.forEach(m => seen.current.add(m.id));
          const text = messages.map(m => speechFromBlocks(m.blocks)).filter(Boolean).join("\n\n");
          if (text) await speak(text, own);
          if (own === generation.current) { setCaption(""); setLevel(0); await listen(); }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch { if (alive.current && own === generation.current) { enabled.current = false; silence(); setError(true); setPhase("ready"); } }
  }
  async function start() {
    if (!alive.current) return;
    const own = ++generation.current;
    setError(false); setPhase("starting"); endCall();
    try {
      const snapshot = await rpc.threads.get(target, { signal: abort.current.signal });
      if (!alive.current || own !== generation.current) return;
      snapshot.messages.forEach(m => seen.current.add(m.id));
      enabled.current = true; await listen();
    } catch { if (alive.current && own === generation.current) { setError(true); setPhase("ready"); } }
  }
  async function prepare() {
    if (!native) return;
    setPhase("preparing"); setError(false);
    const poll = setInterval(() => void refresh().catch(() => {}), 1000);
    try { await native.prepare(); await refresh(); if (alive.current) await start(); }
    catch { if (alive.current) { setError(true); setPhase("ready"); } }
    finally { clearInterval(poll); }
  }
  const needsModels = Boolean(native && !model?.ready);
  const canStart = native ? model?.ready : (transcribe || webSpeechAvailable());
  return <aside role="dialog" data-continuous-voice aria-label={t`Voice conversation`} className="fixed inset-y-0 end-0 z-40 flex w-full flex-col border-s border-border bg-background px-6 pb-8 pt-16 md:w-[400px]">
    <header className="flex items-center justify-between"><span className="text-sm font-medium">{bot.name}</span><Button variant="ghost" size="icon" aria-label={t`Close voice`} onClick={onClose}><X /></Button></header>
    <p aria-live="polite" className="mt-2 text-center text-sm text-muted-foreground">{phase === "listening" ? t`Listening` : phase === "speaking" ? t`Speaking` : phase === "thinking" ? t`Thinking` : phase === "preparing" ? t`Preparing local voice…` : t`Voice`}</p>
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div style={{ transform: `scale(${1 + level * .12})` }}><BotAvatar identity={bot.id} color={bot.color} size={112} /></div>
      <div className="flex h-6 items-center gap-1" aria-hidden="true">{Array.from({length: 24}, (_, i) => <span key={i} className="w-0.5 rounded-full bg-muted-foreground" style={{ height: 2 + level * 24 * (1 - Math.abs(i-11.5)/24) }} />)}</div>
      <p className="max-h-40 overflow-y-auto text-center text-sm text-muted-foreground" dir="auto">{caption || (phase === "listening" ? t`Speak now` : "")}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{t`Voice stopped. Your messages are kept. Retry when ready.`}</p> : null}
      {needsModels ? <Button disabled={phase === "preparing"} onClick={() => void prepare()}>{phase === "preparing" ? `${Math.round((model?.downloaded ?? 0)/1024/1024)} / ${Math.round((model?.total ?? 0)/1024/1024)} MB` : t`Prepare local voice`}</Button> : phase === "ready" ? <Button disabled={!canStart} onClick={() => void start()}>{t`Start talking`}</Button> : null}
      {needsModels ? <p className="text-xs text-muted-foreground">Parakeet · Supertonic 3</p> : null}
      {!canStart && !needsModels ? <p className="text-center text-sm text-muted-foreground">{t`Connect a transcription provider in Voice settings, or use local voice in Desktop.`}</p> : null}
      {!native ? <Button variant="ghost" onClick={onSettings}>{t`Voice settings`}</Button> : null}
    </div>
    <footer className="flex justify-center gap-3">
      <Button className="rounded-full" variant="secondary" aria-label={t`Playback speed`} onClick={() => { rate.current = rate.current === 1 ? 1.25 : rate.current === 1.25 ? 1.5 : 1; setSpeed(rate.current); }}>{speed}×</Button>
      <Button className="rounded-full" variant="secondary" size="icon" aria-label={t`Mute microphone`} aria-pressed={muted} onClick={() => { mute.current = !mute.current; setMuted(mute.current); silence(); if (!mute.current) void listen(); }}>{muted ? <MicOff/> : <Mic/>}</Button>
      <Button className="rounded-full" variant="secondary" size="icon" aria-label={t`Interrupt reply`} onClick={() => { silence(); void listen(); }}><Square/></Button>
      <Button className="rounded-full" variant="destructive" size="icon" aria-label={t`End voice conversation`} onClick={onClose}><X/></Button>
    </footer>
  </aside>;
}
