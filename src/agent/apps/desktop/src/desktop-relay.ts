import { randomUUID } from "node:crypto";
import type { UpdateResumeBinding } from "./update-resume.js";
import type {
  DesktopExecutorOperation,
  DesktopExecutorPoll,
} from "../../../../contracts/desktop-executor.js";
import {parseDesktopBinding} from "../../../../contracts/desktop-executor.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  hostComputerRequest,
} from "../../../packages/adapters/src/host-computer-protocol.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A delivery the broker has already accepted must be forgotten, never aborted or replayed. */
export function missingOperationAction(
  id: string,
  active: readonly string[],
  settled: ReadonlySet<string>,
): "keep" | "forget" | "abort" {
  if (active.includes(id)) return "keep";
  if (settled.has(id)) return "forget";
  return "abort";
}
/** Native-only outbound transport. The renderer never receives the host bearer. */
export class DesktopRelayClient {
  private deviceId: string = randomUUID();
  private grants = new Map<string, { generation: string }>();
  private active = new Map<string, AbortController>();
  private settled = new Set<string>();
  private pollController?: AbortController;
  private stopped = true;
  private timer?: ReturnType<typeof setTimeout>;
  private lastContact = 0;
  private lastBindingCheck = 0;
  private owner?: string;
  private accountGeneration?: string;
  private accountIdentity?: {userId:string;spaceId:string;connectionId:string};
  private intent=0;
  private updating = false;
  private updateNotices = new Map<string, () => Promise<void>>();
  constructor(
    private readonly options: {
      base: string;
      fetch: Fetch;
      localUrl: string;
      localToken: string;
      revoked(): void;
      now?: () => number;
      deviceId?:string;
      agentExecution?: 1;
      restoreUpdate?: (identity: {userId:string;spaceId:string;connectionId:string}, botId?: string) => Promise<UpdateResumeBinding | undefined>;
    },
  ) { if(options.deviceId)this.deviceId=options.deviceId; }
  private async post(action: string, input: unknown, signal?: AbortSignal) {
    const response = await this.options.fetch(`${this.options.base}/api/desktop-relay/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-mycellios-desktop": "1" },
      body: JSON.stringify(input),
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      this.stop();
      this.options.revoked();
    }
    if (!response.ok)
      throw new Error("Desktop connection is unavailable. Sign in again or reconnect the project.");
    return response;
  }
  async identity() {
    const read = async () => (await (await this.post("identity", {})).json()) as {
      userId: string; spaceId: string; connectionId: string;
    };
    let identity: Awaited<ReturnType<typeof read>>;
    try {
      identity = await read();
    } catch (error) {
      // This is an identity read, never a command or a permission fallback.
      // A single slow round trip must not abort an otherwise owned local startup.
      if (!error || typeof error !== "object" || !("name" in error) || error.name !== "TimeoutError") throw error;
      identity = await read();
    }
    if (
      typeof identity.userId !== "string" ||
      typeof identity.spaceId !== "string" ||
      typeof identity.connectionId !== "string"
    )
      throw new Error("Invalid Desktop identity");
    if (this.owner && this.owner !== JSON.stringify(identity)) {
      this.stop();
      this.options.revoked();
    }
    this.owner = JSON.stringify(identity);
    return identity;
  }
  async bind(botId: string, renew = false) {
    const intent=this.intent;
    const identity = await this.identity();
    const existing = this.grants.get(botId);
    const planned = !renew && !existing ? await this.options.restoreUpdate?.(identity, botId) : undefined;
    if(intent!==this.intent)throw Error("The local session changed");
    const restored = planned && (!this.options.deviceId || planned.deviceId === this.options.deviceId) &&
      (!this.grants.size || planned.deviceId === this.deviceId) ? planned : undefined;
    if (restored) this.deviceId = restored.deviceId;
    // Reassert the same grant after an API restart; never replay an operation.
    const generation =
      existing && !renew ? existing.generation : restored?.generation ?? this.accountGeneration ?? randomUUID();
    await this.post("bind", {
      deviceId: this.deviceId,
      botId,
      generation,
    });
    if(intent!==this.intent)throw Error("The local session changed");
    this.grants.set(botId, { generation });
    if (!this.lastBindingCheck) this.lastBindingCheck = (this.options.now ?? Date.now)();
    if (this.stopped) {
      this.stopped = false;
      this.lastContact = (this.options.now ?? Date.now)();
      void this.poll();
    }
  }
  async spaces(): Promise<string[]> {
    const data=await(await this.post("spaces",{})).json() as {spaces?:unknown};
    if(!Array.isArray(data.spaces)||data.spaces.length>128||data.spaces.some(x=>typeof x!=="string"||!x||x.length>256))throw Error("Invalid account spaces");
    return data.spaces;
  }
  async registerAccount(expected: {userId:string;spaceId:string;connectionId:string}) {
    const intent=this.intent;
    const identity=await this.identity();
    if(intent!==this.intent)throw Error("The local session changed");
    if(identity.userId!==expected.userId||identity.spaceId!==expected.spaceId||identity.connectionId!==expected.connectionId)throw Error("The account session changed");
    const restored = !this.accountGeneration ? await this.options.restoreUpdate?.(identity) : undefined;
    if (restored && (!this.options.deviceId || restored.deviceId === this.options.deviceId)) {
      this.deviceId = restored.deviceId;
      this.accountGeneration = restored.generation;
    }
    if (intent !== this.intent) throw Error("The local session changed");
    this.accountIdentity=identity;
    this.accountGeneration ??= randomUUID();
    // The first poll registers and checks the account before it can receive work.
    if(this.stopped){this.stopped=false;this.lastContact=0;await this.poll();}
  }
  async revoke() {
    this.stop();
    try {
      await this.post("revoke", { deviceId: this.deviceId });
    } catch {
      /* API lease expires without another poll */
    }
  }
  connected(botId: string) {
    return !this.stopped && this.grants.has(botId) &&
      (this.options.now ?? Date.now)() - this.lastContact < 40_000;
  }
  online() { return !this.stopped && this.lastContact>0 && (this.options.now??Date.now)()-this.lastContact<40_000; }
  resumeBindings(): UpdateResumeBinding[] {
    const identity = this.accountIdentity ?? (this.owner ? JSON.parse(this.owner) : undefined);
    if (!identity) return [];
    const binding = { base: this.options.base, ...identity, deviceId: this.deviceId };
    return this.accountGeneration ? [{ ...binding, generation: this.accountGeneration }] :
      [...this.grants].map(([botId, grant]) => ({ ...binding, generation: grant.generation, botId }));
  }
  async beginUpdate() {
    this.updating = true;
    await Promise.all([...this.updateNotices.values()].map(notice => notice()));
  }
  cancelUpdate() { this.updating = false; }
  busy() {
    return this.active.size > 0;
  }
  stop() {
    this.pollController?.abort();
    ++this.intent;
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.grants.clear();
    this.accountGeneration=undefined;
    this.accountIdentity=undefined;
  }
  private async poll() {
    if (this.stopped) return;
    const pollController = new AbortController(); this.pollController = pollController;
    const previousActive = new Set(this.active.keys());
    try {
      const state = (await (
        await this.post(this.accountGeneration ? "account" : "poll", { deviceId: this.deviceId,...(this.accountGeneration ? {generation:this.accountGeneration,identity:this.accountIdentity,...(this.options.agentExecution ? {agentExecution:this.options.agentExecution} : {})} : {}),...(this.options.agentExecution && this.lastContact ? {wait:true,active:[...previousActive]} : {}) }, AbortSignal.any([pollController.signal, AbortSignal.timeout(25_000)]))
      ).json()) as DesktopExecutorPoll & { identity?: unknown };
      if(this.stopped)return;
      if (!this.owner || JSON.stringify(state.identity) !== this.owner) {
        this.stop();
        this.options.revoked();
        return;
      }
      if (
        !Array.isArray(state.active) ||
        !Array.isArray(state.operations) ||
          state.operations.length > (this.options.agentExecution ? 20 : 8)
      )
        throw new Error("Invalid Desktop poll");
      // Bindings are volatile on the API. Reassert only the same owner-approved
      // generation after a restart; commands/results are never resubmitted here.
      const now = (this.options.now ?? Date.now)();
      if (!this.accountGeneration && now - this.lastBindingCheck >= 15_000) {
        for (const [botId, grant] of this.grants) {
          await this.post("bind", { deviceId: this.deviceId, botId, generation: grant.generation });
          if (this.stopped) return;
        }
        this.lastBindingCheck = now;
      }
      if(this.accountGeneration){
        if(!Array.isArray(state.bindings)||state.bindings.length>128)throw Error("Invalid account bindings");
        const grants=new Map<string,{generation:string}>();
        for(const raw of state.bindings){const b=parseDesktopBinding(raw);if(b.deviceId!==this.deviceId)throw Error("Another device binding");grants.set(b.botId,{generation:b.generation});}
        this.grants=grants;
      }
      this.lastContact = (this.options.now ?? Date.now)();
      for (const [id, controller] of this.active) {
        const action = missingOperationAction(id, state.active, this.settled);
        if (action === "keep") continue;
        this.active.delete(id);
        if (action === "forget") { this.settled.delete(id); continue; }
        controller.abort();
      }
      for (const id of state.active)
        if (!previousActive.has(id) && !this.active.has(id) && !state.operations.some((op) => op.id === id)) {
          // A lost poll is an uncertain delivery, never a reason to replay an effectful command.
          try {
            await this.post("result", {
              deviceId: this.deviceId,
              id,
              seq: 0,
              data: Buffer.from(
                JSON.stringify({
                  error: "Desktop delivery was interrupted. Check results before retrying.",
                }) + "\n",
              ).toString("base64"),
              done: true,
            });
          } catch {
            // The orphan may have expired on the API. Other operations in this
            // authenticated batch still have their own valid delivery.
            if (this.stopped) return;
          }
        }
      for (const operation of state.operations) {
        if (this.active.has(operation.id)) continue;
        const input = hostComputerRequest.safeParse(operation.request);
        if (
          !input.success ||
          operation.binding.deviceId !== this.deviceId ||
          operation.binding.generation !== this.grants.get(input.data.botId)?.generation ||
          input.data.botId !== operation.binding.botId
        )
          continue;
        const controller = new AbortController();
        this.active.set(operation.id, controller);
        void this.execute(operation, controller).finally(() => { this.active.delete(operation.id); this.settled.delete(operation.id); });
      }
    } catch {
      if ((this.options.now ?? Date.now)() - this.lastContact > 40_000) {
        // Stop uncertain commands, but retain the approved binding while the
        // network is unavailable. A fresh authenticated poll must precede work.
        // Explicit 401/403 or an identity change still revokes everything.
        for (const controller of this.active.values()) controller.abort();
        this.active.clear();
      }
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), this.options.agentExecution ? 0 : 2_000);
      this.timer.unref();
    }
  }
  private async execute(operation: DesktopExecutorOperation, controller: AbortController) {
    let seq = 0, closed = false;
    let delivery = Promise.resolve();
    const send = (data: Uint8Array, done: boolean): Promise<void> => {
      const next = delivery.then(async () => {
        if (closed) return;
        const body = {deviceId:this.deviceId,id:operation.id,seq,data:Buffer.from(data).toString("base64"),done};
        const attempts = done ? 4 : 1;
        for (let attempt = 0; ; attempt++) {
          if (done) this.settled.add(operation.id);
          try { await this.post("result", body, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])); break; }
          catch (error) {
            if (done) this.settled.delete(operation.id);
            if (attempt >= attempts || controller.signal.aborted || this.stopped) throw error;
          }
        }
        seq++;
        closed = done;
        if (done) this.settled.add(operation.id);
      });
      delivery = next;
      return next;
    };
    // An interruption must not split an NDJSON frame already being forwarded.
    let frames = Promise.resolve();
    const forward = (data: Uint8Array, done: boolean) => {
      frames = frames.then(async () => {
        for (let offset = 0; offset < data.byteLength; offset += 128 * 1024)
          await send(data.subarray(offset, offset + 128 * 1024), done && offset + 128 * 1024 >= data.byteLength);
        if (!data.byteLength) await send(data, done);
      });
      return frames;
    };
    const interrupt = async (dispatched = true) => {
      await forward(Buffer.from(JSON.stringify({error:"The PC is updating; pending work will resume after reconnecting.",code:"desktop_updating",dispatched}) + "\n"), true);
      controller.abort();
    };
    this.updateNotices.set(operation.id, interrupt);
    try {
      if (this.updating) { await interrupt(false); return; }
      const body = JSON.stringify(operation.request);
      if (Buffer.byteLength(body) > HOST_COMPUTER_MAX_BYTES) throw new Error("Request too large");
      const response = await fetch(`${this.options.localUrl}/computer`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.localToken}`,
        },
        body,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.headers.get("x-mycellios-desktop-error") === "desktop_updating") { await interrupt(false); return; }
      if (!response.ok || !response.body) throw new Error("Local computer unavailable");
      const reader = response.body.getReader();
      let pending: Buffer = Buffer.alloc(0);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            if (pending.byteLength) throw Error("Incomplete native frame");
            await forward(new Uint8Array(), true);
            break;
          }
          pending = Buffer.concat([pending, value]);
          if (pending.byteLength > HOST_COMPUTER_MAX_BYTES) throw Error("Native frame exceeds its limit");
          const end = pending.lastIndexOf(10);
          if (end >= 0) {
            await forward(pending.subarray(0, end + 1), false);
            pending = pending.subarray(end + 1);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      controller.abort();
      if (!this.stopped && !closed) {
        try {
          await this.post("result", {
            deviceId: this.deviceId,
            id: operation.id,
            seq,
            data: Buffer.from(
              JSON.stringify({
                error: "Desktop operation interrupted. Check results before retrying.",
              }) + "\n",
            ).toString("base64"),
            done: true,
          });
        } catch {
          /* lease/dispatch deadline reports disconnected work */
        }
      }
    } finally { this.updateNotices.delete(operation.id); }
  }
}
