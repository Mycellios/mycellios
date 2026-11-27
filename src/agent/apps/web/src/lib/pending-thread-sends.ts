import type { ProductEvent, ThreadSnapshot } from "@mycellios/contracts";

export type PendingThreadSend = {
  scope: string;
  threadId: string;
  nonce: string;
  text: string;
  attachments: readonly string[];
  messageId?: string;
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
    snapshot.messages.filter((message) => message.role === "user").map((message) => message.id),
  );
  return sends.filter(
    (send) =>
      send.scope === scope &&
      send.threadId === snapshot.threadId &&
      (send.messageId === undefined || !committed.has(send.messageId)),
  );
}

/** How long a send carried into a new conversation's view waits for that view to mount. */
const CARRY_MS = 30_000;
const carried: { send: PendingThreadSend; at: number }[] = [];

/**
 * A new conversation's first message outlives the draft view that sent it: the view of the
 * created conversation mounts afresh, starts from these and keeps showing the message until
 * its history holds it.
 */
export function carryPendingSend(send: PendingThreadSend, now = Date.now()): void {
  const kept = carried.filter(item => now - item.at < CARRY_MS && item.send.nonce !== send.nonce);
  carried.splice(0, carried.length, ...kept, { send, at: now });
}

export function carriedPendingSends(scope: string, now = Date.now()): PendingThreadSend[] {
  return carried.filter(item => now - item.at < CARRY_MS && item.send.scope === scope).map(item => item.send);
}
