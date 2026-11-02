import { randomUUID } from "node:crypto";
import type {
  DesktopExecutorOperation,
  DesktopExecutorPoll,
} from "../../../../contracts/desktop-executor.js";
import {
  HOST_COMPUTER_MAX_BYTES,
  hostComputerRequest,
} from "../../../packages/adapters/src/host-computer-protocol.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Native-only outbound transport. The renderer never receives the host bearer. */
export class DesktopRelayClient {
  private deviceId = randomUUID();
  private grants = new Map<string, { generation: string }>();
  private active = new Map<string, AbortController>();
  private stopped = true;
  private timer?: ReturnType<typeof setTimeout>;
  private lastContact = 0;
  private lastBindingCheck = 0;
  private owner?: string;
  constructor(
    private readonly options: {
      base: string;
      fetch: Fetch;
      localUrl: string;
      localToken: string;
      revoked(): void;
      now?: () => number;
    },
  ) {}
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
    await this.identity();
    const existing = this.grants.get(botId);
    // Reassert the same grant after an API restart; never replay an operation.
    const generation =
      existing && !renew ? existing.generation : randomUUID();
    await this.post("bind", {
      deviceId: this.deviceId,
      botId,
      generation,
    });
    this.grants.set(botId, { generation });
    if (!this.lastBindingCheck) this.lastBindingCheck = (this.options.now ?? Date.now)();
    if (this.stopped) {
      this.stopped = false;
      this.lastContact = (this.options.now ?? Date.now)();
      void this.poll();
    }
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
  busy() {
    return this.active.size > 0;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.grants.clear();
  }
  private async poll() {
    if (this.stopped) return;
    try {
      const state = (await (
        await this.post("poll", { deviceId: this.deviceId })
      ).json()) as DesktopExecutorPoll & { identity?: unknown };
      if (!this.owner || JSON.stringify(state.identity) !== this.owner) {
        this.stop();
        this.options.revoked();
        return;
      }
      if (
        !Array.isArray(state.active) ||
        !Array.isArray(state.operations) ||
        state.operations.length > 8
      )
        throw new Error("Invalid Desktop poll");
      // Bindings are volatile on the API. Reassert only the same owner-approved
      // generation after a restart; commands/results are never resubmitted here.
      const now = (this.options.now ?? Date.now)();
      if (now - this.lastBindingCheck >= 15_000) {
        for (const [botId, grant] of this.grants) {
          await this.post("bind", { deviceId: this.deviceId, botId, generation: grant.generation });
          if (this.stopped) return;
        }
        this.lastBindingCheck = now;
      }
      this.lastContact = (this.options.now ?? Date.now)();
      for (const [id, controller] of this.active)
        if (!state.active.includes(id)) {
          controller.abort();
          this.active.delete(id);
        }
      for (const id of state.active)
        if (!this.active.has(id) && !state.operations.some((op) => op.id === id)) {
          // A lost poll is an uncertain delivery, never a reason to replay an effectful command.
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
        void this.execute(operation, controller).finally(() => this.active.delete(operation.id));
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
      this.timer = setTimeout(() => void this.poll(), 2_000);
      this.timer.unref();
    }
  }
  private async execute(operation: DesktopExecutorOperation, controller: AbortController) {
    let seq = 0;
    const send = async (data: Uint8Array, done: boolean) => {
      const body = {
        deviceId: this.deviceId,
        id: operation.id,
        seq,
        data: Buffer.from(data).toString("base64"),
        done,
      };
      // Retry only result delivery, never the command. Broker deduplicates identical sequence/hash.
      for (let attempt = 0; ; attempt++) {
        try {
          await this.post(
            "result",
            body,
            AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          );
          break;
        } catch (error) {
          if (attempt >= 1 || controller.signal.aborted || this.stopped) throw error;
        }
      }
      seq++;
    };
    try {
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
      if (!response.ok || !response.body) throw new Error("Local computer unavailable");
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            await send(new Uint8Array(), true);
            break;
          }
          for (let offset = 0; offset < value.byteLength; offset += 128 * 1024)
            await send(value.subarray(offset, offset + 128 * 1024), false);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      controller.abort();
      if (!this.stopped) {
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
    }
  }
}
