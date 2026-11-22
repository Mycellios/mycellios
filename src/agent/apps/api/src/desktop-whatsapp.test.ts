import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mycellios/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountDesktopWhatsApp, WHATSAPP_CLAIM_TIMEOUT_MS } from "./desktop-whatsapp.js";

type Row = Record<string, unknown>;

/** In-memory stand-in for the few Prisma calls the connector makes. */
function memoryPrisma() {
  const tables: Record<string, Row[]> = {
    whatsAppLink: [],
    whatsAppSender: [],
    whatsAppOutbound: [],
    whatsAppInbound: [],
    thread: [{ id: "thread-1", botId: "bot-1", createdAt: new Date(0) }],
  };
  let ids = 0;
  const defaults: Record<string, Row> = {
    whatsAppOutbound: { status: "pending", targetFromMe: false, attempts: 0, providerHandle: null },
    whatsAppLink: { removedAt: null, groups: [] },
    whatsAppSender: { code: null },
    whatsAppInbound: { threadMessageId: null, runId: null },
  };
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === "linkId_jid" || key === "linkId_waMessageId")
        return matches(row, expected as Row);
      if (key === "bot" || key === "space") return true;
      if (key === "link")
        return tables.whatsAppLink!.some(
          (link) => link.id === row.linkId && matches(link, expected as Row),
        );
      const actual = row[key];
      if (expected === null) return actual === null || actual === undefined;
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        const filter = expected as Row;
        if ("in" in filter) return (filter.in as unknown[]).includes(actual);
        if ("not" in filter) return filter.not === null ? actual != null : actual !== filter.not;
        if ("lt" in filter) return actual instanceof Date && actual < (filter.lt as Date);
        return false;
      }
      return actual === expected;
    });
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as Row))
        row[key] = (row[key] as number) + ((value as Row).increment as number);
      else row[key] = value;
    }
    row.updatedAt = new Date();
    return row;
  };
  const unique = (model: string, row: Row) => {
    const keys =
      model === "whatsAppLink"
        ? [["accountJid"]]
        : model === "whatsAppSender"
          ? [["linkId", "jid"]]
          : model === "whatsAppOutbound"
            ? [["idempotencyKey"]]
            : [["linkId", "waMessageId"]];
    return tables[model]!.some((other) =>
      keys.some((fields) => fields.every((field) => other[field] === row[field])),
    );
  };
  const create = (model: string, data: Row) => {
    const row = {
      id: `${model}-${++ids}`,
      createdAt: new Date(Date.now() + ids),
      ...defaults[model],
      ...data,
    };
    if (unique(model, row)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    tables[model]!.push(row);
    return row;
  };
  const model = (name: string) => ({
    findUnique: async ({ where }: { where: Row }) =>
      tables[name]!.find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: { where: Row }) =>
      tables[name]!.find((row) => matches(row, where)) ?? null,
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) =>
      tables[name]!.filter((row) => matches(row, where))
        .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())
        .slice(0, take),
    create: async ({ data }: { data: Row }) => create(name, data),
    createMany: async ({ data }: { data: Row[] }) => {
      let count = 0;
      for (const row of data) {
        try {
          create(name, row);
          count++;
        } catch {}
      }
      return { count };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = tables[name]!.find((candidate) => matches(candidate, where));
      if (!row) throw Object.assign(new Error("Not found"), { code: "P2025" });
      return apply(row, data);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = tables[name]!.filter((row) => matches(row, where));
      for (const row of rows) apply(row, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const before = tables[name]!.length;
      tables[name] = tables[name]!.filter((row) => !matches(row, where));
      return { count: before - tables[name]!.length };
    },
  });
  const prisma = Object.fromEntries(Object.keys(tables).map((name) => [name, model(name)]));
  return { prisma: prisma as unknown as PrismaClient, tables };
}

const DEVICE = randomUUID();
const OTHER_DEVICE = randomUUID();
const ACCOUNT = "34600111222@s.whatsapp.net";
const actorFor = (userId: string) => ({
  userId,
  spaceId: "space-1",
  email: "qa@mycellios.invalid",
  isDeploymentOwner: false,
});

function fixture(options: { enabled?: boolean } = {}) {
  const { prisma, tables } = memoryPrisma();
  let clock = Date.now();
  const sent = new Map<string, { messageId: string; seq: number; taskId: null; runId: string }>();
  const sendUserMessage = vi.fn(async (input: { clientNonce?: string }) => {
    const replay = sent.get(input.clientNonce!);
    if (replay) return replay;
    const result = {
      messageId: `message-${sent.size + 1}`,
      seq: sent.size + 1,
      taskId: null,
      runId: `run-${sent.size + 1}`,
    };
    sent.set(input.clientNonce!, result);
    return result;
  });
  const enqueue = vi.fn(async () => undefined);
  const app = new Hono();
  mountDesktopWhatsApp(app, {
    enabled: options.enabled ?? true,
    prisma,
    events: { sendUserMessage: sendUserMessage as never },
    jobs: { enqueue },
    authenticate: async (request) => {
      const user = request.headers.get("x-test-user");
      return user ? { actor: actorFor(user), sessionId: `session-${user}` } : null;
    },
    ownsBot: async (actor, botId) => actor.userId === "user-1" && botId === "bot-1",
    storeAttachment: async (_owner, input) => ({
      id: "artifact-1",
      name: input.attachment.name,
      mimeType: input.attachment.mimeType,
      size: (await input.attachment.fetch()).byteLength,
    }),
    now: () => clock,
    pollIntervalMs: 5,
    longPollMs: 30,
  });
  const call = (action: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/desktop-whatsapp/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mycellios-desktop": "1",
        "x-test-user": "user-1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const register = async (mode: "personal" | "dedicated" = "personal") => {
    const response = await call("register", {
      desktopDeviceId: DEVICE,
      botId: "bot-1",
      mode,
      accountJid: "34600111222:7@s.whatsapp.net",
      accountLid: "123456789:7@lid",
      phone: "+34 600 111 222",
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { linkId: string };
  };
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: `WA${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    chatJid: "34611222333@s.whatsapp.net",
    senderJid: "34611222333@s.whatsapp.net",
    senderName: "Ana",
    kind: "contact",
    text: "hola",
    timestamp: Math.floor(clock / 1000),
    ...overrides,
  });
  const upload = (linkId: string, messages: unknown[], device = DEVICE) =>
    call("inbound", { desktopDeviceId: device, linkId, messages });
  return {
    tables,
    call,
    register,
    message,
    upload,
    sendUserMessage,
    enqueue,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("desktop whatsapp route", () => {
  it("accepts only signed-in native callers and stays off behind its flag", async () => {
    const { call } = fixture();
    expect((await call("sync", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("sync", {}, { "x-mycellios-desktop": "0" })).status).toBe(403);
    expect((await call("sync", {}, { "x-test-user": "" })).status).toBe(401);
    expect((await call("sync", { desktopDeviceId: "not-a-uuid", links: [] })).status).toBe(400);
    const off = fixture({ enabled: false });
    expect((await off.call("sync", { desktopDeviceId: DEVICE, links: [] })).status).toBe(404);
  });

  it("registers one number per account and reuses the row when the owner links again", async () => {
    const { call, register, tables } = fixture();
    const first = await register();
    expect(first).toMatchObject({
      botId: "bot-1",
      mode: "personal",
      accountJid: ACCOUNT,
      allowed: [],
      pending: [],
    });
    const again = await register("dedicated");
    expect(again.linkId).toBe(first.linkId);
    expect(tables.whatsAppLink).toHaveLength(1);
    const foreign = await call(
      "register",
      {
        desktopDeviceId: DEVICE,
        botId: "bot-1",
        mode: "personal",
        accountJid: ACCOUNT,
        phone: "34600111222",
      },
      { "x-test-user": "user-2" },
    );
    expect(foreign.status).toBe(404); // user-2 does not own bot-1
  });

  it("refuses a number that another account linked", async () => {
    const { call, register, tables } = fixture();
    await register();
    tables.whatsAppLink[0]!.userId = "user-2";
    const response = await call("register", {
      desktopDeviceId: DEVICE,
      botId: "bot-1",
      mode: "personal",
      accountJid: ACCOUNT,
      phone: "34600111222",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This WhatsApp number is linked to another account",
    });
  });

  it("binds every link to the Desktop that registered it", async () => {
    const { register, upload, message, sendUserMessage, call } = fixture();
    const { linkId } = await register();
    expect(
      (
        await upload(
          linkId,
          [message({ kind: "self", chatJid: ACCOUNT, senderJid: ACCOUNT })],
          OTHER_DEVICE,
        )
      ).status,
    ).toBe(404);
    const sync = await call("sync", {
      desktopDeviceId: OTHER_DEVICE,
      links: [{ linkId, status: "connected" }],
    });
    expect(await sync.json()).toEqual({ links: [] });
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("ignores unknown contacts of a personal number without storing anything", async () => {
    const { register, upload, message, tables, sendUserMessage } = fixture();
    const { linkId } = await register("personal");
    const item = message();
    const response = await upload(linkId, [item]);
    expect(await response.json()).toEqual({ results: [{ id: item.id, outcome: "ignored" }] });
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(tables.whatsAppSender).toHaveLength(0);
    expect(tables.whatsAppOutbound).toHaveLength(0);
    expect(tables.whatsAppInbound).toHaveLength(0);
  });

  it("sends one approval code to an unknown contact of a dedicated number", async () => {
    const { register, upload, message, tables, sendUserMessage, call } = fixture();
    const { linkId } = await register("dedicated");
    for (const item of [message(), message({ text: "otra vez" })])
      expect(await (await upload(linkId, [item])).json()).toEqual({
        results: [{ id: item.id, outcome: "pending_approval" }],
      });
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(tables.whatsAppSender).toHaveLength(1);
    const sender = tables.whatsAppSender[0]!;
    expect(sender).toMatchObject({
      status: "pending",
      jid: "34611222333@s.whatsapp.net",
      label: "34611222333",
    });
    expect(sender.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(tables.whatsAppOutbound).toHaveLength(1);
    expect(tables.whatsAppOutbound[0]!.text).toBe(
      `This number answers for a Mycellios agent. To talk to it, ask its owner to approve the code ${sender.code} in Mycellios.`,
    );
    const sync = await (await call("sync", { desktopDeviceId: DEVICE, links: [] })).json();
    expect(sync.links[0].pending).toEqual(["34611222333@s.whatsapp.net"]);
    sender.status = "denied";
    expect(await (await upload(linkId, [message()])).json()).toMatchObject({
      results: [{ outcome: "ignored" }],
    });
  });

  it("delivers an allowed contact as a third-party channel message", async () => {
    const { register, upload, message, tables, sendUserMessage, enqueue } = fixture();
    const { linkId } = await register();
    tables.whatsAppSender.push({
      id: "sender-1",
      linkId,
      kind: "contact",
      jid: "34611222333@s.whatsapp.net",
      label: "34611222333",
      status: "allowed",
      code: null,
      createdAt: new Date(),
    });
    const item = message();
    expect(await (await upload(linkId, [item])).json()).toEqual({
      results: [{ id: item.id, outcome: "accepted" }],
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "messaging",
        userId: "user-1",
        botId: "bot-1",
        threadId: "thread-1",
        clientNonce: `whatsapp-device:${linkId}:${item.id}`,
        blocks: [
          expect.objectContaining({
            kind: "channel_message",
            provider: "whatsapp_device",
            channelId: "sender-1",
            fromLabel: "Ana",
            text: "hola",
          }),
        ],
        prompt: expect.stringContaining("Ana (+34611222333)"),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "run.continue" }));
    expect(tables.whatsAppInbound[0]).toMatchObject({
      threadMessageId: "message-1",
      runId: "run-1",
      kind: "contact",
    });
    expect(tables.whatsAppOutbound).toEqual([
      expect.objectContaining({
        kind: "reaction",
        emoji: "👀",
        targetId: item.id,
        targetFromMe: false,
      }),
    ]);
  });

  it("treats Message yourself as the owner and accepts a re-upload once", async () => {
    const { register, upload, message, tables, sendUserMessage } = fixture();
    const { linkId } = await register();
    const item = message({
      kind: "self",
      chatJid: "123456789@lid",
      senderJid: "34600111222:7@s.whatsapp.net",
      text: " resume mi día ",
      attachment: {
        name: "nota.txt",
        mimeType: "text/plain",
        dataBase64: Buffer.from("hola").toString("base64"),
      },
    });
    expect(await (await upload(linkId, [item])).json()).toEqual({
      results: [{ id: item.id, outcome: "accepted" }],
    });
    expect(await (await upload(linkId, [item])).json()).toEqual({
      results: [{ id: item.id, outcome: "accepted" }],
    });
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "messaging",
        blocks: [
          { kind: "text", text: "resume mi día" },
          expect.objectContaining({ artifactId: "artifact-1" }),
        ],
      }),
    );
    expect(tables.whatsAppOutbound).toEqual([
      expect.objectContaining({ kind: "reaction", targetFromMe: true, chatJid: "123456789@lid" }),
    ]);
    // A self message whose sender is not the linked account is not the owner.
    const spoof = message({
      kind: "self",
      chatJid: ACCOUNT,
      senderJid: "34611222333@s.whatsapp.net",
    });
    expect(await (await upload(linkId, [spoof])).json()).toMatchObject({
      results: [{ outcome: "ignored" }],
    });
  });

  it("ignores stale messages and groups that were not allowed", async () => {
    const { register, upload, message, advance, sendUserMessage } = fixture();
    const { linkId } = await register();
    const old = message({ kind: "self", chatJid: ACCOUNT, senderJid: ACCOUNT });
    advance(25 * 60 * 60 * 1000);
    const group = message({
      kind: "group",
      chatJid: "120363000000000000@g.us",
      participant: "34611222333@s.whatsapp.net",
    });
    expect(await (await upload(linkId, [old, group])).json()).toEqual({
      results: [
        { id: old.id, outcome: "ignored" },
        { id: group.id, outcome: "ignored" },
      ],
    });
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("claims each send once, records results and fails uncertain claims without replaying", async () => {
    const { register, upload, message, call, tables, advance } = fixture();
    const { linkId } = await register();
    const item = message({ kind: "self", chatJid: ACCOUNT, senderJid: ACCOUNT });
    await upload(linkId, [item]);
    tables.whatsAppOutbound.push({
      id: "out-2",
      linkId,
      idempotencyKey: "other-chat",
      chatJid: "34611222333@s.whatsapp.net",
      kind: "text",
      text: "hola",
      status: "pending",
      targetFromMe: false,
      attempts: 0,
      createdAt: new Date(Date.now() + 1_000_000),
    });
    const pulled = await (await call("pull", { desktopDeviceId: DEVICE })).json();
    expect(pulled.operations).toEqual([
      expect.objectContaining({
        kind: "reaction",
        emoji: "👀",
        targetId: item.id,
        targetFromMe: true,
        linkId,
      }),
      { id: "out-2", linkId, chatJid: "34611222333@s.whatsapp.net", kind: "text", text: "hola" },
    ]);
    expect(await (await call("pull", { desktopDeviceId: DEVICE, wait: true })).json()).toEqual({
      operations: [],
    });
    expect((await call("pull", { desktopDeviceId: OTHER_DEVICE })).status).toBe(200);
    const [reaction] = pulled.operations;
    expect(
      (await call("result", { desktopDeviceId: OTHER_DEVICE, id: reaction.id, ok: true })).status,
    ).toBe(409);
    expect(
      (
        await call("result", {
          desktopDeviceId: DEVICE,
          id: reaction.id,
          ok: true,
          handle: "ABC123",
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("result", { desktopDeviceId: DEVICE, id: reaction.id, ok: true })).status,
    ).toBe(409);
    expect(tables.whatsAppOutbound.find((row) => row.id === reaction.id)).toMatchObject({
      status: "sent",
      providerHandle: "ABC123",
    });
    advance(WHATSAPP_CLAIM_TIMEOUT_MS + 1_000);
    expect(await (await call("pull", { desktopDeviceId: DEVICE })).json()).toEqual({
      operations: [],
    });
    expect(tables.whatsAppOutbound.find((row) => row.id === "out-2")).toMatchObject({
      status: "failed",
      error: "uncertain",
    });
  });

  it("drops links removed in settings from the Desktop sync and marks unlink as logged out", async () => {
    const { register, call, tables } = fixture();
    const { linkId } = await register();
    expect((await call("unlink", { desktopDeviceId: DEVICE, linkId })).status).toBe(200);
    expect(tables.whatsAppLink[0]).toMatchObject({ status: "logged_out", removedAt: null });
    tables.whatsAppLink[0]!.removedAt = new Date();
    expect(
      await (
        await call("sync", { desktopDeviceId: DEVICE, links: [{ linkId, status: "connected" }] })
      ).json(),
    ).toEqual({ links: [] });
  });
});
