import type { MessagingSurface } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { mirrorMessagingOutbound } from "./messaging-delivery.js";
import {
  mirrorWhatsAppDeviceRun,
  splitWhatsAppText,
  WHATSAPP_DEVICE_TEXT_PART,
} from "./whatsapp-device-delivery.js";

function fakePrisma(options: {
  status: string;
  clientNonce: string | null;
  kind?: "self" | "contact" | "group";
  replies?: Array<{ id: string; blocks: unknown[] }>;
}) {
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  const runUpdateMany = vi.fn(async () => ({ count: 1 }));
  const messagingIdentity = { findUnique: vi.fn(async () => null) };
  const prisma = {
    run: {
      findUnique: vi.fn(async () => ({
        id: "run-1",
        status: options.status,
        botId: "bot-1",
        trigger: "messaging",
        sourceMessageId: "message-1",
        sourceMessage: { clientNonce: options.clientNonce, blocks: [] },
      })),
      updateMany: runUpdateMany,
    },
    whatsAppInbound: {
      findFirst: vi.fn(async () => ({
        linkId: "link-1",
        waMessageId: "3EB0AAA",
        chatJid: options.kind === "group" ? "1203630@g.us" : "34600111222@s.whatsapp.net",
        participant: options.kind === "group" ? "34611222333@s.whatsapp.net" : null,
        kind: options.kind ?? "self",
      })),
    },
    message: {
      findMany: vi.fn(
        async () =>
          options.replies ?? [{ id: "reply-1", blocks: [{ kind: "text", text: "Hecho." }] }],
      ),
    },
    whatsAppOutbound: { createMany },
    messagingIdentity,
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    createMany,
    runUpdateMany,
    messagingIdentity,
  };
}

describe("whatsapp device mirror", () => {
  it("sends a WhatsApp run's replies and ✅ only to its own chat", async () => {
    const { prisma, createMany, runUpdateMany } = fakePrisma({
      status: "completed",
      clientNonce: "whatsapp-device:link-1:3EB0AAA",
      kind: "group",
    });
    expect(await mirrorWhatsAppDeviceRun(prisma, "run-1")).toBe(true);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          idempotencyKey: "wa:msg:reply-1",
          chatJid: "1203630@g.us",
          kind: "text",
          text: "Hecho.",
          quotedId: "3EB0AAA",
          quotedParticipant: "34611222333@s.whatsapp.net",
        }),
        expect.objectContaining({
          idempotencyKey: "wa:done:run-1",
          kind: "reaction",
          emoji: "✅",
          targetId: "3EB0AAA",
          targetFromMe: false,
          targetParticipant: "34611222333@s.whatsapp.net",
        }),
      ],
      skipDuplicates: true,
    });
    expect(runUpdateMany).toHaveBeenCalled();
  });

  it("reacts ❌ to a failed run without sending partial text", async () => {
    const { prisma, createMany } = fakePrisma({
      status: "failed",
      clientNonce: "whatsapp-device:link-1:3EB0AAA",
    });
    await mirrorWhatsAppDeviceRun(prisma, "run-1");
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          idempotencyKey: "wa:fail:run-1",
          emoji: "❌",
          targetFromMe: true,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("never publishes an answer-influenced reply to a third party", async () => {
    const { prisma, createMany } = fakePrisma({
      status: "completed",
      clientNonce: "whatsapp-device:link-1:3EB0AAA",
      kind: "contact",
      replies: [
        {
          id: "r",
          blocks: [
            { kind: "ask", status: "answered" },
            { kind: "text", text: "secret" },
          ],
        },
      ],
    });
    await mirrorWhatsAppDeviceRun(prisma, "run-1");
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: "reaction", emoji: "✅" })],
      skipDuplicates: true,
    });
  });

  it("keeps WhatsApp runs out of the generic messaging outbox and leaves other runs to it", async () => {
    const whatsapp = fakePrisma({
      status: "completed",
      clientNonce: "whatsapp-device:link-1:3EB0AAA",
    });
    const deps = {
      prisma: whatsapp.prisma,
      messaging: {} as MessagingSurface,
      events: { sendUserMessage: vi.fn(), notify: vi.fn() },
      jobs: { enqueue: vi.fn() },
      artifacts: { get: vi.fn() },
    };
    await mirrorMessagingOutbound(deps as never, "run-1");
    expect(whatsapp.messagingIdentity.findUnique).not.toHaveBeenCalled();
    const app = fakePrisma({ status: "completed", clientNonce: "messaging:sendblue:h1" });
    expect(await mirrorWhatsAppDeviceRun(app.prisma, "run-1")).toBe(false);
    expect(app.createMany).not.toHaveBeenCalled();
  });

  it("splits long replies at word boundaries", () => {
    const parts = splitWhatsAppText(`${"palabra ".repeat(1_000)}fin`);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= WHATSAPP_DEVICE_TEXT_PART)).toBe(true);
    expect(parts.join(" ")).toBe(`${"palabra ".repeat(1_000)}fin`);
  });
});
