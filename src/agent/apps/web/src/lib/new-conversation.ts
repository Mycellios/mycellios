import { isRetryableError } from "@mycellios/core";
import type { RpcClient } from "./rpc";

type SendInput = Parameters<RpcClient["threads"]["send"]>[0];

export type FirstMessageResult =
  /** The conversation exists and holds the message. */
  | { status: "sent"; threadId: string; runId: string }
  /** The conversation exists, but the message may have arrived: keep the text with it. */
  | { status: "unconfirmed"; threadId: string; error: unknown }
  /**
   * Nothing was written. `keepRequest` is true while a conversation made by this request may
   * still exist empty, so the next try reuses it instead of making another one.
   */
  | { status: "failed"; error: unknown; keepRequest: boolean };

/**
 * A draft tab has no thread, so its first message creates one. The conversation is opened
 * with the draft's request key (a retry reuses the same conversation), then the message
 * goes through a client bound to that new thread only, which reads it first as every
 * task client does. The main chat's client never carries it. When nothing was written,
 * the empty conversation is removed again.
 */
export async function sendFirstMessage(input: {
  botId: string;
  requestKey: string;
  rpc: Pick<RpcClient, "development">;
  bind: (threadId: string) => Pick<RpcClient, "threads">;
  message: Omit<SendInput, "botId" | "groupId" | "taskThreadId">;
}): Promise<FirstMessageResult> {
  let threadId: string;
  try {
    ({ threadId } = await input.rpc.development.open({
      botId: input.botId, projectKey: `mico:${input.botId}`, taskKey: input.requestKey,
    }));
  } catch (error) {
    return { status: "failed", error, keepRequest: true };
  }
  const discard = async (error: unknown): Promise<FirstMessageResult> => {
    const removed = await input.rpc.development.remove({ botId: input.botId, taskThreadId: threadId })
      .then(() => true, () => false);
    return { status: "failed", error, keepRequest: !removed };
  };
  const client = input.bind(threadId);
  try {
    await client.threads.head({ botId: input.botId });
  } catch (error) {
    return discard(error);
  }
  try {
    const sent = await client.threads.send({ ...input.message, botId: input.botId });
    return { status: "sent", threadId, runId: sent.runId };
  } catch (error) {
    // A refusal wrote nothing; a lost answer may have delivered the message.
    return isRetryableError(error) ? { status: "unconfirmed", threadId, error } : discard(error);
  }
}
