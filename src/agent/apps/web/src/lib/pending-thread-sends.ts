import type { ProductEvent, ThreadSnapshot } from "@rakazo/contracts";

export type PendingThreadSend = {
  scope: string;
  threadId: string;
  nonce: string;
  text: string;
  attachments: readonly string[];
  seq?: number;
};

/** Only exact durable identity may replace a local send, including SSE-before-HTTP. */
export function pendingSendMatchesEvent(send: PendingThreadSend, event: ProductEvent): boolean {
  return (
    event.threadId === send.threadId &&
    event.type === "thread.message.created" &&
    event.payload.role === "user" &&
    event.payload.clientNonce === send.nonce
  );
}

export function visiblePendingSends(
  sends: readonly PendingThreadSend[],
  scope: string,
  snapshot: ThreadSnapshot | null,
): PendingThreadSend[] {
  if (!snapshot) return [];
  const committed = new Set(
    snapshot.messages.filter((message) => message.role === "user").map((message) => message.seq),
  );
  return sends.filter(
    (send) =>
      send.scope === scope &&
      send.threadId === snapshot.threadId &&
      (send.seq === undefined || !committed.has(send.seq)),
  );
}
