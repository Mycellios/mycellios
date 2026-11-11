import type { ProductEvent, ThreadSnapshot } from "@rakazo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type PendingThreadSend,
  pendingSendMatchesEvent,
  visiblePendingSends,
} from "../../lib/pending-thread-sends";

export function usePendingThreadSends(scope: string, snapshot: ThreadSnapshot | null) {
  const [sends, setSends] = useState<PendingThreadSend[]>([]);
  const begin = useCallback((send: PendingThreadSend) => {
    setSends((current) => [...current.filter((item) => item.nonce !== send.nonce), send].slice(-8));
  }, []);
  const remove = useCallback((nonce: string) => {
    setSends((current) =>
      current.some((send) => send.nonce === nonce)
        ? current.filter((send) => send.nonce !== nonce)
        : current,
    );
  }, []);
  const accept = useCallback((nonce: string, messageId?: string) => {
    setSends((current) =>
      current.some((send) => send.nonce === nonce)
        ? messageId
          ? current.map((send) => (send.nonce === nonce ? { ...send, messageId } : send))
          : current.filter((send) => send.nonce !== nonce)
        : current,
    );
  }, []);
  const observe = useCallback((event: ProductEvent) => {
    if (event.type === "thread.cleared") {
      setSends((current) =>
        current.some((send) => send.threadId === event.threadId)
          ? current.filter((send) => send.threadId !== event.threadId)
          : current,
      );
      return;
    }
    if (event.type !== "thread.message.created" || !event.payload.clientNonce) return;
    setSends((current) =>
      current.some((send) => pendingSendMatchesEvent(send, event))
        ? current.filter((send) => !pendingSendMatchesEvent(send, event))
        : current,
    );
  }, []);
  const visible = useMemo(
    () => visiblePendingSends(sends, scope, snapshot),
    [sends, scope, snapshot],
  );
  useEffect(() => {
    // Accepted rows retire when their exact receipt appears; another thread's
    // pending send can survive navigation without appearing in this transcript.
    if (
      !sends.some(
        (send) =>
          send.scope !== scope ||
          (snapshot?.threadId === send.threadId &&
            send.messageId !== undefined &&
            snapshot.messages.some(
              (message) => message.role === "user" && message.id === send.messageId,
            )),
      )
    )
      return;
    setSends((current) => {
      const next = current.filter(
        (send) =>
          send.scope === scope &&
          !(
            snapshot?.threadId === send.threadId &&
            send.messageId !== undefined &&
            snapshot.messages.some(
              (message) => message.role === "user" && message.id === send.messageId,
            )
          ),
      );
      return next.length === current.length ? current : next;
    });
  }, [scope, snapshot, sends]);
  return { visible, begin, accept, observe, remove };
}
