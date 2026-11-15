import { useLingui } from "@lingui/react/macro";
import { Button, Textarea } from "@rakazo/ui-web";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { appPath } from "../lib/app-path";
import { authClient } from "../lib/auth";
import { desktopBridge } from "../lib/desktop";
import { chooseQuickAskBot, type QuickAskBot } from "../lib/quick-ask";
import { rpc } from "../lib/rpc";

const QUICK_ASK_LIMIT = 8000;

export function QuickAskPage(): ReactElement {
  const { t } = useLingui();
  const userId = authClient.useSession().data?.user?.id ?? "";
  const [params] = useSearchParams();
  const requested = params.get("bot");
  const [bots, setBots] = useState<QuickAskBot[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const delivered = useRef(false);
  const nonce = useRef("");
  if (!nonce.current) nonce.current = crypto.randomUUID();
  const bot = bots ? chooseQuickAskBot(bots, requested) : null;
  const name = bot?.name ?? "";
  const label = bot ? t`Ask ${name}` : t`Ask a Mico`;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setBots(null);
    setLoadFailed(false);
    void rpc.bots.list().then(
      (list) => {
        if (cancelled) return;
        setBots(
          list.map((item) => ({
            id: item.id,
            name: item.name,
            archivedAt: item.archivedAt,
            pinned: item.pinned,
          })),
        );
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") void desktopBridge()?.quickAsk?.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openConversation(path: string): Promise<void> {
    const quickAsk = desktopBridge()?.quickAsk;
    if (quickAsk) await quickAsk.sent(path);
    else window.location.assign(appPath(path));
  }

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const question = text.trim();
    if (!bot || !question || sending || delivered.current) return;
    setSending(true);
    setError("");
    try {
      await rpc.threads.send({ botId: bot.id, text: question, clientNonce: nonce.current });
      delivered.current = true;
      await openConversation(`/app/${bot.id}`);
    } catch {
      setError(delivered.current ? t`Could not open the chat.` : t`Could not send. Try again.`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <main
      data-rakazo-surface="quick-ask"
      className="app-drag flex h-full flex-col justify-center gap-2 bg-background px-3 text-foreground"
    >
      {!userId ? (
        <div className="app-no-drag flex items-center justify-between gap-3">
          <p>{t`Sign in to Mycellios to ask a Mico.`}</p>
          <Button
            type="button"
            onClick={() => void openConversation("/app")}
          >{t`Open Mycellios`}</Button>
        </div>
      ) : loadFailed ? (
        <div className="app-no-drag flex items-center justify-between gap-3">
          <p>{t`Could not load Micos. Try again.`}</p>
          <Button type="button" onClick={() => setAttempt((value) => value + 1)}>{t`Retry`}</Button>
        </div>
      ) : bots && !bot ? (
        <p className="app-no-drag">{t`No Mico is available yet.`}</p>
      ) : (
        <form className="app-no-drag flex items-end gap-2" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="quick-ask">
            {label}
          </label>
          <Textarea
            id="quick-ask"
            autoFocus
            value={text}
            maxLength={QUICK_ASK_LIMIT}
            placeholder={label}
            aria-label={label}
            disabled={!bot || sending}
            className="min-h-16 flex-1"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="submit" disabled={!bot || sending || !text.trim()}>
            {sending ? t`Sending…` : t`Ask`}
          </Button>
        </form>
      )}
      {error ? (
        <p className="app-no-drag text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
