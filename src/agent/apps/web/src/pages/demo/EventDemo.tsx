import { MICO_PRIMARY_AVATAR } from "@rakazo/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { BotAvatar, Button, Textarea } from "@rakazo/ui-web";
import { ChatMarkdown, LinkFaviconsContext, RemoteImagesContext } from "@rakazo/chat-ui/web";
import { ArrowUp, Check, LoaderCircle, Pause, Play, RefreshCw, Wifi } from "lucide-react";
import { demoApi, demoCache, type DemoPending, type DemoResult, type EventDemoMetadata, type EventDemoSession } from "../../lib/event-demo";
import { useDemoContribution } from "./use-demo-contribution";
import { DemoPresenter } from "./Presenter";
import "./event-demo.css";

export function EventDemoPage({ id, presenter }: { id: string; presenter: boolean }) {
  return presenter ? <DemoPresenter id={id} /> : <DemoChat id={id} />;
}
const credits = (value: number) => (value / 1_000_000).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

function DemoChat({ id }: { id: string }) {
  const { t } = useLingui();
  const api = useMemo(() => demoApi(id), [id]), cache = useMemo(() => demoCache(id), [id]);
  const initial = useMemo(() => cache.load(), [cache]);
  const [meta, setMeta] = useState<EventDemoMetadata | null>(null), [session, setSession] = useState<EventDemoSession | null>(null);
  const [messages, setMessages] = useState(initial.messages), [pending, setPending] = useState(initial.pending);
  const [draft, setDraft] = useState(""), [live, setLive] = useState(""), [sending, setSending] = useState(false);
  const [issue, setIssue] = useState<string | null>(null), [starting, setStarting] = useState(true);
  const [checking, setChecking] = useState(false), [quote, setQuote] = useState<{ maximumMicrounits: number } | null>(null);
  const [probe, setProbe] = useState<"running" | "completed" | "failed" | "pending" | null>(null);
  const probeKey = useRef<string | null>(null), sendingRef = useRef(false), controller = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => { void api.session().then(setSession).catch(() => undefined); }, [api]);
  const contribution = useDemoContribution(id, session?.open === true, refresh);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const metadata = await api.metadata();
        let current: EventDemoSession;
        try { current = await api.session(); }
        catch (error) { if ((error as Error).message !== "demo_session_required") throw error; current = await api.enter(); }
        if (!stopped) { setMeta(metadata); setSession(current); setIssue(initial.pending ? "demo_request_unconfirmed" : null); }
      } catch (error) { if (!stopped) setIssue((error as Error).message); }
      finally { if (!stopped) setStarting(false); }
    })();
    const poll = window.setInterval(refresh, 10_000);
    return () => { stopped = true; clearInterval(poll); controller.current?.abort(); };
  }, [api, refresh, initial.pending]);
  useEffect(() => { cache.save(messages, pending); }, [cache, messages, pending]);
  useEffect(() => {
    if (!session?.open) return;
    const timer = window.setTimeout(() => setSession(value => value ? { ...value, open: false } : value),
      Math.max(0, Math.min(2_147_483_647, session.endsAt - Date.now())));
    return () => clearTimeout(timer);
  }, [session?.open, session?.endsAt]);
  useEffect(() => {
    const element = scroll.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 220)
      element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
  }, [messages, live]);
  useEffect(() => {
    if (!contribution.linked) { setQuote(null); return; }
    let stopped = false;
    void api.networkQuote().then(value => { if (!stopped) setQuote(value); }).catch(() => undefined);
    return () => { stopped = true; };
  }, [api, contribution.linked]);
  const complete = useCallback((result: DemoResult) => {
    if (result.status === "not_submitted") { setIssue("demo_not_submitted"); return; }
    if (result.status !== "completed") { setIssue("demo_request_unconfirmed"); return; }
    const text = result.response?.choices?.[0]?.message?.content;
    if (typeof text !== "string") { setIssue("demo_request_unconfirmed"); return; }
    setMessages(previous => [...previous, { role: "assistant", content: text }]);
    setPending(null); setLive(""); setIssue(null); refresh();
  }, [refresh]);
  async function recover() {
    if (!pending || checking) return;
    setChecking(true);
    try { complete(await api.recover(pending.key)); }
    catch { setIssue("demo_request_unconfirmed"); }
    finally { setChecking(false); refresh(); }
  }
  async function send() {
    if (!draft.trim() || pending || !session?.open || sendingRef.current) return;
    const history = [...messages, { role: "user" as const, content: draft.trim() }];
    const input: DemoPending = { key: crypto.randomUUID(), messages: history.slice(-12) };
    setPending(input); setMessages(history); setDraft(""); cache.save(history, input);
    await transmit(input);
  }
  async function transmit(input: DemoPending) {
    if (sendingRef.current || !session?.open) return;
    sendingRef.current = true; setSending(true); setIssue(null); controller.current = new AbortController();
    try { complete(await api.chat(input, setLive, controller.current.signal)); }
    catch (error) { setIssue((error as Error).message); }
    finally { sendingRef.current = false; setSending(false); refresh(); }
  }
  async function testNetwork() {
    if (!quote || probe === "running") return;
    probeKey.current ??= crypto.randomUUID();
    setProbe("running");
    try {
      const result = probe === "pending"
        ? await api.networkStatus(probeKey.current)
        : await api.networkTest(probeKey.current, quote.maximumMicrounits);
      setProbe(result?.status === "completed" ? "completed" : !result || result.status === "failed" ? "failed" : "pending");
      if (!result || result.status === "failed") probeKey.current = null;
    } catch { setProbe("pending"); }
    finally { refresh(); }
  }
  const problem = issue === "demo_full" ? t`All 50 demo places have been taken.`
    : issue === "demo_closed" ? t`This demo has ended. Thank you for joining us.`
    : issue === "insufficient_contribution_credits" ? t`You have used your demo credits.`
    : pending ? t`We are checking this response. Your message has been saved; it will not be charged twice.`
    : t`We could not connect. Check your connection and try again.`;
  if (!session) return <main className="event-demo event-demo-entry">
    <BotAvatar color={MICO_PRIMARY_AVATAR} size={76} status={starting ? "connecting" : "idle"} />
    <h1>{starting ? t`Preparing your Mico…` : t`Mycellios demo`}</h1>
    <p role={issue ? "alert" : "status"}>{issue ? problem : t`No registration. Your own chat and 0.20 demo credits.`}</p>
    {!starting && !["demo_full", "demo_closed"].includes(issue ?? "") && <Button onClick={() => window.location.reload()}>{t`Try again`}</Button>}
  </main>;
  return <main className="event-demo event-demo-chat">
    <header className="event-demo-header">
      <div className="event-demo-brand"><BotAvatar color={MICO_PRIMARY_AVATAR} size={34} /><span>Mycellios</span></div>
      <span className="event-demo-balance" title={t`Your remaining demo balance`}><strong>{credits(session.creditsMicrounits)}</strong> {t`credits`}</span>
    </header>
    <section className="event-demo-contribution" aria-label={t`Browser contribution`} data-active={contribution.linked}>
      <div><span>{t`Generate AI`}</span><p>{contribution.preparing ? t`Connecting your browser…` : contribution.linked
        ? t`Your browser is available to the network.` : contribution.failed ? t`Could not connect. Try Play again.` : t`Share your browser's computing power.`}</p></div>
      <Button variant="ghost" className="event-demo-play" aria-label={contribution.preparing || contribution.snapshot?.running ? t`Pause contribution` : t`Start contribution`}
        disabled={!session.open} onClick={() => { void contribution.toggle(); }}>
        {contribution.preparing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : contribution.snapshot?.running ? <Pause fill="currentColor" strokeWidth={0} /> : <Play />}
      </Button>
    </section>
    <div className="event-demo-history" ref={scroll} aria-label={t`Conversation`}>
      {!messages.length && <div className="event-demo-welcome"><BotAvatar color={MICO_PRIMARY_AVATAR} size={76} />
        <h1>{t`What shall we work on?`}</h1><p>{t`Ask a question, explore an idea or try something new.`}</p>
        <div className="event-demo-suggestions">{[t`Explain Mycellios in one sentence`, t`Give me an idea for my business`, t`Help me prepare a presentation`].map(text =>
          <Button variant="outline" key={text} onClick={() => setDraft(text)}>{text}</Button>)}</div>
      </div>}
      <LinkFaviconsContext.Provider value={null}><RemoteImagesContext.Provider value={false}>
        {messages.map((message, index) => <article className="event-demo-message" data-role={message.role} key={index}>
          <ChatMarkdown>{message.content}</ChatMarkdown></article>)}
        {live && <article className="event-demo-message" data-role="assistant"><ChatMarkdown streaming>{live}</ChatMarkdown></article>}
      </RemoteImagesContext.Provider></LinkFaviconsContext.Provider>
      {sending && <p className="event-demo-working" role="status"><BotAvatar color={MICO_PRIMARY_AVATAR} size={22} status="running" />{t`Mico is thinking…`}</p>}
      {!session.open && <p className="event-demo-notice" role="status">{t`This demo has ended. Your conversation remains visible here.`}</p>}
      {issue && <div className="event-demo-notice" role="alert"><p>{problem}</p>{pending && <Button variant="ghost" size="sm" disabled={checking || sending} onClick={() => { void recover(); }}>
        <RefreshCw size={14} />{t`Check response`}</Button>}{issue === "demo_not_submitted" && pending && <Button variant="ghost" size="sm" disabled={sending} onClick={() => { void transmit(pending); }}>{t`Send this saved message`}</Button>}</div>}
    </div>
    {contribution.linked && <details className="event-demo-network-test"><summary><Wifi size={14} />{t`Your browser in the network`}</summary>
      <p>{t`Connected does not mean busy. Only completed and verified inference earns credits.`}</p>
      <p>{t`The browser uses a small local model. DeepSeek chat uses Mycellios external processing.`}</p>
      {quote && <Button size="sm" variant="outline" disabled={probe === "running" || probe === "completed" || !session.open} onClick={() => { void testNetwork(); }}>
        {probe === "running" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : probe === "completed" ? <Check size={14} /> : <Play size={14} />}
        {probe === "completed" ? t`Real inference completed` : probe === "running" ? t`Running inference…` : probe === "pending" ? t`Check response` : <>{t`Test the network`} · ≤ {credits(quote.maximumMicrounits)} {t`credits`}</>}</Button>}
      {probe === "pending" && <p role="status">{t`We are checking this response. Your message has been saved; it will not be charged twice.`}</p>}
      {probe === "failed" && <p role="status">{t`No available browser completed the work. No credits are awarded for failed work.`}</p>}
      <p>{t`Earned`}: {credits(session.earnedMicrounits)} {t`credits`}</p>
    </details>}
    <form className="event-demo-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <Textarea value={draft} maxLength={2000} disabled={!session.open || Boolean(pending)} placeholder={t`Message Mico`}
        aria-label={t`Message Mico`} onChange={event => setDraft(event.target.value)} rows={1}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <Button type="submit" className="event-demo-send" size="icon" aria-label={t`Send message`} disabled={!draft.trim() || !session.open || Boolean(pending) || sending || session.creditsMicrounits <= 0}><ArrowUp /></Button>
    </form>
    <footer className="event-demo-footer">Mycellios · {meta?.modelName ?? "DeepSeek V4 Flash"} · {t`Real consumption +4%. Temporary demo balance.`}</footer>
  </main>;
}
