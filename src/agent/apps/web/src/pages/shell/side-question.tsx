import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../../lib/rpc";

export function SideQuestion({
  rpc,
  taskThreadId,
  botId,
  open,
  onOpenChange,
}: {
  rpc: RpcClient;
  taskThreadId?: string;
  botId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Array<{ question: string; answer: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAvailable(null);
    rpc.threads
      .sideQuestionAvailable({ botId, taskThreadId }, { signal: controller.signal })
      .then((result) => setAvailable(result.available))
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => controller.abort();
  }, [rpc, botId, taskThreadId, open]);
  async function send() {
    if (active.current || !question.trim() || !available) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(false);
    const text = question.trim();
    try {
      const result = await rpc.threads.sideQuestion(
        { botId, taskThreadId, question: text, earlier: turns.slice(-8), responseLocale: i18n.locale },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setTurns((previous) => [...previous.slice(-7), { question: text, answer: result.answer }]);
        setQuestion("");
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t`Ask aside`}</DialogTitle>
          <DialogDescription>{t`Ask about this chat without interrupting its task. Answers stay here and use your configured model.`}</DialogDescription>
        </DialogHeader>
        <div
          role="log"
          aria-live="polite"
          className="max-h-72 space-y-4 overflow-y-auto whitespace-pre-wrap break-words"
        >
          {turns.map((turn, index) => (
            <div key={index} className="space-y-2">
              <p className="font-medium" dir="auto">
                {turn.question}
              </p>
              <p dir="auto">{turn.answer}</p>
            </div>
          ))}
        </div>
        {available === false ? (
          <p
            role="status"
            className="text-muted-foreground"
          >{t`This server does not support side questions yet.`}</p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="text-destructive"
          >{t`The answer could not be confirmed. Your question is kept; it has not been resent.`}</p>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="space-y-3"
        >
          <Textarea
            aria-label={t`Side question`}
            placeholder={t`What would you like to know?`}
            maxLength={8000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={!available || busy || !question.trim()}>
              {busy ? t`Answering…` : t`Ask`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
