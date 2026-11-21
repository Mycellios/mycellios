import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listWhatsAppLinkFiles, WhatsAppAuthFile } from "./auth-store.js";
import { runtime as realRuntime } from "./baileys-runtime.js";
import type { WhatsAppRuntime, WhatsAppSocket } from "./types.js";
import type { WhatsAppStatus } from "./whatsapp-connector.js";
import { WhatsAppConnector } from "./whatsapp-connector.js";
import { parseWhatsAppLinkRequest } from "./whatsapp-ipc.js";

const BASE = "https://agent.example.test";
const DEVICE = "6f0c6c0e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";
const OWN = "34600000001@s.whatsapp.net";
const FRIEND = "34600000002@s.whatsapp.net";
const STRANGER = "34600000003@s.whatsapp.net";

type Listener = (value: never) => void;
class FakeSocket {
  listeners = new Map<string, Listener[]>();
  user: WhatsAppSocket["user"] = undefined;
  sent: Array<{ jid: string; content: unknown; options: unknown }> = [];
  logout = vi.fn(async () => undefined);
  end = vi.fn();
  ev = {
    on: (event: string, listener: Listener) =>
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]),
    off: () => undefined,
  };
  requestPairingCode = vi.fn(async () => "ABCD1234");
  sendMessage = vi.fn(async (jid: string, content: unknown, options?: { messageId?: string }) => {
    this.sent.push({ jid, content, options });
    return { key: { id: options?.messageId, remoteJid: jid, fromMe: true } };
  });
  groupFetchAllParticipating = vi.fn(async () => ({
    "120363000000000001@g.us": { id: "120363000000000001@g.us", subject: "Family" },
  }));
  groupMetadata = vi.fn(async (jid: string) => ({ id: jid, subject: "Family" }));
  updateMediaMessage = vi.fn();
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }
}

const dirs: string[] = [];
const connectors: WhatsAppConnector[] = [];
afterEach(async () => {
  for (const connector of connectors.splice(0)) connector.dispose();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const config = (linkId: string, extra: Record<string, unknown> = {}) => ({
  linkId,
  botId: "bot-1",
  mode: "personal",
  accountJid: OWN,
  allowed: [{ jid: FRIEND, kind: "contact" }],
  pending: [],
  ...extra,
});

async function setup(options: { links?: () => unknown[] } = {}) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "wa-connector-"));
  dirs.push(userDataDir);
  const key = randomBytes(32);
  const sockets: FakeSocket[] = [];
  const runtime: WhatsAppRuntime = {
    ...realRuntime,
    makeSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WhatsAppSocket;
    },
    messageId: () => "MID" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase(),
    download: async () => Buffer.from("file"),
  };
  const calls: Array<{ action: string; body: Record<string, unknown>; space?: string }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/auth/get-session")) return Response.json({ user: { id: "user-1" } });
    const action = url.slice(`${BASE}/api/desktop-whatsapp/`.length);
    expect(init?.headers).toMatchObject({ "x-mycellios-desktop": "1" });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (action === "pull")
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    calls.push({
      action,
      body,
      space: (init?.headers as Record<string, string>)["x-rakazo-space-id"],
    });
    if (action === "register") return Response.json({ link: config("link-1") });
    if (action === "sync") return Response.json({ links: options.links?.() ?? [] });
    if (action === "inbound")
      return Response.json({
        results: (body.messages as Array<{ id: string }>).map(({ id }) => ({
          id,
          outcome: "accepted",
        })),
      });
    return Response.json({});
  });
  const statuses: WhatsAppStatus[][] = [];
  const connector = new WhatsAppConnector({
    userDataDir,
    dataKey: async () => key,
    runtime: async () => runtime,
    context: async () => ({ base: BASE, fetch }),
    deviceId: async () => DEVICE,
    space: async () => "space-2",
    emit: (status) => statuses.push(status),
    wait: async () => undefined,
    syncIntervalMs: 60_000,
  });
  connectors.push(connector);
  return { connector, sockets, calls, statuses, userDataDir, key, runtime };
}

async function linked() {
  const env = await setup();
  const { sessionKey } = await env.connector.link({
    botId: "bot-1",
    mode: "personal",
    method: "qr",
  });
  const socket = env.sockets[0]!;
  socket.emit("connection.update", { qr: "2@qr-payload" });
  await vi.waitFor(() =>
    expect(env.statuses.at(-1)).toEqual([{ sessionKey, state: "qr", qr: "2@qr-payload" }]),
  );
  socket.user = { id: "34600000001:12@s.whatsapp.net", lid: "111111111111:12@lid", name: "Dani" };
  socket.emit("connection.update", { connection: "open" });
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
  return { ...env, socket, sessionKey };
}

describe("WhatsAppConnector", () => {
  it("links with a QR, registers the number and posts the welcome into the own chat", async () => {
    const { calls, socket, statuses, sessionKey } = await linked();
    expect(calls.find((call) => call.action === "register")?.body).toEqual({
      desktopDeviceId: DEVICE,
      botId: "bot-1",
      mode: "personal",
      accountJid: OWN,
      accountLid: "111111111111@lid",
      phone: "34600000001",
      pushName: "Dani",
    });
    expect(calls.find((call) => call.action === "register")?.space).toBe("space-2");
    expect(statuses.at(-1)).toEqual([
      { sessionKey, linkId: "link-1", state: "connected", phone: "34600000001" },
    ]);
    expect(socket.sent[0]).toMatchObject({ jid: OWN, content: { text: "👋" } });
  });

  it("requests a pairing code once instead of showing the QR", async () => {
    const env = await setup();
    await env.connector.link({
      botId: "bot-1",
      mode: "dedicated",
      method: "pairing_code",
      phone: "34600000001",
    });
    const socket = env.sockets[0]!;
    socket.emit("connection.update", { qr: "q1" });
    socket.emit("connection.update", { qr: "q2" });
    await vi.waitFor(() => expect(env.statuses.at(-1)?.[0]?.state).toBe("pairing_code"));
    expect(socket.requestPairingCode).toHaveBeenCalledTimes(1);
    expect(socket.requestPairingCode).toHaveBeenCalledWith("34600000001");
    expect(env.statuses.at(-1)?.[0]).toMatchObject({
      state: "pairing_code",
      pairingCode: "ABCD1234",
    });
  });

  it("uploads the owner's chat and allowed contacts but never the bot's own echoes or strangers", async () => {
    const { socket, calls } = await linked();
    const welcomeId = (socket.sent[0]!.options as { messageId: string }).messageId;
    const now = Math.floor(Date.now() / 1000);
    socket.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { remoteJid: OWN, fromMe: true, id: welcomeId },
          message: { conversation: "👋" },
          messageTimestamp: now,
        },
        {
          key: { remoteJid: OWN, fromMe: true, id: "SELF1" },
          message: { conversation: "remind me" },
          messageTimestamp: now,
        },
        {
          key: { remoteJid: FRIEND, fromMe: false, id: "FRIEND1" },
          message: { conversation: "hi" },
          messageTimestamp: now,
          pushName: "Ana",
        },
        {
          key: { remoteJid: STRANGER, fromMe: false, id: "STRANGER1" },
          message: { conversation: "hi" },
          messageTimestamp: now,
        },
        {
          key: { remoteJid: FRIEND, fromMe: false, id: "PIC1" },
          message: { imageMessage: { mimetype: "image/jpeg", caption: "pic" } },
          messageTimestamp: now,
        },
      ],
    });
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.action === "inbound")).toHaveLength(2),
    );
    const uploads = calls
      .filter((call) => call.action === "inbound")
      .map((call) => call.body.messages as Array<Record<string, unknown>>);
    expect(uploads.map((batch) => batch.map((message) => message.id))).toEqual([
      ["SELF1", "FRIEND1"],
      ["PIC1"],
    ]);
    expect(uploads[0]![0]).toMatchObject({ kind: "self", chatJid: OWN, text: "remind me" });
    expect(uploads[1]![0]).toMatchObject({
      attachment: {
        name: "image.jpeg",
        mimeType: "image/jpeg",
        dataBase64: Buffer.from("file").toString("base64"),
      },
    });
  });

  it("performs claimed operations once and refuses chats a personal number may not write to", async () => {
    const { connector, socket } = await linked();
    const ok = await connector.perform({
      id: "op1",
      linkId: "link-1",
      chatJid: FRIEND,
      kind: "text",
      text: "Hello",
      quotedId: "FRIEND1",
    });
    expect(ok).toMatchObject({ ok: true, handle: expect.stringMatching(/^MID/) });
    expect(socket.sent.at(-1)).toMatchObject({
      jid: FRIEND,
      content: { text: "Hello" },
      options: {
        quoted: {
          key: { remoteJid: FRIEND, id: "FRIEND1", fromMe: false },
          message: { conversation: "" },
        },
      },
    });
    const reaction = await connector.perform({
      id: "op2",
      linkId: "link-1",
      chatJid: FRIEND,
      kind: "reaction",
      emoji: "✅",
      targetId: "FRIEND1",
      targetFromMe: false,
    });
    expect(reaction.ok).toBe(true);
    expect(
      await connector.perform({
        id: "op3",
        linkId: "link-1",
        chatJid: STRANGER,
        kind: "text",
        text: "x",
      }),
    ).toEqual({ ok: false, error: "Chat is not allowed" });
    expect(
      await connector.perform({
        id: "op4",
        linkId: "other",
        chatJid: FRIEND,
        kind: "text",
        text: "x",
      }),
    ).toEqual({ ok: false, error: "WhatsApp is not connected" });
    socket.sendMessage.mockRejectedValueOnce(new Error("Connection Closed"));
    expect(
      await connector.perform({
        id: "op5",
        linkId: "link-1",
        chatJid: FRIEND,
        kind: "text",
        text: "x",
      }),
    ).toEqual({ ok: false, error: "WhatsApp is not connected" });
    expect(socket.sendMessage).toHaveBeenCalledTimes(4);
  });

  it("logs out and deletes the keys of a link removed in the web settings", async () => {
    const env = await setup({ links: () => [] });
    const localId = randomUUID();
    const auth = await WhatsAppAuthFile.create(env.userDataDir, env.key, env.runtime, {
      localId,
      botId: "bot-1",
      mode: "personal",
      base: BASE,
      userId: "user-1",
      linkId: "link-gone",
      phone: "34600000001",
    });
    auth.state.creds.me = { id: "34600000001:12@s.whatsapp.net" };
    auth.state.creds.registered = true;
    await auth.save();
    await env.connector.tick();
    expect(env.calls.find((call) => call.action === "sync")?.body).toEqual({
      desktopDeviceId: DEVICE,
      links: [{ linkId: "link-gone", status: "connecting" }],
    });
    const socket = env.sockets[0]!;
    socket.user = { id: "34600000001:12@s.whatsapp.net" };
    socket.emit("connection.update", { connection: "open" });
    await vi.waitFor(async () => expect(await listWhatsAppLinkFiles(env.userDataDir)).toEqual([]));
    expect(socket.logout).toHaveBeenCalledTimes(1);
    expect(env.calls.some((call) => call.action === "register")).toBe(false);
  });

  it("restores a saved link and starts it when the server still lists it", async () => {
    const env = await setup({ links: () => [config("link-1")] });
    const localId = randomUUID();
    await WhatsAppAuthFile.create(env.userDataDir, env.key, env.runtime, {
      localId,
      botId: "bot-1",
      mode: "personal",
      base: BASE,
      userId: "user-1",
      linkId: "link-1",
      phone: "34600000001",
    });
    await env.connector.tick();
    expect(env.sockets).toHaveLength(1);
    expect(await env.connector.currentStatus()).toEqual([
      { sessionKey: localId, linkId: "link-1", state: "connecting", phone: "34600000001" },
    ]);
  });
});

describe("parseWhatsAppLinkRequest", () => {
  it("validates mode, method and phone", () => {
    expect(
      parseWhatsAppLinkRequest({
        botId: "b",
        mode: "personal",
        method: "pairing_code",
        phone: "+34 600 000 001",
      }),
    ).toEqual({ botId: "b", mode: "personal", method: "pairing_code", phone: "34600000001" });
    expect(() =>
      parseWhatsAppLinkRequest({ botId: "b", mode: "personal", method: "pairing_code" }),
    ).toThrow();
    expect(() => parseWhatsAppLinkRequest({ botId: "b", mode: "other", method: "qr" })).toThrow();
    expect(() =>
      parseWhatsAppLinkRequest({ botId: "b", mode: "personal", method: "qr", extra: 1 }),
    ).toThrow();
    expect(() =>
      parseWhatsAppLinkRequest({ botId: "x".repeat(257), mode: "personal", method: "qr" }),
    ).toThrow();
  });
});
