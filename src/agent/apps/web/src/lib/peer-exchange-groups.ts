import type { ThreadMessage } from "@mycellios/contracts";
import type { ThreadItem } from "@mycellios/core";
import { isPeerReceiptBlocks } from "@mycellios/core";

/** Consecutive messages between Micos that the transcript folds into one row. */
export interface PeerExchange {
  /** The first member's id: stable while the run keeps its first message. */
  key: string;
  memberIds: string[];
  /** The other Micos in the run, in order of first appearance. */
  peers: string[];
}

function peerName(message: ThreadMessage): string | undefined {
  for (const block of message.blocks) {
    if (block.kind === "bot_message_sent") return block.toBotName;
    if (block.kind === "bot_message_received") return block.fromBotName;
  }
  return undefined;
}

/**
 * Find each run of two or more consecutive Mico-to-Mico receipts. Any other row, a voice call or
 * an expanded reply ends the run. The result maps every member id to its run.
 */
export function peerExchanges(items: readonly ThreadItem<ThreadMessage>[]): Map<string, PeerExchange> {
  const byMember = new Map<string, PeerExchange>();
  let run: ThreadMessage[] = [];
  const close = () => {
    if (run.length >= 2) {
      const peers = [...new Set(run.map(peerName).filter((name): name is string => Boolean(name?.trim())))];
      const exchange: PeerExchange = { key: run[0]!.id, memberIds: run.map((message) => message.id), peers };
      for (const message of run) byMember.set(message.id, exchange);
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "message" && isPeerReceiptBlocks(item.message.blocks)) run.push(item.message);
    else close();
  }
  close();
  return byMember;
}
