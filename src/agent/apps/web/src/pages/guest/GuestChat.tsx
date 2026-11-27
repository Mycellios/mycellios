import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { productBrand } from "@mycellios/contracts";
import { ChatMarkdown, LinkFaviconsContext, RemoteImagesContext, type LinkFavicons } from "@mycellios/chat-ui/web";
import { Button, Textarea } from "@mycellios/ui-web";
import { ArrowUp, Paperclip } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { appPath } from "../../lib/app-path";
import {
  GuestChatRequestError, guestApi, guestCache, guestHistory, withoutImages,
  type GuestLimits, type GuestMessage, type GuestPending, type GuestStatus,
} from "../../lib/guest-chat";

/** Guests never ask the authenticated favicon service about the sites a reply links to. */
const noFavicons: LinkFavicons = { load: async () => ({ icon: null }) };

type Phase = "idle" | "preparing" | "sending";

/**
 * Registration-free chat for a visitor in an ordinary browser tab: text only, no tools, files or
 * saved history. It never mounts Shell, RPC clients, realtime or push, and offers an account
 * whenever the visitor needs something guests cannot do.
 */
export function GuestChat({ limits }: { limits: GuestLimits }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const initial = useMemo(() => guestCache.load(), []);
  const [messages, setMessages] = useState<GuestMessage[]>(initial.messages);
  const [pending, setPending] = useState<GuestPending | null>(initial.pending);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<GuestStatus | null>(null);
  // A reload while an answer was on its way offers the same message again; the server replays it, never twice.
  const [notice, setNotice] = useState<{ code: string; account?: boolean } | null>(
    initial.pending ? { code: "guest_answer_unconfirmed" } : null);
  const abort = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    guestApi.status().then(value => { if (current) setStatus(value); }).catch(() => undefined);
    return () => { current = false; abort.current?.abort(); };
  }, []);
  useEffect(() => { guestCache.save(messages, pending); }, [messages, pending]);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages, streaming, notice]);

  const remaining = status?.remaining ?? limits.messagesPerSession;
  const exhausted = status !== null && status.remaining <= 0;
  const busy = phase !== "idle";

  async function run(input: GuestPending) {
    const controller = new AbortController();
    abort.current = controller;
    setNotice(null);
    try {
      if (!status) {
        setPhase("preparing");
        setStatus(await guestApi.enter(controller.signal));
      }
      setPhase("sending");
      setStreaming("");
      const result = await guestApi.chat(input, text => setStreaming(text), controller.signal);
      setStatus(previous => previous ? { ...previous, remaining: result.remaining } : previous);
      if (result.status === "completed" && result.content !== undefined) {
        setMessages(previous => [...previous, { role: "assistant", content: result.content! }]);
        setPending(null);
      } else {
        setNotice({ code: "guest_answer_unconfirmed" });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof GuestChatRequestError ? error.code : "guest_temporarily_unavailable";
      if (code === "guest_session_expired" || code === "guest_session_required") setStatus(null);
      if (code === "guest_session_limit_reached") setStatus(previous => previous ? { ...previous, remaining: 0 } : previous);
      // Refusals before any work keep the message ready to send again; nothing was counted.
      if (code !== "guest_session_limit_reached") setPending(input);
      setNotice({ code, account: ["guest_session_limit_reached", "guest_prefix_daily_limit", "guest_sessions_limit"].includes(code) });
    } finally {
      setStreaming(null);
      setPhase("idle");
      if (abort.current === controller) abort.current = null;
    }
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || exhausted || text.length > limits.messageChars) return;
    const next = [...messages, { role: "user" as const, content: text }];
    const input = { key: crypto.randomUUID(), messages: guestHistory(next, limits) };
    setMessages(next);
    setDraft("");
    setPending(input);
    void run(input);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) send();
  }

  const noticeText = (code: string) => ({
    guest_answer_unconfirmed: t`The answer could not be confirmed yet. Try again in a moment; it will not be sent twice.`,
    guest_session_limit_reached: t`You have used the free guest messages. Create a free account to keep chatting.`,
    guest_prefix_daily_limit: t`Guest chat has reached today's limit for your network. Create a free account to keep chatting.`,
    guest_sessions_limit: t`Too many guest chats started from your network. Create a free account or try again later.`,
    guest_daily_budget_reached: t`Guest chat is very busy today. Create a free account or try again tomorrow.`,
    guest_busy: t`The free model is busy right now. Try again in a minute.`,
    guest_request_in_progress: t`Mico is still answering your previous message.`,
    guest_request_invalid: t`This message cannot be sent in guest mode. Try a shorter text message.`,
    guest_needs_account: t`Files, tools, saved chats and your own Micos need a free account.`,
  } as Record<string, string>)[code] ?? t`Guest chat is unavailable right now. Try again later or sign in.`;

  return (
    <RemoteImagesContext.Provider value={false}>
      <LinkFaviconsContext.Provider value={noFavicons}>
        <main className="flex h-dvh flex-col bg-background text-foreground" data-guest-chat>
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <img src={appPath(productBrand.mascotPath)} alt="" className="size-7 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{productBrand.name}</p>
                <p className="truncate text-xs text-muted-foreground"><Trans>Guest mode</Trans></p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="lg" onClick={() => navigate("/sign-in")}><Trans>Sign in</Trans></Button>
              <Button size="lg" onClick={() => navigate("/sign-up")}><Trans>Create account</Trans></Button>
            </div>
          </header>

          <div ref={transcript} className="flex-1 overflow-y-auto" aria-live="polite">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
              <p className="rounded-lg border border-border bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground" data-guest-notice>
                <Trans>Guest mode. Answers come from a free model served by third-party providers and the Mycellios network. Do not share sensitive information. This chat is kept only in this tab.</Trans>
              </p>
              {messages.length === 0 && streaming === null ? (
                <div className="py-10 text-center">
                  <img src={appPath(productBrand.mascotPath)} alt="" className="mx-auto mb-4 size-16" />
                  <h1 className="font-display text-2xl tracking-tight"><Trans>Hi, I'm Mico. What can I help you with?</Trans></h1>
                  <p className="mt-2 text-sm text-muted-foreground"><Trans>Ask anything, no sign-up needed.</Trans></p>
                </div>
              ) : null}
              {messages.map((message, index) => message.role === "user" ? (
                <div key={index} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-sm" data-role="user">
                  {message.content}
                </div>
              ) : (
                <div key={index} className="max-w-full text-sm" data-role="assistant">
                  <ChatMarkdown>{withoutImages(message.content)}</ChatMarkdown>
                </div>
              ))}
              {streaming !== null ? (
                <div className="max-w-full text-sm" data-role="assistant" aria-busy="true">
                  {streaming ? <ChatMarkdown streaming>{withoutImages(streaming)}</ChatMarkdown>
                    : <p className="text-muted-foreground">{phase === "preparing" ? t`Starting a guest session…` : t`Mico is thinking…`}</p>}
                </div>
              ) : phase === "preparing" ? (
                <p className="text-sm text-muted-foreground">{t`Starting a guest session…`}</p>
              ) : null}
              {exhausted && !notice && !busy ? (
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status" data-guest-alert="guest_session_limit_reached">
                  <p>{noticeText("guest_session_limit_reached")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="lg" onClick={() => navigate("/sign-up")}><Trans>Create a free account</Trans></Button>
                    <Button size="lg" variant="ghost" onClick={() => navigate("/sign-in")}><Trans>Sign in</Trans></Button>
                  </div>
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status" data-guest-alert={notice.code}>
                  <p>{noticeText(notice.code)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {notice.account || notice.code === "guest_needs_account" || notice.code === "guest_daily_budget_reached" ? (
                      <Button size="lg" onClick={() => navigate("/sign-up")}><Trans>Create a free account</Trans></Button>
                    ) : null}
                    {pending && !exhausted && notice.code !== "guest_needs_account" && !notice.account ? (
                      <Button size="lg" variant="outline" onClick={() => void run(pending)}><Trans>Try again</Trans></Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <form onSubmit={send} className="border-t border-border px-4 pb-4 pt-3">
            <div className="mx-auto w-full max-w-3xl">
              <div className="flex items-end gap-2">
                <Button type="button" variant="ghost" size="icon-lg" aria-label={t`Attach a file`}
                  onClick={() => setNotice({ code: "guest_needs_account", account: true })}>
                  <Paperclip />
                </Button>
                <Textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown}
                  maxLength={limits.messageChars} rows={1} disabled={exhausted}
                  placeholder={exhausted ? t`Create a free account to keep chatting` : t`Message Mico`}
                  aria-label={t`Message Mico`} className="max-h-48 min-h-11 resize-none" />
                <Button type="submit" size="icon-lg" aria-label={t`Send`} disabled={!draft.trim() || busy || exhausted}>
                  <ArrowUp />
                </Button>
              </div>
              {status && remaining > 0 && remaining <= 3 ? (
                <p className="mt-2 text-xs text-muted-foreground" data-guest-remaining>
                  {remaining === 1 ? t`1 free guest message left` : t`${remaining} free guest messages left`}
                </p>
              ) : null}
            </div>
          </form>
        </main>
      </LinkFaviconsContext.Provider>
    </RemoteImagesContext.Provider>
  );
}
