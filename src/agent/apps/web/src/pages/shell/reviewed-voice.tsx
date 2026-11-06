import { useLingui } from "@lingui/react/macro";
import { Button, Textarea } from "@rakazo/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { dictation } from "../../lib/dictation";
import { newClientId } from "../../lib/client-id";
import { isAndroidHost } from "../../lib/android-host";

type Stage = "closed" | "listening" | "stopping" | "review" | "sending";

/** The shortcut records into a review, never directly into the agent's send path. */
export function useReviewedVoice({ scope, transcribe, blocked, onSend }: {
  scope: string; transcribe?: boolean; blocked: boolean;
  onSend: (text: string, nonce: string) => Promise<boolean | void>;
}) {
  const { t } = useLingui();
  const [stage, setStage] = useState<Stage>("closed");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useRef({ stage: "closed" as Stage, text: "", prefix: "", epoch: 0, nonce: "", attempted: "", owned: false });
  const latest = useRef({ blocked, onSend });
  latest.current = { blocked, onSend };
  const move = useCallback((next: Stage) => { session.current.stage = next; setStage(next); }, []);
  const edit = useCallback((value: string) => { session.current.text = value; setText(value); }, []);
  const cancel = useCallback(() => {
    const s = session.current;
    s.epoch++;
    if (s.owned) { s.owned = false; dictation.stop("cancel"); }
    move("closed"); edit(""); setError(null); setLevel(0);
  }, [move, edit]);
  useEffect(() => { cancel(); return cancel; }, [scope, cancel]);
  useEffect(() => dictation.subscribe(snapshot => {
    const s = session.current;
    if (!s.owned) return;
    setLevel(snapshot.level ?? 0);
    if (snapshot.transcript) edit([s.prefix, snapshot.transcript].filter(Boolean).join(" "));
    if (snapshot.error) setError(snapshot.error);
    if (snapshot.status === "idle") {
      s.owned = false;
      move("review");
    }
  }), [edit, move]);
  const start = useCallback(() => {
    const s = session.current;
    if (latest.current.blocked || !["closed", "review"].includes(s.stage)) return;
    if (s.stage === "closed") { s.nonce = newClientId(); s.attempted = ""; edit(""); }
    s.prefix = s.text;
    const epoch = ++s.epoch;
    s.owned = true; setError(null); move("listening");
    void dictation.listen({ mode: "hold", transcribe, preferServer: transcribe, onFinal: words => {
      if (session.current.epoch !== epoch) return;
      s.owned = false;
      edit([s.prefix, words].filter(Boolean).join(" "));
      move("review");
    }}).catch(() => {
      if (session.current.epoch !== epoch) return;
      s.owned = false; move("review"); setError(t`Could not start the microphone. Try again.`);
    });
  }, [edit, move, transcribe, t]);
  const stop = useCallback(() => {
    if (session.current.stage !== "listening") return;
    move("stopping"); dictation.submitHold();
  }, [move]);
  useEffect(() => {
    if (stage !== "listening") return;
    let disposed = false;
    let lock: WakeLockSentinel | undefined;
    void navigator.wakeLock?.request("screen").then(value => {
      if (disposed) void value.release(); else lock = value;
    }).catch(() => {});
    // Android owns foreground teardown and keeps a pending permission request alive.
    // Its system permission dialog may hide the WebView without leaving the app.
    const hidden = () => { if (!isAndroidHost() && document.visibilityState !== "visible") stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { disposed = true; void lock?.release(); document.removeEventListener("visibilitychange", hidden); };
  }, [stage, stop]);
  useEffect(() => { if (blocked) stop(); }, [blocked, stop]);
  const send = useCallback(async () => {
    const s = session.current;
    if (s.stage !== "review" || latest.current.blocked || !s.text.trim()) return;
    if (s.attempted && s.attempted !== s.text.trim()) s.nonce = newClientId();
    s.attempted = s.text.trim();
    const epoch = s.epoch;
    move("sending"); setError(null);
    try {
      const accepted = await latest.current.onSend(s.text.trim(), s.nonce);
      if (session.current.epoch !== epoch) return;
      if (accepted === false) { move("review"); setError(t`Message not sent. Your text is kept here.`); }
      else { move("closed"); edit(""); }
    } catch {
      if (session.current.epoch !== epoch) return;
      move("review"); setError(t`Message not sent. Your text is kept here.`);
    }
  }, [move, edit, t]);
  return { stage, text, level, error, start, stop, cancel, edit, send, blocked };
}

export function ReviewedVoice({ voice, name }: { voice: ReturnType<typeof useReviewedVoice>; name?: string }) {
  const { t } = useLingui();
  if (voice.stage === "closed") return null;
  const listening = voice.stage === "listening";
  const busy = voice.stage === "stopping" || voice.stage === "sending";
  return <section aria-label={t`Voice message`} className="mb-3 space-y-3 rounded-2xl border border-border bg-card p-4 text-foreground">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium">{name || t`Voice message`}</h2>
      <span role="status" className="text-sm text-muted-foreground">{listening ? t`Listening…` : voice.stage === "stopping" ? t`Transcribing…` : voice.stage === "sending" ? t`Sending…` : t`Review your message`}</span>
    </div>
    {listening ? <meter aria-label={t`Microphone level`} min={0} max={1} value={Math.max(0, Math.min(1, voice.level))} className="h-2 w-full accent-primary" /> : null}
    <Textarea aria-label={t`Voice transcript`} value={voice.text} onChange={event => voice.edit(event.target.value)} readOnly={voice.stage !== "review"} placeholder={t`Your words will appear here.`} className="min-h-28 max-h-64 text-base" />
    {voice.error ? <p role="alert" className="text-sm text-destructive">{voice.error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={voice.stage === "sending"} onClick={voice.cancel} className="min-h-11">{t`Cancel`}</Button>
      {listening ? <Button onClick={voice.stop} className="min-h-11">{t`Review message`}</Button> : <>
        <Button variant="outline" disabled={busy || voice.blocked} onClick={voice.start} className="min-h-11">{t`Continue`}</Button>
        <Button disabled={busy || voice.blocked || !voice.text.trim()} onClick={() => void voice.send()} className="min-h-11">{t`Send`}</Button>
      </>}
    </div>
  </section>;
}
