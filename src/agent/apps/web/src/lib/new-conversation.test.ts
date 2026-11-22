import { describe, expect, it, vi } from "vitest";
import { sendFirstMessage } from "./new-conversation";

const refusal = (status: number) => Object.assign(new Error("refused"), { status });

function setup(options: { open?: () => Promise<{ threadId: string }>; head?: () => Promise<unknown>; send?: () => Promise<unknown>; remove?: () => Promise<unknown> } = {}) {
  const open = vi.fn(options.open ?? (async () => ({ threadId: "new-thread" })));
  const remove = vi.fn(options.remove ?? (async () => ({ ok: true, deleteAfter: new Date().toISOString() })));
  const head = vi.fn(options.head ?? (async () => ({ threadId: "new-thread", cursor: -1 })));
  const send = vi.fn(options.send ?? (async () => ({ taskId: "task", runId: "run", seq: 0 })));
  const bind = vi.fn(() => ({ threads: { head, send } }));
  const rpc = { development: { open, remove } };
  const run = () => sendFirstMessage({
    botId: "mico", requestKey: "mico-task:mico:request",
    rpc: rpc as never, bind: bind as never,
    message: { clientNonce: "nonce", text: "Plan the trip" },
  });
  return { open, remove, head, send, bind, run };
}

describe("a draft tab's first message", () => {
  it("creates the conversation, reads it through its own client, then sends there", async () => {
    const { open, bind, head, send, run } = setup();
    await expect(run()).resolves.toEqual({ status: "sent", threadId: "new-thread", runId: "run" });
    expect(open).toHaveBeenCalledWith({ botId: "mico", projectKey: "mico:mico", taskKey: "mico-task:mico:request" });
    expect(bind).toHaveBeenCalledWith("new-thread");
    expect(head).toHaveBeenCalledWith({ botId: "mico" });
    expect(send).toHaveBeenCalledWith({ botId: "mico", clientNonce: "nonce", text: "Plan the trip" });
    expect(head.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });

  it("keeps the request when the conversation could not be opened, so a retry reuses it", async () => {
    const { remove, bind, run } = setup({ open: async () => { throw new Error("offline"); } });
    await expect(run()).resolves.toMatchObject({ status: "failed", keepRequest: true });
    expect(bind).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the empty conversation when the server refuses the message", async () => {
    const { remove, run } = setup({ send: async () => { throw refusal(400); } });
    await expect(run()).resolves.toMatchObject({ status: "failed", keepRequest: false });
    expect(remove).toHaveBeenCalledWith({ botId: "mico", taskThreadId: "new-thread" });
  });

  it("keeps the request when the empty conversation could not be removed", async () => {
    const { run } = setup({ head: async () => { throw refusal(404); }, remove: async () => { throw new Error("offline"); } });
    await expect(run()).resolves.toMatchObject({ status: "failed", keepRequest: true });
  });

  it("never removes a conversation whose message may have arrived", async () => {
    const { remove, run } = setup({ send: async () => { throw new Error("connection lost"); } });
    await expect(run()).resolves.toMatchObject({ status: "unconfirmed", threadId: "new-thread" });
    expect(remove).not.toHaveBeenCalled();
  });
});
