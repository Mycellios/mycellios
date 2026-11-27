import type { ThreadSnapshot } from "@mycellios/contracts";
import {
  callClientNonce,
  isApprovalAskBlock,
  isSecretAskBlock,
  speechFromBlocks,
  spokenApprovalAction,
} from "@mycellios/core";

/** The RPCs a realtime call's tools use: the same ones the person's own taps use. */
export interface RealtimeCallRpc {
  threads: {
    get(input: { botId: string }): Promise<ThreadSnapshot | null>;
    send(input: { botId: string; text: string; clientNonce: string }): Promise<unknown>;
    followUp(input: { botId: string; text: string; clientNonce: string }): Promise<unknown>;
    answer(input: {
      botId: string;
      runId: string;
      messageId: string;
      answer: string;
      clientNonce: string;
    }): Promise<unknown>;
  };
}

const RUN_ACTIVE = new Set(["running", "queued", "leased"]);
const MAX_SPOKEN_REPLY = 3_000;
/** How long ask_mico waits in the call before handing back a "still working" receipt. */
export const ASK_REPLY_WAIT_MS = 40_000;
/** A send whose authorizing words are still being transcribed waits this long for them. */
export const TRANSCRIPT_WAIT_MS = 2_500;
const POLL_MS = 1_500;
const BACKGROUND_POLL_MS = 5_000;
const BACKGROUND_LIMIT_MS = 10 * 60_000;

type Snapshot = ThreadSnapshot;

function pendingAsk(snapshot: Snapshot | null) {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    const block = message.blocks.find((item) => item.kind === "ask" && item.status !== "answered");
    if (block && block.kind === "ask") return { message, block };
  }
  return null;
}

function clip(text: string) {
  return text.length > MAX_SPOKEN_REPLY ? `${text.slice(0, MAX_SPOKEN_REPLY)}…` : text;
}

/**
 * Runs the speech model's tools for one realtime call and enforces what the model cannot
 * bypass: a sending tool needs new words from the person since the previous send, each tool
 * call runs once, an uncertain send is never retried, and an approval is answered only when
 * the person's own last words were a clear yes or no.
 */
export class RealtimeCallTools {
  private turns: string[] = [];
  private authorizedThrough = 0;
  private pendingTranscripts = new Set<string>();
  private handled = new Set<string>();
  private closed = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      botId: string;
      micoName: string;
      callId: string;
      rpc: RealtimeCallRpc;
      /** A later finding the call should mention (a slow request that finished). */
      notify: (text: string) => void;
      hangUp: () => void;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    },
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  close() {
    this.closed = true;
  }

  /** The provider committed audio whose transcript has not arrived yet. */
  transcriptPending(itemId: string) {
    this.pendingTranscripts.add(itemId);
  }

  /** A finished transcript of the person; empty or failed ones only clear the pending mark. */
  transcriptDone(itemId: string, text?: string) {
    this.pendingTranscripts.delete(itemId);
    const words = text?.trim();
    if (words) this.turns.push(words);
  }

  private async newTurn(): Promise<string | null> {
    const deadline = this.now() + TRANSCRIPT_WAIT_MS;
    while (this.pendingTranscripts.size > 0 && this.now() < deadline && !this.closed) {
      await this.sleep(100);
    }
    if (this.turns.length <= this.authorizedThrough) return null;
    return this.turns[this.turns.length - 1] ?? null;
  }

  private spend() {
    this.authorizedThrough = this.turns.length;
  }

  /** Runs one function call from the provider and returns the text to hand back. */
  async run(callId: string, name: string, rawArguments: string): Promise<string | null> {
    if (this.handled.has(callId)) return null;
    this.handled.add(callId);
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rawArguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        args = parsed as Record<string, unknown>;
    } catch {
      return "ERROR: the arguments were not valid JSON.";
    }
    switch (name) {
      case "ask_mico":
        return this.askMico(typeof args.request === "string" ? args.request : "");
      case "read_conversation":
        return this.readConversation();
      case "answer_request":
        return this.answerRequest(args.decision);
      case "end_call":
        this.options.hangUp();
        return "OK: hanging up.";
      default:
        return `ERROR: unknown tool ${name}.`;
    }
  }

  private async snapshot() {
    return this.options.rpc.threads.get({ botId: this.options.botId });
  }

  private async askMico(request: string): Promise<string> {
    const text = request.trim();
    if (!text) return "NOT SENT: the request was empty.";
    if (!(await this.newTurn())) {
      return "NOT SENT (no_user_turn): the person has not asked for anything new since the last request. Wait for them.";
    }
    let before: Snapshot | null;
    try {
      before = await this.snapshot();
    } catch {
      return "NOT SENT: the conversation could not be read. Ask the person to try again.";
    }
    const ask = pendingAsk(before);
    if (ask && isSecretAskBlock(ask.block)) {
      return "NOT SENT: the Mico is waiting for a code or credential. Ask the person to enter it on screen.";
    }
    if (ask && isApprovalAskBlock(ask.block)) {
      return `NOT SENT: an approval is waiting: "${clip(ask.block.text)}". Read it and ask for a yes or no, then use answer_request.`;
    }
    // From here the words authorize this send, whatever its outcome: never a second try.
    this.spend();
    const known = new Set(before?.messages.map((message) => message.id));
    const clientNonce = callClientNonce(this.options.callId);
    const { botId } = this.options;
    try {
      if (before?.run && RUN_ACTIVE.has(before.run.status)) {
        await this.options.rpc.threads.followUp({ botId, text, clientNonce });
      } else {
        await this.options.rpc.threads.send({ botId, text, clientNonce });
      }
    } catch {
      return "UNCERTAIN: the request may not have reached the Mico. Do not send it again; tell the person to check the chat.";
    }
    const deadline = this.now() + ASK_REPLY_WAIT_MS;
    while (this.now() < deadline && !this.closed) {
      await this.sleep(POLL_MS);
      const outcome = await this.outcome(known).catch(() => null);
      if (outcome) return outcome;
    }
    if (!this.closed) void this.watchInBackground(known);
    return `STILL WORKING: ${this.options.micoName} is still on it. Tell the person you will mention it when it finishes.`;
  }

  /** The reply to a request, once its turn settled or stopped for the person; null while running. */
  private async outcome(known: ReadonlySet<string>): Promise<string | null> {
    const snapshot = await this.snapshot();
    if (!snapshot) return null;
    const run = snapshot.run;
    const settled = !run || !RUN_ACTIVE.has(run.status);
    if (!settled) return null;
    const replies = snapshot.messages.filter(
      (message) => message.role === "bot" && !known.has(message.id),
    );
    const text = replies
      .map((message) => speechFromBlocks(message.blocks))
      .filter(Boolean)
      .join("\n");
    const ask = pendingAsk(snapshot);
    if (ask && isSecretAskBlock(ask.block)) {
      return `REPLY: ${clip(text)}\nWAITING: a code or credential must be entered on screen.`;
    }
    if (ask && isApprovalAskBlock(ask.block)) {
      return `REPLY: ${clip(text)}\nWAITING FOR APPROVAL: "${clip(ask.block.text)}". Read it and ask for a yes or no.`;
    }
    if (ask)
      return `REPLY: ${clip(text)}\nQUESTION FOR THE PERSON: "${clip(ask.block.text)}". Their next request answers it.`;
    if (run?.status === "failed") return `FAILED: ${clip(text) || "the request did not finish."}`;
    return `REPLY: ${clip(text) || "done, with nothing to say."}`;
  }

  private async watchInBackground(known: ReadonlySet<string>) {
    const deadline = this.now() + BACKGROUND_LIMIT_MS;
    while (this.now() < deadline && !this.closed) {
      await this.sleep(BACKGROUND_POLL_MS);
      if (this.closed) return;
      const outcome = await this.outcome(known).catch(() => null);
      if (outcome) {
        this.options.notify(
          `NOTICE: ${this.options.micoName} finished the earlier request. ${outcome}`,
        );
        return;
      }
    }
  }

  private async readConversation(): Promise<string> {
    let snapshot: Snapshot | null;
    try {
      snapshot = await this.snapshot();
    } catch {
      return "ERROR: the conversation could not be read.";
    }
    const lines = (snapshot?.messages ?? [])
      .filter((message) => message.role === "bot" || message.role === "user")
      .slice(-8)
      .map((message) => {
        const text = speechFromBlocks(message.blocks).replace(/\s+/g, " ").trim();
        return text
          ? `${message.role === "user" ? "Person" : this.options.micoName}: ${clip(text).slice(0, 600)}`
          : "";
      })
      .filter(Boolean);
    const ask = pendingAsk(snapshot);
    if (ask) {
      lines.push(
        isApprovalAskBlock(ask.block)
          ? `WAITING FOR APPROVAL: "${clip(ask.block.text)}"`
          : isSecretAskBlock(ask.block)
            ? "WAITING: a code or credential must be entered on screen."
            : `QUESTION FOR THE PERSON: "${clip(ask.block.text)}"`,
      );
    }
    const working = snapshot?.run && RUN_ACTIVE.has(snapshot.run.status);
    if (working) lines.push(`${this.options.micoName} is working right now.`);
    return lines.length ? lines.join("\n") : "The conversation is empty.";
  }

  private async answerRequest(decision: unknown): Promise<string> {
    if (decision !== "allow" && decision !== "deny")
      return "NOT SENT: the decision must be allow or deny.";
    const words = await this.newTurn();
    if (!words)
      return "NOT SENT (no_user_turn): the person has not answered yet. Ask them for a yes or no.";
    let snapshot: Snapshot | null;
    try {
      snapshot = await this.snapshot();
    } catch {
      return "NOT SENT: the conversation could not be read.";
    }
    const ask = pendingAsk(snapshot);
    if (!ask || !isApprovalAskBlock(ask.block)) return "NOT SENT: no approval is waiting.";
    // The person's own words decide, never the model's reading of them.
    const heard = spokenApprovalAction(words, ask.block.actions);
    if (heard !== decision) {
      return heard
        ? `NOT SENT: the person said ${heard === "allow" ? "yes" : "no"}, not ${decision === "allow" ? "yes" : "no"}.`
        : "NOT SENT: the person's last words were not a clear yes or no. Ask again; permanent permissions only on screen.";
    }
    this.spend();
    try {
      await this.options.rpc.threads.answer({
        botId: this.options.botId,
        runId: ask.message.runId ?? "",
        messageId: ask.message.id,
        answer: decision,
        clientNonce: callClientNonce(this.options.callId),
      });
    } catch {
      return "UNCERTAIN: the answer may not have been saved. Do not answer again; tell the person to check the screen.";
    }
    if (decision === "deny") return "ANSWERED: denied.";
    void this.watchInBackground(new Set(snapshot?.messages.map((message) => message.id)));
    return `ANSWERED: allowed once. ${this.options.micoName} continues; the result will arrive as a notice.`;
  }
}
