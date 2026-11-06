import path from "node:path";
import { randomUUID } from "node:crypto";
import { DesktopRelayClient } from "./desktop-relay.js";
import { restoreUpdateBinding } from "./update-resume.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

type Host = {
  hasRememberedAccess(scope: string): boolean;
  grant(scope: string): Promise<void>;
  activate(value: boolean): void;
  isEnabled(): boolean;
};
type Context = { base: string; fetch: (url: string, init?: RequestInit) => Promise<Response> };

/** One remembered account grant, independently authenticated transports for every member Space. */
export class AccountComputerConnection {
  private clients = new Map<string, DesktopRelayClient>();
  private scope?: string;
  private signature?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopped = true;
  private updating = false;
  private deviceId?: string;
  private defaultSpace?: string;
  constructor(
    private readonly options: {
      profile: string;
      nativeVersion?: string;
      host: Host;
      localUrl: string;
      localToken: string;
      context(): Promise<Context | null>;
      consentScope(base: string, identity: { userId: string }): string;
      changed?(): void;
    },
  ) {}
  hasConsent() {
    return !!this.scope && this.options.host.hasRememberedAccess(this.scope);
  }
  connected(botId: string, spaceId: string | null) {
    const id = spaceId ?? this.defaultSpace;
    return id ? this.clients.get(id)?.connected(botId) === true : false;
  }
  online() {
    return [...this.clients.values()].some((c) => c.online());
  }
  async freezeForUpdate() { this.updating = true; await this.pending; }
  resumeBindings() { return [...this.clients.values()].flatMap(client => client.resumeBindings()); }
  async beginUpdate() { await this.freezeForUpdate(); await Promise.all([...this.clients.values()].map(client => client.beginUpdate())); }
  cancelUpdate() { this.updating = false; for (const client of this.clients.values()) client.cancelUpdate(); }
  busy() {
    return [...this.clients.values()].some((c) => c.busy());
  }
  start() {
    this.stopped = false;
    void this.refresh();
  }
  private disconnect() {
    for (const c of this.clients.values()) c.stop();
    this.clients.clear();
    this.signature = undefined;
    this.options.host.activate(false);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.disconnect();
    this.options.changed?.();
  }
  async revoke() {
    const clients = [...this.clients.values()];
    this.scope = undefined;
    this.stop();
    await Promise.allSettled(clients.map((c) => c.revoke()));
  }
  async connect(botId: string, spaceId: string | null) {
    await this.refresh();
    const id = spaceId ?? this.defaultSpace;
    const client = id ? this.clients.get(id) : undefined;
    if (!client || !client.online())
      throw Error("The paired PC is disconnected. Start Mycellios Desktop on that computer.");
    await client.bind(botId);
  }
  refresh() {
    if (this.updating) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.reconcile().finally(() => {
      this.pending = undefined;
      this.options.changed?.();
      if (!this.stopped) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), 15_000);
        this.timer.unref();
      }
    });
    return this.pending;
  }
  private async reconcile() {
    try {
      const context = await this.options.context();
      if (!context) {
        if (this.signature || this.clients.size) this.disconnect();
        this.scope = undefined;
        return;
      }
      const saved = await readPrivateFile(
        path.join(this.options.profile, "host-computer-account-consent"),
        128,
      );
      this.scope = saved ?? undefined;
      if (!this.hasConsent()) {
        for (const c of this.clients.values()) c.stop();
        this.clients.clear();
        this.options.host.activate(false);
        return;
      }
      if (!this.deviceId) {
        const file = path.join(this.options.profile, "desktop-device-id");
        const stored = await readPrivateFile(file, 128);
        this.deviceId =
          stored &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored)
            ? stored
            : randomUUID();
        if (stored !== this.deviceId) await writePrivateFile(file, this.deviceId);
      }
      const transport = (spaceId?: string) => async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (spaceId) headers.set("x-rakazo-space-id", spaceId);
        else headers.delete("x-rakazo-space-id");
        return context.fetch(url, { ...init, headers });
      };
      // Keep the native cookie renewed while the paired PC is online, without a renderer.
      await context
        .fetch(`${context.base}/api/auth/get-session`, {
          credentials: "include",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        })
        .then((response) => response.body?.cancel())
        .catch(() => undefined);
      const root = new DesktopRelayClient({
        base: context.base,
        fetch: transport(),
        localUrl: this.options.localUrl,
        localToken: this.options.localToken,
        revoked: () => this.disconnect(),
      });
      const identity = await root.identity();
      const scope = this.options.consentScope(context.base, identity);
      if (scope !== saved || !this.options.host.hasRememberedAccess(scope)) {
        for (const c of this.clients.values()) c.stop();
        this.clients.clear();
        this.options.host.activate(false);
        return;
      }
      const signature = JSON.stringify([context.base, identity.userId, identity.connectionId]);
      this.defaultSpace = identity.spaceId;
      if (this.signature !== signature) {
        for (const c of this.clients.values()) c.stop();
        this.clients.clear();
        this.options.host.activate(false);
        this.signature = signature;
      }
      if (!this.options.host.isEnabled()) await this.options.host.grant(scope);
      // Recheck the native grant after awaited identity/grant work, before publication.
      if (this.stopped || !this.options.host.hasRememberedAccess(scope)) return;
      this.options.host.activate(true);
      const spaces = await root.spaces();
      for (const [id, client] of this.clients)
        if (!spaces.includes(id)) {
          client.stop();
          this.clients.delete(id);
        }
      for (const spaceId of spaces) {
        if (this.stopped || !this.hasConsent()) break;
        let client = this.clients.get(spaceId);
        if (!client) {
          client = new DesktopRelayClient({
            base: context.base,
            fetch: transport(spaceId),
            localUrl: this.options.localUrl,
            localToken: this.options.localToken,
            deviceId: this.deviceId,
            restoreUpdate: this.options.nativeVersion ? identity => restoreUpdateBinding(this.options.profile, this.options.nativeVersion!, context.base, identity) : undefined,
            revoked: () => {
              this.clients.get(spaceId)?.stop();
              this.clients.delete(spaceId);
            },
          });
          this.clients.set(spaceId, client);
        }
        await client.registerAccount({
          userId: identity.userId,
          spaceId,
          connectionId: identity.connectionId,
        });
      }
    } catch {
      // Native polls independently expire on connectivity loss and abort uncertain commands.
      // A new account/session is never accepted by an existing account poll.
    }
  }
}
