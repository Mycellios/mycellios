import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useSpaceRpc, useBoundSpaceId } from "../../lib/space-rpc";

type QueuedMessage = { messageId: string; text: string; createdAt: string };
export function QueuedMessages({ target, running, sending }: { target: { botId: string; taskThreadId?: string } | { groupId: string }; running: boolean; sending: boolean }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const spaceId = useBoundSpaceId();
  const targetKey = JSON.stringify(target);
  const [saved, setSaved] = useState<{ key: string; rows: QueuedMessage[] } | null>(null);
  const key = JSON.stringify([spaceId, targetKey]);
  useEffect(() => {
    let alive = true, pending = false;
    const load = async () => {
      if (pending || sending || document.hidden) return;
      pending = true;
      try { const rows = await rpc.threads.queue(JSON.parse(targetKey)); if (alive) setSaved({ key, rows }); }
      catch { /* Queue visibility never resends a message or replaces its acceptance receipt. */ }
      finally { pending = false; }
    };
    void load();
    const timer = running ? window.setInterval(() => void load(), 3000) : undefined;
    return () => { alive = false; window.clearInterval(timer); };
  }, [rpc, key, targetKey, sending, running]);
  const rows = saved?.key === key ? saved.rows : [];
  if (!rows.length) return null;
  return <details className="mx-3 mb-2 min-w-0 text-xs" data-testid="queued-messages">
    <summary className="w-fit cursor-pointer rounded-md py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t`Queued messages`} · {rows.length}</summary>
    <ol className="max-h-32 space-y-1 overflow-y-auto py-1 text-muted-foreground">
      {rows.map(message => <li key={message.messageId} className="truncate" title={message.text}>{message.text || t`Attachment`}</li>)}
    </ol>
    <p className="pb-1 text-muted-foreground">{t`Saved messages run in order after the current task.`}</p>
  </details>;
}
