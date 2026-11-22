import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@mycellios/chat-ui/web";
import type { ThreadMessage, ThreadSnapshot } from "@mycellios/contracts";
import { answerableAskMessageIds, isRetryableError } from "@mycellios/core";
import { Button, Spinner, Textarea } from "@mycellios/ui-web";
import { ArrowUp, MessageCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readComposerDraft, writeComposerDraft } from "../lib/composer-draft";
import type { RpcClient } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AskCard, type AskBlock } from "./AskCard";

/** How often an open conversation beside the chat checks for news. */
const POLL_MS = 2_500;

/**
 * One of the Mico's conversations beside the main chat: its messages, its pending questions and
 * a box to answer, through a client bound to that conversation alone (read first, like a tab).
 * It marks the conversation read once its messages are on screen, never on hover.
 */
export function SideConversationView({ botId, threadId, title, micoName, client, onOpenInChat, onClose, onRead }: {
  botId: string;
  threadId: string;
  title: string;
  micoName: string;
  /** Bound to this conversation; never the main chat's client. */
  client: Pick<RpcClient, "threads">;
  onOpenInChat: () => void;
  onClose: () => void;
  onRead?: () => void;
}) {
  const { t } = useLingui();
  const draftKey = `bot:${botId}:task:${threadId}`;
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState(() => readComposerDraft(draftKey));
  const [nonce, setNonce] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [revision, setRevision] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    let cursor: number | null = null;
    let read = false;
    const load = async () => {
      try {
        // The head is the admission read; a full read follows only when something moved.
        const head = await client.threads.head({ botId });
        if (!live) return;
        if (head.threadId !== threadId) throw new Error(t`The server did not return this conversation.`);
        if (cursor === null || head.cursor !== cursor) {
          const next = await client.threads.get({ botId });
          if (!live) return;
          if (next.threadId !== threadId) throw new Error(t`The server did not return this conversation.`);
          cursor = next.cursor;
          setSnapshot(next);
        }
        setLoadError("");
        // Read like the main chat: only while the person can see this window.
        if (!read && document.visibilityState === "visible" && document.hasFocus()) {
          read = true;
          await client.threads.markRead({ botId }).then(() => onReadRef.current?.(), () => { read = false; });
        }
      } catch (cause) {
        if (live) setLoadError(errorText(cause, t`Could not load this conversation.`));
      } finally {
        if (live) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    // A hidden window only waits; it reads again once it is shown.
    const tick = () => {
      if (!live) return;
      if (document.visibilityState === "visible") void load();
      else timer = window.setTimeout(tick, POLL_MS);
    };
    void load();
    return () => { live = false; window.clearTimeout(timer); };
  }, [client, botId, threadId, revision]);

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [snapshot?.messages.length]);

  const answerable = useMemo(() => answerableAskMessageIds(snapshot), [snapshot]);
  const working = Boolean(snapshot?.run && ["queued", "leased", "running"].includes(snapshot.run.status));

  async function answer(message: ThreadMessage, text: string, username?: string, dismiss?: boolean) {
    const runId = message.runId ?? snapshot?.run?.id;
    if (!runId) return;
    await client.threads.answer({ botId, runId, messageId: message.id, answer: dismiss ? "" : text,
      ...(username ? { username } : {}), ...(dismiss ? { dismiss: true as const } : {}) });
    setRevision(value => value + 1);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const request = nonce ?? crypto.randomUUID();
    setNonce(request); setSending(true); setSendError("");
    try {
      await client.threads.send({ botId, text, clientNonce: request });
      setDraft(""); writeComposerDraft(draftKey, ""); setNonce(null);
      setRevision(value => value + 1);
    } catch (cause) {
      // A refused message was not written; a lost answer keeps its receipt for the retry.
      if (!isRetryableError(cause)) setNonce(null);
      setSendError(errorText(cause, t`Could not send the message. Try again.`));
    } finally { setSending(false); }
  }

  return <div className="flex min-h-0 flex-1 flex-col" data-side-conversation={threadId}>
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
      <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto" title={title}>{title}</p>
      <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1.5 px-2 font-normal" onClick={onOpenInChat}>
        <MessageCircle size={14} aria-hidden="true" />{t`Open in the chat`}
      </Button>
      <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={t`Close`} onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </Button>
    </div>
    <div ref={scroller} className="rk-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" data-testid="side-conversation-messages">
      {!snapshot && !loadError ? <Spinner className="m-auto" aria-label={t`Loading…`} /> : null}
      {snapshot?.messages.map(message => {
        const blocks = message.blocks.filter(block => block.kind === "text" || block.kind === "ask" || block.kind === "progress"
          || block.kind === "file" || block.kind === "image");
        if (!blocks.length) return null;
        return <div key={message.id} data-message-role={message.role}
          className={message.role === "user" ? "ms-8 self-end rounded-2xl bg-chat-user px-3 py-2 text-sm text-chat-user-foreground" : "me-4 text-sm"}>
          {blocks.map((block, index) => block.kind === "text"
            ? <div key={index} dir="auto" className="wrap-anywhere"><ChatMarkdown>{block.text}</ChatMarkdown></div>
            : block.kind === "progress" ? <p key={index} className="text-xs text-muted-foreground" dir="auto">{block.text}</p>
            : block.kind === "ask" ? <AskCard key={index} block={block as AskBlock}
                canAnswer={answerable.has(message.id) && block.status !== "answered"}
                canDismiss={answerable.has(message.id) && block.status !== "answered" && block.input === "secret"}
                onAnswer={(text, username) => answer(message, text, username)}
                onDismiss={() => answer(message, "", undefined, true)} />
            : <p key={index} className="text-xs text-muted-foreground" dir="auto">{"name" in block ? block.name : null}</p>)}
        </div>;
      })}
      {working ? <p role="status" className="text-xs text-muted-foreground">{t`${micoName} is working…`}</p> : null}
      {loadError ? <p role="alert" className="text-xs text-destructive">{loadError}
        <Button size="xs" variant="ghost" onClick={() => setRevision(value => value + 1)}>{t`Retry`}</Button></p> : null}
    </div>
    <form className="shrink-0 border-t border-border p-2" onSubmit={event => { event.preventDefault(); void send(); }}>
      {sendError ? <p role="alert" className="mb-1 text-xs text-destructive">{sendError}</p> : null}
      <div className="flex items-end gap-1.5">
        <Textarea value={draft} rows={2} aria-label={t`Message ${micoName} in this conversation`}
          placeholder={t`Message ${micoName} in this conversation`}
          className="max-h-40 min-h-10 flex-1 resize-none text-sm"
          onChange={event => { setDraft(event.target.value); writeComposerDraft(draftKey, event.target.value); setNonce(null); }}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
          }} />
        <Button type="submit" size="icon-sm" aria-label={t`Send`} disabled={!draft.trim() || sending}>
          {sending ? <Spinner aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}
        </Button>
      </div>
    </form>
  </div>;
}
