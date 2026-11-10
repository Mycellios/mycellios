import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { BotAvatar, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@rakazo/ui-web";
import { ArrowUp, AudioLines, Folder, Globe, Maximize2, MessageCircleQuestion, Minimize2, Plus, Settings, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { ResizableSidePanel } from "../ResizableSidePanel";

type Exchange = { id: number; question: string; askedAt: string; answer: string | null; answeredAt: string | null };
export type SideQuestionTarget = {
  botId: string; name: string; color: string; taskThreadId?: string; rpc: RpcClient;
  visible: boolean; append: { id: string; text: string };
};
/** One mounted owner per scoped chat. Hiding preserves it; closing unmounts and forgets it. */
export function SideQuestion({ rpc, botId, taskThreadId, name, color, active: visible, append, onClose, onBrowser, onFiles, onSettings, onVoice, enterToSend = true }: {
  rpc: RpcClient; botId: string; taskThreadId?: string; name: string; color: string; active: boolean;
  append: { id: string; text: string }; onClose: () => void;
  enterToSend?: boolean; onBrowser?: () => void; onFiles?: () => void; onSettings?: () => void; onVoice?: () => void;
}) {
  const { t, i18n } = useLingui();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState(false), [check, setCheck] = useState(0);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false), [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), alive = useRef(true), nextId = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), appended = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
  useEffect(() => {
    if (appended.current === append.id) return;
    appended.current = append.id;
    if (append.text.trim()) setQuestion(draft => draft.trim() ? `${draft.trim()}\n${append.text.trim()}` : append.text.trim());
    if (visible) field.current?.focus({ preventScroll: true });
  }, [append.id, append.text, visible]);
  useLayoutEffect(() => {
    const input = field.current;
    if (input) { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 128)}px`; }
  }, [question, visible]);
  useEffect(() => {
    if (!visible) return;
    let first = 0, second = 0, third = 0;
    first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { third = requestAnimationFrame(() => {
      const input = field.current;
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    }); }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); cancelAnimationFrame(third); };
  }, [visible, append.id]);
  useEffect(() => { if (visible && turns.length) end.current?.scrollIntoView({ block: "end" }); }, [turns, busy, visible]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setCheckError(false);
    rpc.threads.sideQuestionAvailable({ botId, taskThreadId }, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setAvailable(result.available); })
      .catch(() => { if (!controller.signal.aborted) { setAvailable(null); setCheckError(true); } });
    return () => controller.abort();
  }, [rpc, botId, taskThreadId, visible, check]);
  async function send() {
    const text = question.trim();
    if (active.current || !text || !available) return;
    const controller = new AbortController(), id = ++nextId.current;
    active.current = controller; setBusy(true); setError(null); setQuestion("");
    const earlier = turns.filter(turn => turn.answer !== null).slice(-8).map(turn => ({ question: turn.question.slice(0, 8000), answer: turn.answer!.slice(0, 16000) }));
    setTurns(previous => [...previous, { id, question: text, askedAt: new Date().toISOString(), answer: null, answeredAt: null }]);
    try {
      const result = await rpc.threads.sideQuestion({ botId, taskThreadId, question: text, earlier, responseLocale: i18n.locale }, { signal: controller.signal });
      if (alive.current && !controller.signal.aborted) setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, answer: result.answer, answeredAt: new Date().toISOString() } : turn));
    } catch (err) {
      if (alive.current && !controller.signal.aborted) {
        setTurns(previous => previous.filter(turn => turn.id !== id));
        setQuestion(draft => draft.trim() ? `${text}\n${draft.trim()}` : text);
        setError(errorText(err, t`The answer could not be confirmed. Your question is kept; it has not been resent.`));
      }
    } finally {
      if (alive.current && active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  if (!visible) return null;
  return <ResizableSidePanel open panel="side-question" expanded={expanded}>
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t`Ask aside`} data-testid="side-question-panel">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <div className="group flex min-w-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-medium">
          <MessageCircleQuestion size={14} aria-hidden/><h2 className="truncate">{t`Ask aside`}</h2>
          <Button type="button" size="icon-sm" variant="ghost" className="size-5 shrink-0 rounded-sm text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t`Close side question`} title={t`Close side question`} onClick={onClose}><X size={12} aria-hidden/></Button>
        </div>
        <div className="ms-auto flex items-center gap-1">
          <DropdownMenu><DropdownMenuTrigger aria-label={t`Open another panel`} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Plus size={16} aria-hidden/></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onBrowser ? <DropdownMenuItem onClick={onBrowser}><Globe size={16}/>{t`Browser`}</DropdownMenuItem> : null}
              {onFiles ? <DropdownMenuItem onClick={onFiles}><Folder size={16}/>{t`Files`}</DropdownMenuItem> : null}
              {onSettings ? <DropdownMenuItem onClick={onSettings}><Settings size={16}/>{t`Settings`}</DropdownMenuItem> : null}
              {onVoice ? <DropdownMenuItem onClick={onVoice}><AudioLines size={16}/>{t`Voice`}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground"
            aria-label={expanded ? t`Restore panel size` : t`Expand panel`} title={expanded ? t`Restore panel size` : t`Expand panel`}
            onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</Button>
        </div>
      </header>
      {!turns.length ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
        <MessageCircleQuestion className="mb-1 size-5 text-muted-foreground" strokeWidth={1.6} aria-hidden/>
        <strong className="text-sm font-medium">{t`Ask about this chat`}</strong>
        <p className="max-w-80 text-xs leading-4 text-muted-foreground">{t`${name} reads this chat to answer. Nothing here goes back to the chat.`}</p>
      </div> : <div role="log" aria-label={t`Side questions`} aria-live="polite" aria-busy={busy} className="rk-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {turns.map(turn => <div key={turn.id} className="space-y-4">
          <div className="ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words" dir="auto">{turn.question}</div>
          {turn.answer !== null ? <div className="space-y-2"><div className="flex items-center gap-2 text-xs text-muted-foreground"><BotAvatar identity={botId} color={color} size={20}/><span>{name}</span><time className="ms-auto" dateTime={turn.answeredAt!}>{new Intl.DateTimeFormat(i18n.locale || "en", {hour:"2-digit",minute:"2-digit"}).format(new Date(turn.answeredAt!))}</time></div><div className="text-sm leading-6" dir="auto"><ChatMarkdown>{turn.answer}</ChatMarkdown></div></div> : <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><BotAvatar identity={botId} color={color} size={24}/>{t`Thinking…`}</div>}
        </div>)}<div ref={end}/>
      </div>}
      <div className="shrink-0 px-2 pb-2 pt-1">
        {available === false || checkError ? <div role="status" className="mb-2 px-2 text-xs text-muted-foreground">{checkError ? t`Could not check side questions. Try again.` : t`This server does not support side questions yet.`}<Button type="button" variant="link" size="sm" onClick={() => setCheck(value => value + 1)}>{t`Retry`}</Button></div> : null}
        {error ? <p role="alert" className="mb-2 px-2 text-xs text-destructive">{error}</p> : null}
        <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex items-end gap-2 rounded-[18px] border border-border bg-muted p-2 focus-within:border-input">
          <textarea ref={field} aria-label={t`Side question`} placeholder={t`Ask a side question`} maxLength={8000} rows={1}
            className="rk-scroll max-h-32 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
            value={question} onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && (enterToSend || event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}/>
          <Button type="submit" size="icon" aria-label={t`Send side question`} title={t`Send side question`} disabled={!available || busy || !question.trim()}
            className="size-7 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85 hover:text-background disabled:bg-foreground/20 disabled:text-muted-foreground"><ArrowUp size={16} aria-hidden/></Button>
        </form>
      </div>
    </section>
  </ResizableSidePanel>;
}
