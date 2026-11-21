import type { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

/**
 * Replies to messages uploaded by the Desktop WhatsApp connector
 * (specs/whatsapp-linked-device). They go to the link's own outbox, which only
 * that Desktop pulls; the generic messaging outbox never sees them, and the
 * owner's in-app messages to the same Mico are never mirrored to WhatsApp.
 */
export const WHATSAPP_DEVICE_NONCE_PREFIX = "whatsapp-device:";
/** WhatsApp accepts much longer texts; smaller parts read better on a phone. */
export const WHATSAPP_DEVICE_TEXT_PART = 4_000;

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * Queues the run's replies when its source message came from the WhatsApp
 * connector. Returns false for every other run so the caller can continue with
 * the generic messaging mirror. Idempotent: every row has a stable key.
 */
export async function mirrorWhatsAppDeviceRun(
  prisma: PrismaClient,
  runId: string,
): Promise<boolean> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      sourceMessageId: true,
      sourceMessage: { select: { clientNonce: true } },
    },
  });
  if (
    !run?.sourceMessageId ||
    !run.sourceMessage?.clientNonce?.startsWith(WHATSAPP_DEVICE_NONCE_PREFIX)
  )
    return false;
  const inbound = await prisma.whatsAppInbound.findFirst({
    where: { threadMessageId: run.sourceMessageId },
  });
  const failed = run.status === "failed" || run.status === "cancelled";
  if (inbound) {
    const self = inbound.kind === "self";
    const group = inbound.kind === "group";
    const rows: Array<Record<string, unknown>> = [];
    if (!failed) {
      const replies = await prisma.message.findMany({
        where: { runId: run.id, role: "bot" },
        orderBy: { seq: "asc" },
        select: { id: true, blocks: true },
      });
      // Ask answers are entered privately in the app; never publish an answer-influenced
      // reply to a third party.
      const answered =
        !self &&
        replies.some((reply) =>
          (reply.blocks as MessageBlock[]).some(
            (block) => block.kind === "ask" && block.status === "answered",
          ),
        );
      if (!answered)
        for (const reply of replies) {
          const parts = splitWhatsAppText(extractText(reply.blocks));
          for (const [index, text] of parts.entries())
            rows.push({
              idempotencyKey:
                index === 0 ? `wa:msg:${reply.id}` : `wa:msg:${reply.id}:${index + 1}`,
              linkId: inbound.linkId,
              chatJid: inbound.chatJid,
              kind: "text",
              text,
              ...(group
                ? { quotedId: inbound.waMessageId, quotedParticipant: inbound.participant }
                : {}),
              sourceMessageId: reply.id,
            });
        }
    }
    if (TERMINAL.has(run.status)) {
      rows.push({
        idempotencyKey: failed ? `wa:fail:${run.id}` : `wa:done:${run.id}`,
        linkId: inbound.linkId,
        chatJid: inbound.chatJid,
        kind: "reaction",
        emoji: failed ? "❌" : "✅",
        targetId: inbound.waMessageId,
        targetFromMe: self,
        targetParticipant: group ? inbound.participant : null,
      });
    }
    if (rows.length > 0) {
      // Explicit createdAt keeps the parts and the final reaction in order for the pull.
      const createdAt = Date.now();
      await prisma.whatsAppOutbound.createMany({
        data: rows.map((row, index) => ({
          ...row,
          createdAt: new Date(createdAt + index),
        })) as never,
        skipDuplicates: true,
      });
    }
  }
  if (TERMINAL.has(run.status)) {
    await prisma.run.updateMany({
      where: { id: run.id, messagingMirroredAt: null },
      data: { messagingMirroredAt: new Date() },
    });
  }
  return true;
}

/** Splits at paragraph, line or word boundaries into parts of at most WHATSAPP_DEVICE_TEXT_PART. */
export function splitWhatsAppText(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > WHATSAPP_DEVICE_TEXT_PART) {
    const window = rest.slice(0, WHATSAPP_DEVICE_TEXT_PART);
    const cut = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    const end = cut > WHATSAPP_DEVICE_TEXT_PART / 2 ? cut : WHATSAPP_DEVICE_TEXT_PART;
    parts.push(rest.slice(0, end).trimEnd());
    rest = rest.slice(end).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(
      (block): block is { kind: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { kind?: unknown }).kind === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}
