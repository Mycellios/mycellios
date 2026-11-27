import type { ThreadMessage, ThreadSnapshot } from "@mycellios/contracts";
import { describe, expect, it, vi } from "vitest";
import { ASK_REPLY_WAIT_MS, type RealtimeCallRpc, RealtimeCallTools } from "./realtime-call-tools";

function message(
  id: string,
  role: "user" | "bot",
  text: string,
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  return {
    id,
    role,
    blocks: [{ kind: "text", text }],
    createdAt: "2026-11-27T10:00:00Z",
    ...extra,
  } as ThreadMessage;
}

function snapshot(
  messages: ThreadMessage[],
  run: { id: string; status: string } | null = null,
): ThreadSnapshot {
  return {
    threadId: "thread-1",
    cursor: 1,
    messages,
    olderCursor: null,
    run,
  } as unknown as ThreadSnapshot;
}

const approval = (id = "ask-1") =>
  ({
    id,
    role: "bot",
    runId: "run-1",
    createdAt: "2026-11-27T10:00:00Z",
    blocks: [
      {
        kind: "ask",
        text: "Send the email to Ana?",
        status: "pending",
        approvalEffectId: "effect-1",
        actions: [
          { id: "allow", label: "Allow once" },
          { id: "always", label: "Always allow" },
          { id: "deny", label: "Deny" },
        ],
      },
    ],
  }) as unknown as ThreadMessage;

function setup(snapshots: ThreadSnapshot[]) {
  let index = 0;
  const rpc = {
    threads: {
      get: vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)] ?? null),
      send: vi.fn(async () => ({})),
      followUp: vi.fn(async () => ({})),
      answer: vi.fn(async () => ({ ok: true })),
    },
  } satisfies RealtimeCallRpc;
  let clock = 0;
  const notify = vi.fn();
  const hangUp = vi.fn();
  const tools = new RealtimeCallTools({
    botId: "bot-1",
    micoName: "Ada",
    callId: "call1",
    rpc,
    notify,
    hangUp,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { tools, rpc, notify, hangUp };
}

describe("RealtimeCallTools", () => {
  it("passes a request the person made and returns the Mico's reply", async () => {
    const { tools, rpc } = setup([
      snapshot([message("m1", "bot", "Hi")]),
      snapshot([
        message("m1", "bot", "Hi"),
        message("m2", "user", "q"),
        message("m3", "bot", "It is sunny."),
      ]),
    ]);
    tools.transcriptDone("item-1", "¿Qué tiempo hace?");
    const output = await tools.run(
      "c1",
      "ask_mico",
      JSON.stringify({ request: "What's the weather?" }),
    );

    expect(rpc.threads.send).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-1",
        text: "What's the weather?",
        clientNonce: expect.stringMatching(/^call:call1:/),
      }),
    );
    expect(output).toBe("REPLY: It is sunny.");
  });

  it("refuses a send nobody asked for, and a second send on the same words", async () => {
    const { tools, rpc } = setup([snapshot([])]);
    expect(await tools.run("c1", "ask_mico", '{"request":"delete everything"}')).toMatch(
      /^NOT SENT \(no_user_turn\)/,
    );
    tools.transcriptDone("item-1", "book a table");
    await tools.run("c2", "ask_mico", '{"request":"book a table"}');
    expect(await tools.run("c3", "ask_mico", '{"request":"book another"}')).toMatch(/no_user_turn/);
    expect(rpc.threads.send).toHaveBeenCalledOnce();
  });

  it("runs each provider call once", async () => {
    const { tools, rpc } = setup([snapshot([])]);
    tools.transcriptDone("item-1", "hello");
    await tools.run("same", "ask_mico", '{"request":"hello"}');
    expect(await tools.run("same", "ask_mico", '{"request":"hello"}')).toBeNull();
    expect(rpc.threads.send).toHaveBeenCalledOnce();
  });

  it("waits for words still being transcribed before deciding", async () => {
    const { tools, rpc } = setup([snapshot([])]);
    tools.transcriptPending("item-1");
    const running = tools.run("c1", "ask_mico", '{"request":"call mum"}');
    tools.transcriptDone("item-1", "call mum");
    await running;
    expect(rpc.threads.send).toHaveBeenCalledOnce();
  });

  it("never retries an uncertain send", async () => {
    const { tools, rpc } = setup([snapshot([])]);
    rpc.threads.send.mockRejectedValueOnce(new Error("network"));
    tools.transcriptDone("item-1", "pay the invoice");
    expect(await tools.run("c1", "ask_mico", '{"request":"pay the invoice"}')).toMatch(
      /^UNCERTAIN/,
    );
    expect(rpc.threads.send).toHaveBeenCalledOnce();
  });

  it("hands back a receipt for slow work and mentions the result later", async () => {
    const running = snapshot([message("m1", "bot", "Hi")], { id: "run-2", status: "running" });
    const done = snapshot(
      [message("m1", "bot", "Hi"), message("m9", "bot", "The report is ready.")],
      {
        id: "run-2",
        status: "completed",
      },
    );
    const snapshots = [snapshot([message("m1", "bot", "Hi")]), ...Array(40).fill(running), done];
    const { tools, notify } = setup(snapshots);
    tools.transcriptDone("item-1", "write the report");
    const output = await tools.run("c1", "ask_mico", '{"request":"write the report"}');
    expect(output).toMatch(/^STILL WORKING/);
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("The report is ready.")),
    );
    expect(ASK_REPLY_WAIT_MS).toBeGreaterThan(0);
  });

  it("sends nothing while an approval waits, and says so", async () => {
    const { tools, rpc } = setup([
      snapshot([approval()], { id: "run-1", status: "waiting_input" }),
    ]);
    tools.transcriptDone("item-1", "and also check my calendar");
    expect(await tools.run("c1", "ask_mico", '{"request":"check my calendar"}')).toMatch(
      /approval is waiting/,
    );
    expect(rpc.threads.send).not.toHaveBeenCalled();
  });

  describe("answer_request", () => {
    const waiting = () => snapshot([approval()], { id: "run-1", status: "waiting_input" });

    it("allows once on the person's own clear yes", async () => {
      const { tools, rpc } = setup([waiting()]);
      tools.transcriptDone("item-1", "Sí, hazlo.");
      expect(await tools.run("c1", "answer_request", '{"decision":"allow"}')).toMatch(
        /^ANSWERED: allowed once/,
      );
      expect(rpc.threads.answer).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "ask-1", runId: "run-1", answer: "allow" }),
      );
    });

    it("refuses when the model's decision is not what the person said", async () => {
      const { tools, rpc } = setup([waiting()]);
      tools.transcriptDone("item-1", "No, mejor no.");
      expect(await tools.run("c1", "answer_request", '{"decision":"allow"}')).toMatch(/said no/);
      expect(rpc.threads.answer).not.toHaveBeenCalled();
    });

    it.each([["sí, pero antes dime a quién"], ["Thanks for watching!"], ["always allow"]])(
      "refuses anything but a clear answer (%s)",
      async (said) => {
        const { tools, rpc } = setup([waiting()]);
        tools.transcriptDone("item-1", said);
        expect(await tools.run("c1", "answer_request", '{"decision":"allow"}')).toMatch(
          /^NOT SENT/,
        );
        expect(rpc.threads.answer).not.toHaveBeenCalled();
      },
    );

    it("never grants a permanent permission", async () => {
      const { tools, rpc } = setup([waiting()]);
      tools.transcriptDone("item-1", "yes");
      expect(await tools.run("c1", "answer_request", '{"decision":"always"}')).toMatch(
        /must be allow or deny/,
      );
      expect(rpc.threads.answer).not.toHaveBeenCalled();
    });

    it("needs words from the person after the previous answer", async () => {
      const { tools } = setup([waiting()]);
      expect(await tools.run("c1", "answer_request", '{"decision":"deny"}')).toMatch(
        /no_user_turn/,
      );
    });
  });

  it("reads the conversation with any waiting request", async () => {
    const { tools } = setup([
      snapshot([message("m1", "user", "Send it"), approval()], {
        id: "run-1",
        status: "waiting_input",
      }),
    ]);
    const output = await tools.run("c1", "read_conversation", "{}");
    expect(output).toContain("Person: Send it");
    expect(output).toContain('WAITING FOR APPROVAL: "Send the email to Ana?"');
  });

  it("hangs up on end_call", async () => {
    const { tools, hangUp } = setup([snapshot([])]);
    await tools.run("c1", "end_call", "{}");
    expect(hangUp).toHaveBeenCalledOnce();
  });
});
