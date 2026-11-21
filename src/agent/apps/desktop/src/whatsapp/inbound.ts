import type { proto } from "baileys";
import type {
  DesktopWhatsAppLinkConfig,
  WhatsAppInboundKind,
} from "../../../../../contracts/desktop-whatsapp.js";
import {
  bareWhatsAppJid,
  isWhatsAppJid,
  WHATSAPP_MAX_ATTACHMENT_BYTES,
  WHATSAPP_MAX_INBOUND_AGE_SECONDS,
  WHATSAPP_MAX_TEXT,
} from "../../../../../contracts/desktop-whatsapp.js";
import type { WAMessage } from "./types.js";

/**
 * Local privacy filter. It runs before anything is uploaded: in personal mode only
 * the owner's own "Message yourself" chat and allowed contacts/groups pass; in
 * dedicated mode unknown people pass once so the server can send an approval code.
 */
export interface InboundContext {
  /** Own phone-number jid and LID, bare. */
  self: { jid: string; lid?: string };
  config: Pick<DesktopWhatsAppLinkConfig, "mode" | "allowed" | "pending">;
  /** Ids of messages this connector sent (welcome, replies, reactions). */
  sentIds: ReadonlySet<string>;
  /** Unix seconds. */
  now: number;
  /** Phone-number jid for a LID, when WhatsApp or the local mapping knows it. */
  pnForLid?: (lid: string) => string | undefined;
}

export type MediaKind = "image" | "video" | "audio" | "document";

export interface InboundCandidate {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  kind: WhatsAppInboundKind;
  text: string;
  timestamp: number;
  /** Group messages: the participant id needed to react to or quote it. */
  participant?: string;
  media?: { kind: MediaKind; name: string; mimeType: string; size?: number };
}

const IGNORED_CONTENT = new Set<string>([
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "pollUpdateMessage",
  "keepInChatMessage",
  "encReactionMessage",
  "encEventResponseMessage",
  "pinInChatMessage",
]);
const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
] as const;

export const isGroupJid = (jid: string) => jid.endsWith("@g.us");
const isUserJid = (jid: string) => jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
const isLid = (jid: string) => jid.endsWith("@lid");

/** Unwraps ephemeral/view-once/caption wrappers, like Baileys' normalizeMessageContent. */
export function unwrapMessage(
  message: proto.IMessage | null | undefined,
): proto.IMessage | undefined {
  let current = message ?? undefined;
  for (let depth = 0; current && depth < 5; depth++) {
    const wrapper = WRAPPERS.find((name) => current?.[name]?.message);
    if (!wrapper) break;
    current = current[wrapper]!.message ?? undefined;
  }
  return current;
}

function contextInfo(message: proto.IMessage): proto.IContextInfo | undefined {
  for (const value of Object.values(message)) {
    if (value && typeof value === "object" && "contextInfo" in value && value.contextInfo)
      return value.contextInfo as proto.IContextInfo;
  }
  return undefined;
}

function extension(mimeType: string, fallback: string) {
  const sub = mimeType
    .split(";")[0]
    ?.split("/")[1]
    ?.replace(/[^a-z0-9]/gi, "")
    .slice(0, 8);
  return sub || fallback;
}

/** Text and at most one attachment description; null when nothing answerable is present. */
export function messageContent(message: proto.IMessage | undefined) {
  if (!message) return null;
  const keys = Object.keys(message).filter(
    (key) => (message as Record<string, unknown>)[key] != null,
  );
  if (keys.length > 0 && keys.every((key) => IGNORED_CONTENT.has(key))) return null;
  const size = (value: unknown) => {
    const number = Number(value?.toString?.() ?? value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };
  if (message.conversation) return { text: message.conversation };
  if (message.extendedTextMessage?.text) return { text: message.extendedTextMessage.text };
  if (message.imageMessage) {
    const mimeType = message.imageMessage.mimetype || "image/jpeg";
    return {
      text: message.imageMessage.caption ?? "",
      media: {
        kind: "image" as const,
        mimeType,
        name: `image.${extension(mimeType, "jpg")}`,
        size: size(message.imageMessage.fileLength),
      },
    };
  }
  if (message.videoMessage) {
    const mimeType = message.videoMessage.mimetype || "video/mp4";
    return {
      text: message.videoMessage.caption ?? "",
      media: {
        kind: "video" as const,
        mimeType,
        name: `video.${extension(mimeType, "mp4")}`,
        size: size(message.videoMessage.fileLength),
      },
    };
  }
  if (message.audioMessage) {
    const mimeType = (message.audioMessage.mimetype || "audio/ogg").split(";")[0]!.trim();
    const name = message.audioMessage.ptt
      ? `voice-note.${extension(mimeType, "ogg")}`
      : `audio.${extension(mimeType, "ogg")}`;
    return {
      text: "",
      media: {
        kind: "audio" as const,
        mimeType,
        name,
        size: size(message.audioMessage.fileLength),
      },
    };
  }
  if (message.documentMessage) {
    const mimeType = message.documentMessage.mimetype || "application/octet-stream";
    const name = (
      message.documentMessage.fileName ||
      message.documentMessage.title ||
      "file"
    ).slice(0, 200);
    return {
      text: message.documentMessage.caption ?? "",
      media: {
        kind: "document" as const,
        mimeType,
        name,
        size: size(message.documentMessage.fileLength),
      },
    };
  }
  return null;
}

/** Unix seconds from a Baileys timestamp (number or Long). */
export function messageSeconds(value: unknown): number {
  const number = Number(
    (value as { toString?: () => string } | null | undefined)?.toString?.() ?? value,
  );
  return Number.isFinite(number) ? Math.floor(number) : 0;
}

/** Both forms (phone-number jid and LID) under which a person may be listed. */
function identities(
  jid: string | undefined | null,
  alt: string | undefined | null,
  context: InboundContext,
) {
  const out = new Set<string>();
  for (const value of [jid, alt]) {
    if (!value || !isWhatsAppJid(value)) continue;
    const bare = bareWhatsAppJid(value);
    out.add(bare);
    if (isLid(bare)) {
      const pn = context.pnForLid?.(bare);
      if (pn && isWhatsAppJid(pn)) out.add(bareWhatsAppJid(pn));
    }
  }
  return out;
}

const preferPhone = (ids: Set<string>) =>
  [...ids].find((jid) => jid.endsWith("@s.whatsapp.net")) ?? [...ids][0];

/**
 * Decides whether one WhatsApp message may be uploaded. Returns null to drop it
 * locally. Never answers fromMe messages outside the owner's own chat.
 */
export function classifyInbound(
  message: WAMessage,
  context: InboundContext,
): InboundCandidate | null {
  const key = message.key;
  const id = key?.id;
  const remote = key?.remoteJid;
  if (!id || !/^[0-9A-Za-z_-]{1,128}$/.test(id) || !remote) return null;
  if (context.sentIds.has(id)) return null;
  if (
    remote === "status@broadcast" ||
    remote.endsWith("@broadcast") ||
    remote.endsWith("@newsletter")
  )
    return null;
  if (!isWhatsAppJid(remote)) return null;
  if (message.messageStubType) return null;
  const timestamp = messageSeconds(message.messageTimestamp);
  if (timestamp <= 0 || context.now - timestamp > WHATSAPP_MAX_INBOUND_AGE_SECONDS) return null;
  const body = unwrapMessage(message.message);
  const content = messageContent(body);
  if (!content) return null;
  const text = content.text.slice(0, WHATSAPP_MAX_TEXT);
  if (!text.trim() && !content.media) return null;
  const senderName = (message.pushName ?? "").slice(0, 100);
  const self = new Set([
    bareWhatsAppJid(context.self.jid),
    ...(context.self.lid ? [bareWhatsAppJid(context.self.lid)] : []),
  ]);
  const allowed = (kind: "contact" | "group", ids: Set<string>) =>
    context.config.allowed.some(
      (entry) => entry.kind === kind && ids.has(bareWhatsAppJid(entry.jid)),
    );
  const base = { id, text, timestamp, ...(content.media ? { media: content.media } : {}) };

  if (isGroupJid(remote)) {
    if (key.fromMe) return null;
    if (!allowed("group", new Set([remote]))) return null;
    const info = body ? contextInfo(body) : undefined;
    const mentioned = (info?.mentionedJid ?? []).some(
      (jid) => jid && self.has(bareWhatsAppJid(jid)),
    );
    const repliesToBot = !!info?.stanzaId && context.sentIds.has(info.stanzaId);
    if (!mentioned && !repliesToBot) return null;
    const participant =
      key.participant && isWhatsAppJid(key.participant) ? key.participant : undefined;
    if (!participant) return null;
    const sender = identities(participant, key.participantAlt, context);
    if ([...sender].some((jid) => self.has(jid))) return null;
    return {
      ...base,
      kind: "group",
      chatJid: remote,
      senderJid: preferPhone(sender)!,
      senderName,
      participant,
    };
  }

  if (!isUserJid(remote)) return null;
  const chat = identities(remote, key.remoteJidAlt, context);
  if ([...chat].some((jid) => self.has(jid))) {
    // "Message yourself": only the owner's own messages, never echoes of ours (filtered above).
    if (!key.fromMe) return null;
    const own = bareWhatsAppJid(context.self.jid);
    return { ...base, kind: "self", chatJid: own, senderJid: own, senderName };
  }
  if (key.fromMe) return null;
  const sender = preferPhone(chat)!;
  const candidate: InboundCandidate = {
    ...base,
    kind: "contact",
    chatJid: sender,
    senderJid: sender,
    senderName,
  };
  if (allowed("contact", chat)) return candidate;
  if (context.config.mode !== "dedicated") return null;
  if (context.config.pending.some((jid) => chat.has(bareWhatsAppJid(jid)))) return null;
  return candidate;
}

/** Attachments over the limit are replaced by a short note instead of being downloaded. */
export function attachmentTooLarge(candidate: InboundCandidate): boolean {
  return (
    candidate.media?.size !== undefined && candidate.media.size > WHATSAPP_MAX_ATTACHMENT_BYTES
  );
}

export function tooLargeNote(candidate: InboundCandidate) {
  const note = `[file: ${candidate.media?.name ?? "file"} (too large)]`;
  return candidate.text ? `${candidate.text}\n${note}` : note;
}
