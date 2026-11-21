import { randomUUID } from "node:crypto";
import type { proto } from "baileys";
import type {
  DesktopWhatsAppGroup,
  DesktopWhatsAppInboundMessage,
  DesktopWhatsAppLinkConfig,
  DesktopWhatsAppOperation,
  DesktopWhatsAppSyncLink,
  WhatsAppLinkMode,
} from "../../../../../contracts/desktop-whatsapp.js";
import {
  bareWhatsAppJid,
  isWhatsAppGroupJid,
  isWhatsAppUserJid,
  WHATSAPP_MAX_ATTACHMENT_BYTES,
  WHATSAPP_MAX_BATCH,
  WHATSAPP_MAX_GROUPS,
} from "../../../../../contracts/desktop-whatsapp.js";
import type { AccountContext } from "./api-client.js";
import { WhatsAppApiClient, WhatsAppApiError } from "./api-client.js";
import { listWhatsAppLinkFiles, WhatsAppAuthFile } from "./auth-store.js";
import type { InboundCandidate } from "./inbound.js";
import { attachmentTooLarge, classifyInbound, isGroupJid, tooLargeNote } from "./inbound.js";
import { planOperation, sendError } from "./outbound.js";
import type { WAMessage, WhatsAppRuntime, WhatsAppSocket } from "./types.js";

export type WhatsAppLinkState =
  | "qr"
  | "pairing_code"
  | "connecting"
  | "connected"
  | "logged_out"
  | "error";
export interface WhatsAppStatus {
  sessionKey: string;
  linkId?: string;
  state: WhatsAppLinkState;
  phone?: string;
  qr?: string;
  pairingCode?: string;
  error?: string;
}
export interface WhatsAppLinkRequest {
  botId: string;
  mode: WhatsAppLinkMode;
  method: "qr" | "pairing_code";
  phone?: string;
}

export interface WhatsAppConnectorOptions {
  userDataDir: string;
  /** 32-byte key that encrypts the local WhatsApp keys. */
  dataKey(): Promise<Buffer>;
  /** Lazy Baileys import; called only when a link exists or linking starts. */
  runtime(): Promise<WhatsAppRuntime>;
  /** Server and native session, or null while signed out / not on a cloud server. */
  context(): Promise<AccountContext | null>;
  deviceId(): Promise<string>;
  /** Space currently selected in the app window, sent when registering a new link. */
  space?(): Promise<string | null>;
  emit(status: WhatsAppStatus[]): void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  syncIntervalMs?: number;
}

interface Link {
  localId: string;
  auth: WhatsAppAuthFile;
  state: WhatsAppLinkState;
  socket?: WhatsAppSocket;
  open: boolean;
  qr?: string;
  pairingCode?: string;
  error?: string;
  method?: "qr" | "pairing_code";
  phone?: string;
  pairingRequested?: boolean;
  config?: DesktopWhatsAppLinkConfig;
  ready: Promise<void>;
  markReady(): void;
  attempts: number;
  reconnect?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  /** Removed in the web settings while this socket was not open: log out once it opens. */
  forget?: boolean;
  recent: Map<string, proto.IMessage>;
  lidToPn: Map<string, string>;
  groupNames: Map<string, string>;
  groups?: { at: number; list: DesktopWhatsAppGroup[] };
  uploads: Promise<void>;
}

const RECENT_MESSAGES = 500;
const GROUP_REFRESH_MS = 10 * 60_000;
const MAX_LINKS = 20;
const UPLOAD_DELAYS = [1_000, 5_000, 15_000];
const TIMEOUT = (ms: number, label: string) =>
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out`)), ms).unref?.(),
  );

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

function closeCode(update: { lastDisconnect?: { error?: unknown } }): number | undefined {
  const error = update.lastDisconnect?.error as { output?: { statusCode?: unknown } } | undefined;
  const code = error?.output?.statusCode;
  return typeof code === "number" ? code : undefined;
}

/**
 * WhatsApp linked-device connector: one Baileys socket per linked number, the
 * local privacy filter, uploads to the API, the outbox long-poll and the sync
 * loop. Keys stay in encrypted files on this PC; message content is never logged.
 */
export class WhatsAppConnector {
  private links = new Map<string, Link>();
  private runtimeValue?: Promise<WhatsAppRuntime>;
  private keyValue?: Promise<Buffer>;
  private account?: { base: string; userId: string };
  private checked?: { base: string; userId: string; at: number };
  private timer?: ReturnType<typeof setTimeout>;
  private ticking?: Promise<void>;
  private pulling = false;
  private pullAbort?: AbortController;
  private disposed = false;
  private restored = false;

  constructor(private readonly options: WhatsAppConnectorOptions) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }
  private wait(ms: number) {
    return this.options.wait
      ? this.options.wait(ms)
      : new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());
  }
  private async runtime() {
    if (!this.runtimeValue) this.runtimeValue = this.options.runtime();
    return this.runtimeValue;
  }
  private async key() {
    if (!this.keyValue) this.keyValue = this.options.dataKey();
    return this.keyValue;
  }

  /** Restores saved links and starts the sync loop; loads Baileys only when a link exists. */
  start() {
    this.disposed = false;
    void this.tick();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.pullAbort?.abort();
    for (const link of this.links.values()) {
      clearTimeout(link.reconnect);
      link.stopped = true;
      link.socket?.end(undefined);
      link.socket = undefined;
      void link.auth.save().catch(() => undefined);
    }
  }

  private owned(link: Link) {
    return (
      !!this.account &&
      link.auth.meta.base === this.account.base &&
      link.auth.meta.userId === this.account.userId
    );
  }

  /** Status for the signed-in account of the current server (refreshes that account first). */
  async currentStatus(): Promise<WhatsAppStatus[]> {
    await this.currentAccount();
    return this.status();
  }

  status(): WhatsAppStatus[] {
    return [...this.links.values()]
      .filter((link) => this.owned(link))
      .map((link) => ({
        sessionKey: link.localId,
        ...(link.auth.meta.linkId ? { linkId: link.auth.meta.linkId } : {}),
        state: link.state,
        ...((link.auth.meta.phone ?? link.phone)
          ? { phone: link.auth.meta.phone ?? link.phone }
          : {}),
        ...(link.state === "qr" && link.qr ? { qr: link.qr } : {}),
        ...(link.state === "pairing_code" && link.pairingCode
          ? { pairingCode: link.pairingCode }
          : {}),
        ...(link.error ? { error: link.error } : {}),
      }));
  }

  private changed() {
    if (!this.disposed) this.options.emit(this.status());
  }

  private setState(
    link: Link,
    state: WhatsAppLinkState,
    extra: Partial<Pick<Link, "qr" | "pairingCode" | "error">> = {},
  ) {
    link.state = state;
    link.qr = extra.qr;
    link.pairingCode = extra.pairingCode;
    link.error = extra.error;
    this.changed();
  }

  private newLink(localId: string, auth: WhatsAppAuthFile): Link {
    let markReady = () => undefined as void;
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    return {
      localId,
      auth,
      state: "connecting",
      open: false,
      ready,
      markReady,
      attempts: 0,
      stopped: false,
      recent: new Map(),
      lidToPn: new Map(),
      groupNames: new Map(),
      uploads: Promise.resolve(),
    };
  }

  /**
   * Current server/account; refreshes the cached owner used to scope status and links.
   * The signed-in user is re-read at most once a minute unless `fresh` is set.
   */
  private async currentAccount(
    fresh = false,
  ): Promise<{ client: WhatsAppApiClient; userId: string } | null> {
    const context = await this.options.context().catch(() => null);
    if (!context) return null;
    const client = new WhatsAppApiClient(context);
    const cached = this.checked;
    const userId =
      !fresh && cached?.base === context.base && this.now() - cached.at < 60_000
        ? cached.userId
        : await client.userId().catch(() => null);
    if (!userId) {
      this.checked = undefined;
      return null;
    }
    if (
      cached?.base !== context.base ||
      cached.userId !== userId ||
      fresh ||
      this.now() - cached.at >= 60_000
    )
      this.checked = { base: context.base, userId, at: this.now() };
    const changed = this.account?.base !== context.base || this.account?.userId !== userId;
    this.account = { base: context.base, userId };
    if (changed) this.changed();
    return { client, userId };
  }

  private async restore() {
    if (this.restored) return;
    const ids = await listWhatsAppLinkFiles(this.options.userDataDir);
    if (!ids.length) {
      this.restored = true;
      return;
    }
    // A failed key or runtime load is retried on the next tick.
    const runtime = await this.runtime();
    const key = await this.key();
    this.restored = true;
    for (const localId of ids) {
      if (this.links.has(localId)) continue;
      try {
        const auth = await WhatsAppAuthFile.open(this.options.userDataDir, key, runtime, localId);
        if (auth) this.links.set(localId, this.newLink(localId, auth));
      } catch {
        // An unreadable file (lost OS key, damage) is left untouched and not started.
      }
    }
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.reconcile()
      .catch(() => undefined)
      .finally(() => {
        this.ticking = undefined;
        if (this.disposed) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.tick(), this.options.syncIntervalMs ?? 15_000);
        this.timer.unref?.();
      });
    return this.ticking;
  }

  private async reconcile() {
    await this.restore();
    if (!this.links.size) return;
    const account = await this.currentAccount(true);
    if (!account) return;
    // Another account's links stay on disk but never run under this session.
    for (const link of this.links.values())
      if (!this.owned(link) && link.socket) {
        link.stopped = true;
        link.socket.end(undefined);
        link.socket = undefined;
        link.open = false;
      }
    const deviceId = await this.options.deviceId();
    const registered = [...this.links.values()].filter(
      (link) => this.owned(link) && link.auth.meta.linkId && !link.forget,
    );
    const unregistered = [...this.links.values()].filter(
      (link) => this.owned(link) && !link.auth.meta.linkId && !link.socket && !link.method,
    );
    // Interrupted linking (the app quit before registration): sign that device out.
    for (const link of unregistered) this.forget(link);
    const request: DesktopWhatsAppSyncLink[] = [];
    for (const link of registered) {
      const groups = link.open ? await this.groups(link) : undefined;
      request.push({
        linkId: link.auth.meta.linkId!,
        status: link.state === "logged_out" ? "logged_out" : link.open ? "connected" : "connecting",
        ...(groups ? { groups } : {}),
      });
    }
    if (!request.length) return;
    const configs = await account.client.sync({
      desktopDeviceId: deviceId,
      links: request.slice(0, MAX_LINKS),
    });
    const byId = new Map(configs.map((config) => [config.linkId, config]));
    for (const link of registered) {
      if (!request.some((entry) => entry.linkId === link.auth.meta.linkId)) continue;
      const config = byId.get(link.auth.meta.linkId!);
      if (!config) {
        this.forget(link);
        continue;
      }
      this.applyConfig(link, config);
      if (
        !link.socket &&
        !link.reconnect &&
        link.state !== "logged_out" &&
        link.state !== "error"
      ) {
        link.stopped = false;
        await this.startSocket(link);
      }
    }
    this.ensurePull();
  }

  private applyConfig(link: Link, config: DesktopWhatsAppLinkConfig) {
    link.config = config;
    if (config.botId !== link.auth.meta.botId || config.mode !== link.auth.meta.mode)
      void link.auth.updateMeta({ botId: config.botId, mode: config.mode }).catch(() => undefined);
    link.markReady();
  }

  private async groups(link: Link): Promise<DesktopWhatsAppGroup[] | undefined> {
    if (link.groups && this.now() - link.groups.at < GROUP_REFRESH_MS) return link.groups.list;
    try {
      const all = await Promise.race([
        link.socket!.groupFetchAllParticipating(),
        TIMEOUT(20_000, "Groups"),
      ]);
      const list = Object.values(all)
        .filter((group) => isWhatsAppGroupJid(group.id))
        .slice(0, WHATSAPP_MAX_GROUPS)
        .map((group) => ({ jid: group.id, name: (group.subject ?? "").slice(0, 100) || "Group" }));
      for (const group of list) remember(link.groupNames, group.jid, group.name, 1_000);
      link.groups = { at: this.now(), list };
      return list;
    } catch {
      return link.groups?.list;
    }
  }

  async link(request: WhatsAppLinkRequest): Promise<{ sessionKey: string }> {
    const account = await this.currentAccount(true);
    if (!account) throw new Error("Sign in to Mycellios first.");
    await this.restore();
    if ([...this.links.values()].filter((link) => this.owned(link)).length >= MAX_LINKS)
      throw new Error("Too many WhatsApp numbers on this PC.");
    if (
      [...this.links.values()].filter(
        (link) =>
          this.owned(link) && !link.auth.meta.linkId && link.method && link.state !== "error",
      ).length >= 3
    )
      throw new Error("Finish or cancel the current WhatsApp link first.");
    const runtime = await this.runtime();
    const spaceId = (await this.options.space?.().catch(() => null)) ?? undefined;
    const localId = randomUUID();
    const auth = await WhatsAppAuthFile.create(
      this.options.userDataDir,
      await this.key(),
      runtime,
      {
        localId,
        botId: request.botId,
        mode: request.mode,
        base: account.client.base,
        userId: account.userId,
        ...(spaceId ? { spaceId } : {}),
      },
    );
    const link = this.newLink(localId, auth);
    link.method = request.method;
    link.phone = request.phone;
    this.links.set(localId, link);
    this.changed();
    await this.startSocket(link);
    return { sessionKey: localId };
  }

  /** Stops a link that has not been registered yet (closing the QR / code dialog). */
  async cancel(sessionKey: string) {
    const link = this.links.get(sessionKey);
    if (!link || !this.owned(link)) return;
    if (link.auth.meta.linkId) return this.disconnect(link.auth.meta.linkId);
    await this.drop(link);
  }

  /** Signs this PC out of the number and removes its keys and the server link. */
  async disconnect(linkId: string) {
    const link = [...this.links.values()].find(
      (entry) => entry.auth.meta.linkId === linkId && this.owned(entry),
    );
    if (!link) return;
    const socket = link.open ? link.socket : undefined;
    if (socket)
      await Promise.race([socket.logout(), TIMEOUT(10_000, "Logout")]).catch(() => undefined);
    await this.drop(link);
    const account = await this.currentAccount();
    const deviceId = await this.options.deviceId();
    await account?.client.unlink({ desktopDeviceId: deviceId, linkId }).catch(() => undefined);
  }

  private async drop(link: Link) {
    link.stopped = true;
    clearTimeout(link.reconnect);
    link.socket?.end(undefined);
    link.socket = undefined;
    link.open = false;
    this.links.delete(link.localId);
    await link.auth.remove().catch(() => undefined);
    this.changed();
  }

  /** Logs the device out (opening a socket just for that when needed), then deletes its keys. */
  private forget(link: Link) {
    if (link.forget) return;
    link.forget = true;
    if (link.open && link.socket) {
      void Promise.race([link.socket.logout(), TIMEOUT(10_000, "Logout")])
        .catch(() => undefined)
        .finally(() => void this.drop(link));
      return;
    }
    if (!link.auth.state.creds.registered && !link.auth.state.creds.me) {
      void this.drop(link);
      return;
    }
    if (!link.socket) {
      link.stopped = false;
      void this.startSocket(link).catch(() => this.drop(link));
    }
    setTimeout(() => void this.drop(link), 30_000).unref?.();
  }

  private async unlinkOnServer(link: Link) {
    const linkId = link.auth.meta.linkId;
    const account = await this.currentAccount();
    if (!linkId || !account) return;
    await account.client
      .unlink({ desktopDeviceId: await this.options.deviceId(), linkId })
      .catch(() => undefined);
  }

  private async startSocket(link: Link) {
    const runtime = await this.runtime();
    if (link.stopped || this.disposed) return;
    clearTimeout(link.reconnect);
    link.reconnect = undefined;
    const socket = runtime.makeSocket({
      auth: link.auth.state,
      getMessage: async (key) => (key.id ? link.recent.get(key.id) : undefined),
    });
    link.socket = socket;
    link.open = false;
    if (link.auth.meta.linkId && link.state !== "connecting") this.setState(link, "connecting");
    socket.ev.on("creds.update", () => void link.auth.save().catch(() => undefined));
    socket.ev.on("connection.update", (update) => void this.onConnection(link, socket, update));
    socket.ev.on("messages.upsert", (event) => {
      if (event.type !== "notify" && event.type !== "append") return;
      link.uploads = link.uploads
        .then(() => this.onMessages(link, socket, event.messages))
        .catch(() => undefined);
    });
  }

  private async onConnection(
    link: Link,
    socket: WhatsAppSocket,
    update: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } },
  ) {
    if (link.socket !== socket || link.stopped) return;
    const runtime = await this.runtime();
    if (update.qr && !link.auth.meta.linkId && !link.forget) {
      if (link.method === "pairing_code") {
        if (!link.pairingRequested && link.phone) {
          link.pairingRequested = true;
          try {
            const code = await socket.requestPairingCode(link.phone);
            if (link.socket === socket) this.setState(link, "pairing_code", { pairingCode: code });
          } catch {
            await this.fail(link, "The pairing code could not be requested.");
          }
        }
      } else this.setState(link, "qr", { qr: update.qr });
    }
    if (update.connection === "open") {
      link.open = true;
      link.attempts = 0;
      await this.onOpen(link, socket);
      return;
    }
    if (update.connection !== "close") return;
    link.socket = undefined;
    link.open = false;
    if (link.stopped || this.disposed) return;
    const code = closeCode(update);
    if (link.forget) return void this.drop(link);
    if (code === runtime.loggedOut) {
      if (link.auth.meta.linkId) return this.loggedOut(link);
      return this.fail(link, "WhatsApp did not accept the link.");
    }
    if (code === runtime.restartRequired) return this.startSocket(link);
    if (!link.auth.meta.linkId && !link.auth.state.creds.registered)
      return this.fail(link, "The link expired. Try again.");
    if (code === runtime.forbidden) {
      link.stopped = true;
      this.setState(link, "error", { error: "WhatsApp refused this device." });
      return;
    }
    const delay = Math.min(300_000, 2_000 * 2 ** link.attempts);
    link.attempts++;
    this.setState(link, link.auth.meta.linkId ? "connecting" : link.state);
    link.reconnect = setTimeout(() => {
      link.reconnect = undefined;
      void this.startSocket(link);
    }, delay);
    link.reconnect.unref?.();
  }

  private async fail(link: Link, error: string) {
    link.stopped = true;
    clearTimeout(link.reconnect);
    link.socket?.end(undefined);
    link.socket = undefined;
    await link.auth.remove().catch(() => undefined);
    this.setState(link, "error", { error });
    // The failed attempt stays visible until the next status read after a new link or cancel.
    setTimeout(() => {
      if (this.links.get(link.localId) === link) {
        this.links.delete(link.localId);
        this.changed();
      }
    }, 5 * 60_000).unref?.();
  }

  private async loggedOut(link: Link) {
    link.stopped = true;
    clearTimeout(link.reconnect);
    await link.auth.remove().catch(() => undefined);
    this.setState(link, "logged_out");
    await this.unlinkOnServer(link);
    this.links.delete(link.localId);
    this.changed();
  }

  private self(link: Link, socket: WhatsAppSocket) {
    const me = socket.user ?? link.auth.state.creds.me;
    if (!me?.id) return null;
    const jid = bareWhatsAppJid(me.id.includes("@") ? me.id : `${me.id}@s.whatsapp.net`);
    const lid = me.lid ? bareWhatsAppJid(me.lid) : undefined;
    return {
      jid,
      lid: lid && /^[0-9]{5,30}@lid$/.test(lid) ? lid : undefined,
      name: me.name ?? me.notify,
    };
  }

  private async onOpen(link: Link, socket: WhatsAppSocket) {
    if (link.forget) {
      await Promise.race([socket.logout(), TIMEOUT(10_000, "Logout")]).catch(() => undefined);
      return this.drop(link);
    }
    const self = this.self(link, socket);
    if (!self || !isWhatsAppUserJid(self.jid))
      return this.fail(link, "WhatsApp did not report this number.");
    const phone = self.jid.split("@")[0]!;
    if (link.auth.meta.linkId) {
      this.setState(link, "connected");
      this.ensurePull();
      return;
    }
    const account = await this.currentAccount(true);
    if (!account || !this.owned(link)) {
      await Promise.race([socket.logout(), TIMEOUT(10_000, "Logout")]).catch(() => undefined);
      return this.fail(link, "The Mycellios session changed.");
    }
    let config: DesktopWhatsAppLinkConfig | undefined;
    for (let attempt = 0; attempt < 3 && !config; attempt++) {
      try {
        config = await account.client.register(
          {
            desktopDeviceId: await this.options.deviceId(),
            botId: link.auth.meta.botId,
            mode: link.auth.meta.mode,
            accountJid: self.jid,
            ...(self.lid ? { accountLid: self.lid } : {}),
            phone,
            ...(self.name ? { pushName: self.name.slice(0, 100) } : {}),
          },
          link.auth.meta.spaceId,
        );
      } catch (error) {
        if (
          !(error instanceof WhatsAppApiError && error.transient) &&
          !(error instanceof TypeError)
        )
          break;
        await this.wait(UPLOAD_DELAYS[attempt] ?? 15_000);
      }
    }
    if (link.socket !== socket || link.stopped) return;
    if (!config) {
      await Promise.race([socket.logout(), TIMEOUT(10_000, "Logout")]).catch(() => undefined);
      return this.fail(link, "Mycellios could not register this number.");
    }
    await link.auth.updateMeta({ linkId: config.linkId, phone });
    link.method = undefined;
    this.applyConfig(link, config);
    this.setState(link, "connected");
    this.ensurePull();
    await this.send(link, socket, self.jid, { text: "👋" }).catch(() => undefined);
  }

  /** Sends with an id chosen first, so the echo of our own message is never uploaded. */
  private async send(link: Link, socket: WhatsAppSocket, jid: string, content: { text: string }) {
    const runtime = await this.runtime();
    const id = runtime.messageId(socket.user?.id);
    link.auth.rememberSent(id);
    const sent = await Promise.race([
      socket.sendMessage(jid, content, { messageId: id }),
      TIMEOUT(30_000, "Send"),
    ]);
    return sent?.key?.id ?? id;
  }

  private async onMessages(link: Link, socket: WhatsAppSocket, messages: WAMessage[]) {
    if (!link.auth.meta.linkId && !link.config) {
      await Promise.race([link.ready, this.wait(60_000)]);
    }
    const config = link.config;
    if (!config || link.stopped || link.forget || !this.owned(link)) return;
    const self = this.self(link, socket);
    if (!self) return;
    for (const message of messages)
      if (message.key?.id && message.message)
        remember(link.recent, message.key.id, message.message, RECENT_MESSAGES);
    // Resolve LIDs that WhatsApp did not pair with a phone number, before filtering.
    const lids = new Set<string>();
    for (const message of messages) {
      const { remoteJid, remoteJidAlt, participant, participantAlt } = message.key ?? {};
      if (remoteJid?.endsWith("@lid") && !remoteJidAlt) lids.add(bareWhatsAppJid(remoteJid));
      if (participant?.endsWith("@lid") && !participantAlt) lids.add(bareWhatsAppJid(participant));
      for (const [lid, alt] of [
        [remoteJid, remoteJidAlt],
        [participant, participantAlt],
      ])
        if (lid?.endsWith("@lid") && alt?.endsWith("@s.whatsapp.net"))
          remember(link.lidToPn, bareWhatsAppJid(lid), bareWhatsAppJid(alt), 5_000);
    }
    for (const lid of lids) {
      if (link.lidToPn.has(lid)) continue;
      const pn = await socket.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
      if (pn) remember(link.lidToPn, lid, bareWhatsAppJid(pn), 5_000);
    }
    const candidates: Array<{ candidate: InboundCandidate; message: WAMessage }> = [];
    for (const message of messages) {
      const candidate = classifyInbound(message, {
        self,
        config,
        sentIds: link.auth.sentIds(),
        now: Math.floor(this.now() / 1000),
        pnForLid: (lid) => link.lidToPn.get(lid),
      });
      if (candidate) candidates.push({ candidate, message });
    }
    if (!candidates.length) return;
    const uploads: DesktopWhatsAppInboundMessage[] = [];
    for (const { candidate, message } of candidates)
      uploads.push(await this.prepare(link, socket, candidate, message));
    // Text messages share batches; each attachment travels alone.
    let batch: DesktopWhatsAppInboundMessage[] = [];
    const flush = async () => {
      if (batch.length) await this.upload(link, batch);
      batch = [];
    };
    for (const upload of uploads) {
      if (upload.attachment) {
        await flush();
        await this.upload(link, [upload]);
      } else {
        batch.push(upload);
        if (batch.length >= WHATSAPP_MAX_BATCH) await flush();
      }
    }
    await flush();
  }

  private async prepare(
    link: Link,
    socket: WhatsAppSocket,
    candidate: InboundCandidate,
    message: WAMessage,
  ) {
    let text = candidate.text;
    let attachment: DesktopWhatsAppInboundMessage["attachment"];
    if (candidate.media) {
      if (attachmentTooLarge(candidate)) text = tooLargeNote(candidate);
      else {
        try {
          const runtime = await this.runtime();
          const data = await Promise.race([
            runtime.download(message, socket),
            TIMEOUT(60_000, "Download"),
          ]);
          if (data.length > WHATSAPP_MAX_ATTACHMENT_BYTES) text = tooLargeNote(candidate);
          else
            attachment = {
              name: candidate.media.name,
              mimeType: candidate.media.mimeType,
              dataBase64: data.toString("base64"),
            };
        } catch {
          const note = `[file: ${candidate.media.name} (unavailable)]`;
          text = text ? `${text}\n${note}` : note;
        }
      }
    }
    let groupName: string | undefined;
    if (candidate.kind === "group") {
      groupName = link.groupNames.get(candidate.chatJid);
      if (!groupName) {
        const metadata = await Promise.race([
          socket.groupMetadata(candidate.chatJid),
          TIMEOUT(10_000, "Group"),
        ]).catch(() => null);
        groupName = metadata?.subject?.slice(0, 100) || undefined;
        if (groupName) remember(link.groupNames, candidate.chatJid, groupName, 1_000);
      }
    }
    return {
      id: candidate.id,
      chatJid: candidate.chatJid,
      senderJid: candidate.senderJid,
      senderName: candidate.senderName,
      kind: candidate.kind,
      text,
      timestamp: candidate.timestamp,
      ...(groupName ? { groupName } : {}),
      ...(candidate.participant ? { participant: candidate.participant } : {}),
      ...(attachment ? { attachment } : {}),
    } satisfies DesktopWhatsAppInboundMessage;
  }

  /** The server is idempotent per (link, message id); transient failures retry a few times. */
  private async upload(link: Link, messages: DesktopWhatsAppInboundMessage[]) {
    for (let attempt = 0; ; attempt++) {
      try {
        const account = await this.currentAccount();
        const linkId = link.auth.meta.linkId;
        if (!account || !linkId || !this.owned(link)) throw new TypeError("Signed out");
        const results = await account.client.inbound({
          desktopDeviceId: await this.options.deviceId(),
          linkId,
          messages,
        });
        for (const message of messages)
          if (
            results.get(message.id) === "pending_approval" &&
            link.config &&
            !link.config.pending.includes(message.senderJid)
          )
            link.config.pending.push(message.senderJid);
        return;
      } catch (error) {
        const transient =
          error instanceof TypeError ||
          (error instanceof WhatsAppApiError && error.transient) ||
          (error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError"));
        if (!transient || attempt >= UPLOAD_DELAYS.length || link.stopped) return;
        await this.wait(UPLOAD_DELAYS[attempt]!);
      }
    }
  }

  private ensurePull() {
    if (this.pulling || this.disposed) return;
    if (
      ![...this.links.values()].some(
        (link) => link.open && link.auth.meta.linkId && this.owned(link),
      )
    )
      return;
    this.pulling = true;
    void this.pullLoop().finally(() => {
      this.pulling = false;
    });
  }

  private async pullLoop() {
    while (
      !this.disposed &&
      [...this.links.values()].some(
        (link) => link.open && link.auth.meta.linkId && this.owned(link),
      )
    ) {
      try {
        const account = await this.currentAccount();
        if (!account) {
          await this.wait(15_000);
          continue;
        }
        const deviceId = await this.options.deviceId();
        this.pullAbort = new AbortController();
        const started = this.now();
        const { operations, invalid } = await account.client.pull(deviceId, this.pullAbort.signal);
        // A server that answers an empty poll at once must not turn this into a busy loop.
        if (!operations.length && !invalid.length && this.now() - started < 1_000)
          await this.wait(2_000);
        for (const id of invalid)
          await this.report(account.client, {
            desktopDeviceId: deviceId,
            id,
            ok: false,
            error: "Invalid operation",
          });
        for (const operation of operations) {
          const result = await this.perform(operation);
          await this.report(account.client, {
            desktopDeviceId: deviceId,
            id: operation.id,
            ...result,
          });
        }
      } catch (error) {
        if (this.disposed) return;
        await this.wait(
          error instanceof WhatsAppApiError && (error.status === 401 || error.status === 403)
            ? 30_000
            : 5_000,
        );
      }
    }
  }

  private async report(
    client: WhatsAppApiClient,
    result: { desktopDeviceId: string; id: string; ok: boolean; handle?: string; error?: string },
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await client.result(result);
      } catch (error) {
        if (error instanceof WhatsAppApiError && !error.transient) return;
        await this.wait(UPLOAD_DELAYS[attempt]!);
      }
    }
  }

  /**
   * Defence in depth for the server's allowlist: groups must be allowed, and a personal
   * number never writes to anyone outside its own chat and allowed contacts.
   */
  private mayWrite(link: Link, config: DesktopWhatsAppLinkConfig, ownJid: string, chatJid: string) {
    const listed = (kind: "contact" | "group", jid: string) =>
      config.allowed.some((entry) => entry.kind === kind && bareWhatsAppJid(entry.jid) === jid);
    const target = bareWhatsAppJid(chatJid);
    if (isGroupJid(target)) return listed("group", target);
    if (config.mode === "dedicated" || target === bareWhatsAppJid(ownJid)) return true;
    const pn = link.lidToPn.get(target);
    const lid = [...link.lidToPn].find(([, value]) => value === target)?.[0];
    return [target, pn, lid].some((jid) => jid && listed("contact", jid));
  }

  /** Performs one claimed operation exactly once; it is never retried here. */
  async perform(
    operation: DesktopWhatsAppOperation,
  ): Promise<{ ok: boolean; handle?: string; error?: string }> {
    const link = [...this.links.values()].find(
      (entry) => entry.auth.meta.linkId === operation.linkId && this.owned(entry),
    );
    const socket = link?.open ? link.socket : undefined;
    if (!link || !socket || link.stopped || !socket.user?.id || !link.config)
      return { ok: false, error: "WhatsApp is not connected" };
    if (!this.mayWrite(link, link.config, socket.user.id, operation.chatJid))
      return { ok: false, error: "Chat is not allowed" };
    try {
      const runtime = await this.runtime();
      const id = runtime.messageId(socket.user.id);
      link.auth.rememberSent(id);
      const plan = planOperation(operation, socket.user.id, id, (quoted) =>
        link.recent.get(quoted),
      );
      const sent = await Promise.race([
        socket.sendMessage(plan.jid, plan.content, plan.options),
        TIMEOUT(30_000, "Send"),
      ]);
      const handle = sent?.key?.id ?? id;
      if (handle !== id) link.auth.rememberSent(handle);
      return { ok: true, ...(/^[0-9A-Za-z_-]{1,128}$/.test(handle) ? { handle } : {}) };
    } catch (error) {
      return { ok: false, error: sendError(error) };
    }
  }
}
