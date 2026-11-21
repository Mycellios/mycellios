import type { AnyMessageContent, MiscMessageGenerationOptions, proto } from "baileys";
import type { DesktopWhatsAppOperation } from "../../../../../contracts/desktop-whatsapp.js";
import { bareWhatsAppJid } from "../../../../../contracts/desktop-whatsapp.js";
import type { WAMessage } from "./types.js";

export interface SendPlan {
  jid: string;
  content: AnyMessageContent;
  options: MiscMessageGenerationOptions;
}

/**
 * Maps one claimed outbox operation to a Baileys send. `messageId` is chosen
 * before sending so the echo of our own message is recognised and never uploaded.
 * `recent` holds the original message when it is still in memory; otherwise the
 * quote uses a minimal stub that carries only the id and author.
 */
export function planOperation(
  operation: DesktopWhatsAppOperation,
  ownJid: string,
  messageId: string,
  recent?: (id: string) => proto.IMessage | undefined,
): SendPlan {
  const own = bareWhatsAppJid(ownJid);
  if (operation.kind === "reaction") {
    return {
      jid: operation.chatJid,
      content: {
        react: {
          text: operation.emoji,
          key: {
            remoteJid: operation.chatJid,
            id: operation.targetId,
            fromMe: operation.targetFromMe,
            ...(operation.targetParticipant ? { participant: operation.targetParticipant } : {}),
          },
        },
      },
      options: { messageId },
    };
  }
  const options: MiscMessageGenerationOptions = { messageId };
  if (operation.quotedId) {
    const fromMe = operation.quotedParticipant
      ? bareWhatsAppJid(operation.quotedParticipant) === own
      : bareWhatsAppJid(operation.chatJid) === own;
    const quoted: WAMessage = {
      key: {
        remoteJid: operation.chatJid,
        id: operation.quotedId,
        fromMe,
        ...(operation.quotedParticipant ? { participant: operation.quotedParticipant } : {}),
      },
      message: recent?.(operation.quotedId) ?? { conversation: "" },
    };
    options.quoted = quoted;
  }
  return { jid: operation.chatJid, content: { text: operation.text }, options };
}

/** A short, content-free error for the server (contract caps it at 200 characters). */
export function sendError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/timed? ?out/i.test(message)) return "WhatsApp send timed out";
  if (/not.*connected|connection closed|closed/i.test(message)) return "WhatsApp is not connected";
  return "WhatsApp send failed";
}
