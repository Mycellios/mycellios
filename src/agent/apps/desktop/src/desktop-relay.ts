import { randomUUID } from "node:crypto";
import { setImmediate as deferTurn } from "node:timers/promises";
import { recordDesktopDiagnostic, desktopExceptionFields } from "./diagnostics.js";
import type { DesktopFailureCode } from "@mycellios/contracts";
import type { UpdateResumeBinding } from "./update-resume.js";
import type {
  DesktopExecutorOperation,
  DesktopExecutorPoll,
} from "../../../../contracts/desktop-executor.js";
import {DESKTOP_WORKSPACE_REPORT_LIMIT, parseDesktopBinding} from "../../../../contracts/desktop-executor.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  hostComputerRequest,
} from "../../../packages/adapters/src/host-computer-protocol.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Below this silence the PC still shows as connected. */
const ONLINE_MS = 40_000;
/**
 * Running work survives a server stall this long. A busy API can hold relay
 * requests for 20-40 s; the server's presence lease (90 s) outlasts this.
 */
const RELAY_STALL_MS = 85_000;
const RESULT_ATTEMPT_MS = 15_000;
/**
 * Bytes of native output per result POST. Base64 keeps it under the server's
 * 350,000-character frame and 360,000-byte body bounds.
 */
export const RESULT_FRAME_BYTES = 240 * 1024;
const POLL_RETRY_BASE_MS = 250;
const POLL_RETRY_MAX_MS = 5_000;

/**
 * Delay before the next poll. A failed poll (usually the API restarting) waits 250 ms,
 * doubling up to 5 s, instead of retrying at once; every Desktop doing that at the same
 * moment floods the server while it starts. The cap stays far inside RELAY_STALL_MS.
 */
export function pollRetryDelayMs(failures: number, held: boolean): number {
  // A held poll already waits on the server; a plain one asks every 2 s.
  const idle = held ? 0 : 2_000;
  if (failures <= 0) return idle;
  return Math.max(idle, Math.min(POLL_RETRY_MAX_MS, POLL_RETRY_BASE_MS * 2 ** (failures - 1)));
}

const RELAY_CONFLICT_MESSAGE = "The PC connection changed. Try again.";

/** The server's short reason for a 409, or a neutral sentence; never asks to sign in again. */
export async function relayConflictMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const text = typeof body.error === "string" ? body.error.trim() : "";
    return text && text.length <= 200 && !/[\r\n]/.test(text) ? text : RELAY_CONFLICT_MESSAGE;
  } catch {
    return RELAY_CONFLICT_MESSAGE;
  }
}

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
  private pollFailures = 0;
  private lastBindingCheck = 0;
  /** The last poll listed every grant of this PC, so the server can hold the next one open. */
  private serverHolds = false;
  private owner?: string;
  private accountGeneration?: string;
  private accountIdentity?: {userId:string;spaceId:string;connectionId:string};
  private intent=0;
  private updating = false;
  /** The server said it accepts this PC's Mico folder keys; older servers refuse unknown fields. */
  private reportWorkspaces = false;
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
      /** Keeps the OS from suspending the app while an operation runs; returns its release. */
      awake?: () => () => void;
      restoreUpdate?: (identity: {userId:string;spaceId:string;connectionId:string}, botId?: string) => Promise<UpdateResumeBinding | undefined>;
      /** Keys of the Mico folders on this PC, reported with account presence. */
      workspaces?: () => string[];
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
    if (!response.ok) recordDesktopDiagnostic("relay_http_failure",{httpStatus:response.status,stage:action === "result" ? "result_ack" : "poll",
      code:response.status === 401 || response.status === 403 ? "access_revoked" : response.status === 429 ? "desktop_busy" : "relay_stream_failure"});
    if (response.status === 401 || response.status === 403) {
      this.stop();
      this.options.revoked();
    }
    if (!response.ok)
      throw Object.assign(new Error(response.status >= 500
        // A server restart or overload, not an account problem: signing in again would not help.
        ? "The server is temporarily unavailable."
        : response.status === 409
          // The PC connection changed (another PC runs this Mico, or this PC reconnected).
          // The server's own short sentence says which; signing in again would not help.
          ? await relayConflictMessage(response)
          : "Desktop connection is unavailable. Sign in again or reconnect the project."), { status: response.status });
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
  /**
   * Stops and tells the server this PC is going offline now, so new messages
   * are not handed to a poll that will never come. Consent stays; a failed or
   * refused notice is ignored and the server's presence lease still expires.
   */
  release(): Promise<void> | undefined {
    const online = !this.stopped && this.lastContact > 0;
    const deviceId = this.deviceId;
    this.stop();
    return online ? this.notifyReleased(deviceId) : undefined;
  }

  private async notifyReleased(deviceId: string) {
    try {
      const response = await this.options.fetch(`${this.options.base}/api/desktop-relay/release`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-mycellios-desktop": "1" },
        body: JSON.stringify({ deviceId }),
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
    } catch {
      /* the presence lease expires on the server */
    }
  }
  connected(botId: string) {
    return !this.stopped && this.grants.has(botId) &&
      (this.options.now ?? Date.now)() - this.lastContact < ONLINE_MS;
  }
  online() { return !this.stopped && this.lastContact>0 && (this.options.now??Date.now)()-this.lastContact<ONLINE_MS; }
  resumeBindings(): UpdateResumeBinding[] {
    const identity = this.accountIdentity ?? (this.owner ? JSON.parse(this.owner) : undefined);
    if (!identity) return [];
    const binding = { base: this.options.base, ...identity, deviceId: this.deviceId };
    return this.accountGeneration ? [{ ...binding, generation: this.accountGeneration }] :
      [...this.grants].map(([botId, grant]) => ({ ...binding, generation: grant.generation, botId }));
  }
  async beginUpdate() {
    recordDesktopDiagnostic("update_started", {active:this.active.size});
    this.updating = true;
    await Promise.all([...this.updateNotices.values()].map(notice => notice()));
  }
  cancelUpdate() { this.updating = false; }
  busy() {
    return this.active.size > 0;
  }
  stop() {
    if (!this.stopped) recordDesktopDiagnostic("relay_stopped", {active:this.active.size});
    this.pollController?.abort();
    ++this.intent;
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.grants.clear();
    this.accountGeneration=undefined;
    this.accountIdentity=undefined;
    this.reportWorkspaces=false;
    this.serverHolds=false;
  }
  private ownedWorkspaces() {
    if (!this.accountGeneration || !this.reportWorkspaces || !this.options.workspaces) return undefined;
    try {
      return this.options.workspaces().filter(key => /^[a-f0-9]{64}$/.test(key)).slice(0, DESKTOP_WORKSPACE_REPORT_LIMIT);
    } catch {
      return undefined; // The server keeps the last report from this PC.
    }
  }
  private async poll() {
    if (this.stopped) return;
    const pollController = new AbortController(); this.pollController = pollController;
    const previousActive = new Set(this.active.keys());
    const workspaces = this.ownedWorkspaces();
    // A held poll returns at once when work arrives, so idle PCs ask about four times a minute.
    const wait = Boolean(this.lastContact) && (Boolean(this.options.agentExecution) || this.serverHolds);
    try {
      const state = (await (
        await this.post(this.accountGeneration ? "account" : "poll", { deviceId: this.deviceId,...(this.accountGeneration ? {generation:this.accountGeneration,identity:this.accountIdentity,...(this.options.agentExecution ? {agentExecution:this.options.agentExecution} : {}),...(workspaces ? {workspaces} : {})} : {}),...(wait ? {wait:true,active:[...previousActive]} : {}) }, AbortSignal.any([pollController.signal, AbortSignal.timeout(25_000)]))
      ).json()) as DesktopExecutorPoll & { identity?: unknown };
      if(this.stopped)return;
      // Report Mico folders only to a server that asked for them, from its next poll on.
      if (this.accountGeneration) this.reportWorkspaces = state.ownership === 1;
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
      if (!this.accountGeneration) {
        // A server that lists this PC's bindings shows exactly which ones a restart lost;
        // without that list, keep reasserting every grant periodically.
        const listed = Array.isArray(state.bindings) && state.bindings.length <= 128
          ? new Set(state.bindings.filter(b => b?.deviceId === this.deviceId).map(b => `${b.botId}\n${b.generation}`))
          : undefined;
        const missing = [...this.grants].filter(([botId, grant]) => !listed?.has(`${botId}\n${grant.generation}`));
        this.serverHolds = false;
        if (listed ? missing.length > 0 : now - this.lastBindingCheck >= 15_000) {
          for (const [botId, grant] of missing) {
            await this.post("bind", { deviceId: this.deviceId, botId, generation: grant.generation });
            if (this.stopped) return;
          }
          this.lastBindingCheck = now;
        }
        this.serverHolds = Boolean(listed) && this.grants.size > 0;
      }
      if(this.accountGeneration){
        if(!Array.isArray(state.bindings)||state.bindings.length>128)throw Error("Invalid account bindings");
        const grants=new Map<string,{generation:string}>();
        for(const raw of state.bindings){const b=parseDesktopBinding(raw);if(b.deviceId!==this.deviceId)continue;grants.set(b.botId,{generation:b.generation});}
        this.grants=grants;
      }
      if (!this.lastContact || (this.options.now ?? Date.now)() - this.lastContact >= ONLINE_MS) recordDesktopDiagnostic("relay_connected");
      this.lastContact = (this.options.now ?? Date.now)();
      this.pollFailures = 0;
      for (const [id, controller] of this.active) {
        const action = missingOperationAction(id, state.active, this.settled);
        if (action === "keep") continue;
        this.active.delete(id);
        if (action === "forget") { this.settled.delete(id); continue; }
        controller.abort();
      }
      for (const id of state.active)
        if (!previousActive.has(id) && !this.active.has(id) && !state.operations.some((op) => op.id === id)) {
          recordDesktopDiagnostic("delivery_lost", {operationId:id,code:"delivery_lost",stage:"poll"});
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
        recordDesktopDiagnostic("operation_received", {operationId:operation.id,runId:"runId" in input.data ? input.data.runId : undefined,method:input.data.method});
        this.active.set(operation.id, controller);
        const release = this.options.awake?.();
        void this.execute(operation, controller).finally(() => { release?.(); this.active.delete(operation.id); this.settled.delete(operation.id); });
      }
    } catch (error) {
      // An older API behind the same address refuses the extra field; the next poll
      // goes without it until a server offers the report again.
      if (workspaces) this.reportWorkspaces = false;
      // After a failure (often an API restart) poll without waiting so lost bindings are listed first.
      this.serverHolds = false;
      if (!this.stopped && !pollController.signal.aborted) {
        this.pollFailures++;
        recordDesktopDiagnostic("relay_poll_failed", {stage:"poll",...desktopExceptionFields(error)});
      }
      // A slow server is not an outage: running work keeps its operations until
      // the stall outlasts what the server's own presence lease tolerates.
      if ((this.options.now ?? Date.now)() - this.lastContact > RELAY_STALL_MS) {
        if (this.active.size) recordDesktopDiagnostic("relay_expired", {active:this.active.size,code:"desktop_disconnected",stage:"poll"});
        // Stop uncertain commands, but retain the approved binding while the
        // network is unavailable. A fresh authenticated poll must precede work.
        // Explicit 401/403 or an identity change still revokes everything.
        for (const controller of this.active.values()) controller.abort();
        this.active.clear();
      }
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), pollRetryDelayMs(this.pollFailures, Boolean(this.options.agentExecution) || this.serverHolds));
      this.timer.unref();
    }
  }
  private async execute(operation: DesktopExecutorOperation, controller: AbortController) {
    let seq = 0, closed = false, discarded = false;
    const started = (this.options.now ?? Date.now)();
    let stage: "native_request" | "native_stream" | "result_ack" = "native_request";
    let failureCode: DesktopFailureCode = "native_transport_interrupted";
    let httpStatus: number | undefined;
    const request = operation.request as {runId?:unknown;method?:unknown};
    const correlation = {operationId:operation.id,runId:request.runId,method:request.method};
    let delivery = Promise.resolve();
    const send = (data: Uint8Array, done: boolean): Promise<void> => {
      const next = delivery.then(async () => {
        if (closed) return;
        const body = {deviceId:this.deviceId,id:operation.id,seq,data:Buffer.from(data).toString("base64"),done};
        // The server accepts the same sequence and bytes again as a lost
        // acknowledgement, so a stalled API delays this frame instead of ending the run.
        const deadline = (this.options.now ?? Date.now)() + RELAY_STALL_MS;
        for (let attempt = 0; ; attempt++) {
          if (done) this.settled.add(operation.id);
          try {
            await this.post("result", body, AbortSignal.any([controller.signal, AbortSignal.timeout(RESULT_ATTEMPT_MS)]));
            this.lastContact = (this.options.now ?? Date.now)();
            break;
          }
          catch (error) {
            const status = relayStatus(error);
            const wait = Math.min(1_000 * 2 ** attempt, 5_000);
            // 409: the server no longer holds this operation (cancelled, timed out or
            // already closed). Retrying cannot deliver it, and nobody reads the output:
            // stop the local work instead of finishing it unobserved.
            const discard = status === 409;
            // A final frame the server may already hold stays settled while it is resent,
            // so a poll in between does not abort it as an orphan.
            if (discard || (status !== undefined && status < 500 && status !== 429) || controller.signal.aborted || this.stopped ||
                (this.options.now ?? Date.now)() + wait >= deadline) {
              if (done) this.settled.delete(operation.id);
              stage = "result_ack";
              if (discard) { discarded = true; controller.abort(); }
              throw error;
            }
            await pause(wait, controller.signal);
            if (controller.signal.aborted || this.stopped) {if (done) this.settled.delete(operation.id);stage="result_ack";throw error;}
          }
        }
        seq++;
        closed = done;
        if (done) this.settled.add(operation.id);
        if (done) recordDesktopDiagnostic("operation_confirmed", {...correlation,lastSequence:seq-1,elapsedMs:(this.options.now ?? Date.now)()-started});
      });
      delivery = next;
      return next;
    };
    // Complete NDJSON lines wait here while a result POST is in flight; the next POST
    // carries all of them. One POST per line made every engine event, callback and model
    // read wait for the previous round trip. Only complete lines enter, so an
    // interruption never splits a frame.
    let outgoing: Buffer = Buffer.alloc(0), ending = false, ended = false;
    let sendFailure: unknown;
    let frames = Promise.resolve();
    const drain = () => {
      frames = frames.then(async () => {
        // Let an end of stream that is already arriving travel with the last lines.
        await deferTurn();
        while (outgoing.byteLength || (ending && !ended)) {
          const data = outgoing.subarray(0, RESULT_FRAME_BYTES);
          outgoing = outgoing.subarray(data.byteLength);
          const last = ending && !outgoing.byteLength;
          await send(data, last);
          if (last) ended = true;
        }
      });
      // The reader keeps going without awaiting; it checks sendFailure instead.
      frames.catch((error: unknown) => { sendFailure ??= error; controller.abort(); });
      return frames;
    };
    const append = (data: Uint8Array) => {
      if (data.byteLength) outgoing = outgoing.byteLength ? Buffer.concat([outgoing, data]) : Buffer.from(data);
    };
    const forward = (data: Uint8Array, done: boolean) => {
      append(data);
      if (done) ending = true;
      return drain();
    };
    const interrupt = async (dispatched = true) => {
      await forward(Buffer.from(JSON.stringify({error:"The PC is updating; pending work will resume after reconnecting.",code:"desktop_updating",dispatched}) + "\n"), true);
      controller.abort();
    };
    this.updateNotices.set(operation.id, interrupt);
    try {
      if (this.updating) { await interrupt(false); return; }
      recordDesktopDiagnostic("operation_native_started", {...correlation,stage});
      const body = JSON.stringify(operation.request);
      if (Buffer.byteLength(body) > HOST_COMPUTER_MAX_BYTES) { failureCode="desktop_request_too_large";throw new Error("Request too large"); }
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
      httpStatus=response.status;
      if (!response.ok || !response.body) {failureCode="native_host_failure";throw new Error("Local computer unavailable");}
      stage = "native_stream";
      const reader = response.body.getReader();
      let pending: Buffer = Buffer.alloc(0);
      try {
        for (;;) {
          if (sendFailure) throw sendFailure;
          const { value, done } = await reader.read();
          if (sendFailure) throw sendFailure;
          if (done) {
            if (pending.byteLength) {failureCode="stream_incomplete";throw Error("Incomplete native frame");}
            await forward(new Uint8Array(), true);
            break;
          }
          pending = Buffer.concat([pending, value]);
          if (pending.byteLength > HOST_COMPUTER_MAX_BYTES) {failureCode="invalid_frame";throw Error("Native frame exceeds its limit");}
          const end = pending.lastIndexOf(10);
          if (end >= 0) {
            void forward(pending.subarray(0, end + 1), false).catch(() => undefined);
            pending = pending.subarray(end + 1);
            // Bound what waits for the relay: past one frame's worth, let the POSTs catch up.
            if (outgoing.byteLength > HOST_COMPUTER_MAX_BYTES) await frames;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      recordDesktopDiagnostic("operation_failed", {...correlation,stage,code:failureCode,httpStatus,lastSequence:seq-1,elapsedMs:(this.options.now ?? Date.now)()-started,...desktopExceptionFields(error)});
      controller.abort();
      if (!this.stopped && !closed && !discarded) {
        try {
          await this.post("result", {
            deviceId: this.deviceId,
            id: operation.id,
            seq,
            data: Buffer.from(
              JSON.stringify({
                error: "Desktop operation interrupted. Check results before retrying.",
                code: failureCode,
                stage,
                operationId: operation.id,
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

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function relayStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
