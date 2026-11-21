/**
 * Desktop ↔ API protocol for the WhatsApp linked-device connector.
 *
 * The WhatsApp session (Baileys keys) lives only on the owner's PC. Desktop
 * calls `POST /api/desktop-whatsapp/<action>` with the signed-in session cookie
 * and the native marker header, like the Desktop relay. No WhatsApp key,
 * credential or unrelated chat ever crosses this protocol: Desktop uploads
 * only the owner's own "Message yourself" chat and chats the owner allowed
 * (plus, for a dedicated number, first contact from unknown people so the
 * owner can approve them).
 */

export const WHATSAPP_LINK_MODES = ["personal", "dedicated"] as const;
export type WhatsAppLinkMode = (typeof WHATSAPP_LINK_MODES)[number];

export const WHATSAPP_SENDER_KINDS = ["contact", "group"] as const;
export type WhatsAppSenderKind = (typeof WHATSAPP_SENDER_KINDS)[number];

/** Who wrote an uploaded message, as classified by Desktop. */
export const WHATSAPP_INBOUND_KINDS = ["self", "contact", "group"] as const;
export type WhatsAppInboundKind = (typeof WHATSAPP_INBOUND_KINDS)[number];

export const WHATSAPP_MAX_TEXT = 16_000;
export const WHATSAPP_MAX_BATCH = 20;
export const WHATSAPP_MAX_GROUPS = 500;
/** Raw bytes of one inbound attachment; base64 adds about a third. */
export const WHATSAPP_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Request body cap for the route (one attachment plus JSON framing). */
export const WHATSAPP_MAX_BODY_BYTES = 12 * 1024 * 1024;
/** A message older than this when it reaches Desktop is not answered. */
export const WHATSAPP_MAX_INBOUND_AGE_SECONDS = 24 * 60 * 60;

export interface DesktopWhatsAppAllowed {
  jid: string;
  kind: WhatsAppSenderKind;
}

/** What the server tells Desktop about one linked number. */
export interface DesktopWhatsAppLinkConfig {
  linkId: string;
  botId: string;
  mode: WhatsAppLinkMode;
  accountJid: string;
  /** Contacts and groups that may reach the Mico. Pending/denied are absent. */
  allowed: DesktopWhatsAppAllowed[];
  /** Senders that already received the one-time approval code (dedicated mode). */
  pending: string[];
}

export interface DesktopWhatsAppRegister {
  desktopDeviceId: string;
  botId: string;
  mode: WhatsAppLinkMode;
  accountJid: string;
  accountLid?: string;
  phone: string;
  pushName?: string;
}

export interface DesktopWhatsAppGroup {
  jid: string;
  name: string;
}

export interface DesktopWhatsAppSyncLink {
  linkId: string;
  status: "connected" | "connecting" | "logged_out";
  groups?: DesktopWhatsAppGroup[];
}

export interface DesktopWhatsAppSync {
  desktopDeviceId: string;
  links: DesktopWhatsAppSyncLink[];
}

/** Sync response: every live link of this Desktop device. A local link absent here was removed in the web settings and must log out. */
export interface DesktopWhatsAppSyncResult {
  links: DesktopWhatsAppLinkConfig[];
}

export interface DesktopWhatsAppAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface DesktopWhatsAppInboundMessage {
  /** WhatsApp message id; with linkId it is the idempotency key. */
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  kind: WhatsAppInboundKind;
  text: string;
  /** Unix seconds, as reported by WhatsApp. */
  timestamp: number;
  groupName?: string;
  /** Group messages only: the participant id needed to react to it. */
  participant?: string;
  attachment?: DesktopWhatsAppAttachment;
}

export interface DesktopWhatsAppInbound {
  desktopDeviceId: string;
  linkId: string;
  messages: DesktopWhatsAppInboundMessage[];
}

export type DesktopWhatsAppInboundOutcome = "accepted" | "pending_approval" | "ignored";

export interface DesktopWhatsAppInboundResult {
  results: Array<{ id: string; outcome: DesktopWhatsAppInboundOutcome }>;
}

export interface DesktopWhatsAppPull {
  desktopDeviceId: string;
  wait?: boolean;
}

/** One claimed send. Desktop performs it once and reports a result; it is never replayed. */
export type DesktopWhatsAppOperation =
  | {
      id: string;
      linkId: string;
      chatJid: string;
      kind: "text";
      text: string;
      /** WhatsApp id of the message being answered, to quote it in groups. */
      quotedId?: string;
      quotedParticipant?: string;
    }
  | {
      id: string;
      linkId: string;
      chatJid: string;
      kind: "reaction";
      emoji: string;
      targetId: string;
      targetFromMe: boolean;
      targetParticipant?: string;
    };

export interface DesktopWhatsAppPullResult {
  operations: DesktopWhatsAppOperation[];
}

export interface DesktopWhatsAppResult {
  desktopDeviceId: string;
  id: string;
  ok: boolean;
  /** WhatsApp id of the sent message, so replies to it continue the conversation. */
  handle?: string;
  error?: string;
}

export interface DesktopWhatsAppUnlink {
  desktopDeviceId: string;
  linkId: string;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const JID = /^[0-9A-Za-z._:-]{1,64}@(s\.whatsapp\.net|g\.us|lid)$/;
const USER_JID = /^[0-9]{5,20}(:[0-9]{1,4})?@s\.whatsapp\.net$/;
const LID = /^[0-9]{5,30}(:[0-9]{1,4})?@lid$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const label = (value: unknown, max = 200): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

export const isWhatsAppJid = (value: unknown): value is string =>
  typeof value === "string" && JID.test(value);
export const isWhatsAppGroupJid = (value: unknown): value is string =>
  isWhatsAppJid(value) && value.endsWith("@g.us");
export const isWhatsAppUserJid = (value: unknown): value is string =>
  typeof value === "string" && USER_JID.test(value);

/** E.164 digits without "+", as WhatsApp uses them in user ids. */
export function normalizeWhatsAppPhone(value: string): string | null {
  const digits = value.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "");
  return /^[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}

/** The bare user id: drops the device suffix (`123:4@s.whatsapp.net` → `123@s.whatsapp.net`). */
export function bareWhatsAppJid(jid: string): string {
  const [user = "", server = ""] = jid.split("@");
  return `${user.split(":")[0]}@${server}`;
}

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error("Invalid WhatsApp message");
  return value as Record<string, unknown>;
}

function mode(value: unknown): WhatsAppLinkMode {
  if (value !== "personal" && value !== "dedicated") throw new Error("Invalid WhatsApp mode");
  return value;
}

export function parseDesktopWhatsAppRegister(value: unknown): DesktopWhatsAppRegister {
  const input = object(value, [
    "desktopDeviceId",
    "botId",
    "mode",
    "accountJid",
    "accountLid",
    "phone",
    "pushName",
  ]);
  if (!uuid(input.desktopDeviceId) || !id(input.botId)) throw new Error("Invalid WhatsApp link");
  if (!isWhatsAppUserJid(input.accountJid)) throw new Error("Invalid WhatsApp account");
  if (input.accountLid !== undefined && !(typeof input.accountLid === "string" && LID.test(input.accountLid)))
    throw new Error("Invalid WhatsApp account");
  const phone = typeof input.phone === "string" ? normalizeWhatsAppPhone(input.phone) : null;
  if (!phone) throw new Error("Invalid WhatsApp phone");
  const pushName = label(input.pushName, 100);
  return {
    desktopDeviceId: input.desktopDeviceId,
    botId: input.botId,
    mode: mode(input.mode),
    accountJid: bareWhatsAppJid(input.accountJid),
    ...(typeof input.accountLid === "string" ? { accountLid: bareWhatsAppJid(input.accountLid) } : {}),
    phone,
    ...(pushName ? { pushName } : {}),
  };
}

export function parseDesktopWhatsAppSync(value: unknown): DesktopWhatsAppSync {
  const input = object(value, ["desktopDeviceId", "links"]);
  if (!uuid(input.desktopDeviceId) || !Array.isArray(input.links) || input.links.length > 20)
    throw new Error("Invalid WhatsApp sync");
  return {
    desktopDeviceId: input.desktopDeviceId,
    links: input.links.map((raw) => {
      const link = object(raw, ["linkId", "status", "groups"]);
      if (!id(link.linkId)) throw new Error("Invalid WhatsApp sync");
      if (link.status !== "connected" && link.status !== "connecting" && link.status !== "logged_out")
        throw new Error("Invalid WhatsApp sync");
      let groups: DesktopWhatsAppGroup[] | undefined;
      if (link.groups !== undefined) {
        if (!Array.isArray(link.groups) || link.groups.length > WHATSAPP_MAX_GROUPS)
          throw new Error("Invalid WhatsApp groups");
        groups = link.groups.map((rawGroup) => {
          const group = object(rawGroup, ["jid", "name"]);
          if (!isWhatsAppGroupJid(group.jid)) throw new Error("Invalid WhatsApp groups");
          return { jid: group.jid, name: label(group.name, 100) || "Group" };
        });
      }
      return { linkId: link.linkId, status: link.status, ...(groups ? { groups } : {}) };
    }),
  };
}

function parseAttachment(value: unknown): DesktopWhatsAppAttachment {
  const input = object(value, ["name", "mimeType", "dataBase64"]);
  if (
    !text(input.mimeType, 128) ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mimeType) ||
    typeof input.dataBase64 !== "string" ||
    input.dataBase64.length > Math.ceil(WHATSAPP_MAX_ATTACHMENT_BYTES / 3) * 4 ||
    !BASE64.test(input.dataBase64)
  )
    throw new Error("Invalid WhatsApp attachment");
  return {
    name: label(input.name, 200) || "file",
    mimeType: input.mimeType.toLowerCase(),
    dataBase64: input.dataBase64,
  };
}

export function parseDesktopWhatsAppInbound(value: unknown): DesktopWhatsAppInbound {
  const input = object(value, ["desktopDeviceId", "linkId", "messages"]);
  if (
    !uuid(input.desktopDeviceId) ||
    !id(input.linkId) ||
    !Array.isArray(input.messages) ||
    input.messages.length === 0 ||
    input.messages.length > WHATSAPP_MAX_BATCH
  )
    throw new Error("Invalid WhatsApp inbound");
  const messages = input.messages.map((raw): DesktopWhatsAppInboundMessage => {
    const message = object(raw, [
      "id",
      "chatJid",
      "senderJid",
      "senderName",
      "kind",
      "text",
      "timestamp",
      "groupName",
      "participant",
      "attachment",
    ]);
    if (
      !text(message.id, 128) ||
      !/^[0-9A-Za-z_-]{1,128}$/.test(message.id) ||
      !isWhatsAppJid(message.chatJid) ||
      !isWhatsAppJid(message.senderJid) ||
      !text(message.text, WHATSAPP_MAX_TEXT) ||
      typeof message.timestamp !== "number" ||
      !Number.isSafeInteger(message.timestamp) ||
      message.timestamp <= 0 ||
      !(WHATSAPP_INBOUND_KINDS as readonly unknown[]).includes(message.kind)
    )
      throw new Error("Invalid WhatsApp inbound");
    const kind = message.kind as WhatsAppInboundKind;
    if ((kind === "group") !== isWhatsAppGroupJid(message.chatJid))
      throw new Error("Invalid WhatsApp inbound");
    if (message.participant !== undefined && !isWhatsAppJid(message.participant))
      throw new Error("Invalid WhatsApp inbound");
    const groupName = label(message.groupName, 100);
    return {
      id: message.id,
      chatJid: message.chatJid,
      senderJid: message.senderJid,
      senderName: label(message.senderName, 100) || "WhatsApp",
      kind,
      text: message.text,
      timestamp: message.timestamp,
      ...(kind === "group" && groupName ? { groupName } : {}),
      ...(typeof message.participant === "string" ? { participant: message.participant } : {}),
      ...(message.attachment !== undefined ? { attachment: parseAttachment(message.attachment) } : {}),
    };
  });
  if (messages.filter((message) => message.attachment).length > 1)
    throw new Error("Send one attachment per WhatsApp upload");
  return { desktopDeviceId: input.desktopDeviceId, linkId: input.linkId, messages };
}

export function parseDesktopWhatsAppPull(value: unknown): DesktopWhatsAppPull {
  const input = object(value, ["desktopDeviceId", "wait"]);
  if (!uuid(input.desktopDeviceId)) throw new Error("Invalid WhatsApp pull");
  if (input.wait !== undefined && typeof input.wait !== "boolean") throw new Error("Invalid WhatsApp pull");
  return {
    desktopDeviceId: input.desktopDeviceId,
    ...(input.wait !== undefined ? { wait: input.wait as boolean } : {}),
  };
}

export function parseDesktopWhatsAppResult(value: unknown): DesktopWhatsAppResult {
  const input = object(value, ["desktopDeviceId", "id", "ok", "handle", "error"]);
  if (!uuid(input.desktopDeviceId) || !id(input.id) || typeof input.ok !== "boolean")
    throw new Error("Invalid WhatsApp result");
  if (input.handle !== undefined && !(text(input.handle, 128) && /^[0-9A-Za-z_-]+$/.test(input.handle)))
    throw new Error("Invalid WhatsApp result");
  const error = label(input.error, 200);
  return {
    desktopDeviceId: input.desktopDeviceId,
    id: input.id,
    ok: input.ok,
    ...(typeof input.handle === "string" ? { handle: input.handle } : {}),
    ...(error ? { error } : {}),
  };
}

export function parseDesktopWhatsAppUnlink(value: unknown): DesktopWhatsAppUnlink {
  const input = object(value, ["desktopDeviceId", "linkId"]);
  if (!uuid(input.desktopDeviceId) || !id(input.linkId)) throw new Error("Invalid WhatsApp unlink");
  return { desktopDeviceId: input.desktopDeviceId, linkId: input.linkId };
}

/** Desktop side: parse server responses with the same strictness. */
export function parseDesktopWhatsAppLinkConfig(value: unknown): DesktopWhatsAppLinkConfig {
  const input = object(value, ["linkId", "botId", "mode", "accountJid", "allowed", "pending"]);
  if (!id(input.linkId) || !id(input.botId) || !isWhatsAppUserJid(input.accountJid))
    throw new Error("Invalid WhatsApp link");
  if (!Array.isArray(input.allowed) || input.allowed.length > 2_000) throw new Error("Invalid WhatsApp link");
  if (!Array.isArray(input.pending) || input.pending.length > 2_000) throw new Error("Invalid WhatsApp link");
  return {
    linkId: input.linkId,
    botId: input.botId,
    mode: mode(input.mode),
    accountJid: input.accountJid,
    allowed: input.allowed.map((raw) => {
      const entry = object(raw, ["jid", "kind"]);
      if (!isWhatsAppJid(entry.jid) || (entry.kind !== "contact" && entry.kind !== "group"))
        throw new Error("Invalid WhatsApp link");
      return { jid: entry.jid, kind: entry.kind };
    }),
    pending: input.pending.map((jid) => {
      if (!isWhatsAppJid(jid)) throw new Error("Invalid WhatsApp link");
      return jid;
    }),
  };
}

export function parseDesktopWhatsAppOperation(value: unknown): DesktopWhatsAppOperation {
  const input = object(value, [
    "id",
    "linkId",
    "chatJid",
    "kind",
    "text",
    "quotedId",
    "quotedParticipant",
    "emoji",
    "targetId",
    "targetFromMe",
    "targetParticipant",
  ]);
  if (!id(input.id) || !id(input.linkId) || !isWhatsAppJid(input.chatJid))
    throw new Error("Invalid WhatsApp operation");
  const optionalJid = (field: unknown) => {
    if (field !== undefined && !isWhatsAppJid(field)) throw new Error("Invalid WhatsApp operation");
    return field as string | undefined;
  };
  const optionalId = (field: unknown) => {
    if (field !== undefined && !(text(field, 128) && /^[0-9A-Za-z_-]+$/.test(field)))
      throw new Error("Invalid WhatsApp operation");
    return field as string | undefined;
  };
  if (input.kind === "text") {
    if (typeof input.text !== "string" || input.text.length === 0 || input.text.length > WHATSAPP_MAX_TEXT)
      throw new Error("Invalid WhatsApp operation");
    const quotedId = optionalId(input.quotedId);
    const quotedParticipant = optionalJid(input.quotedParticipant);
    return {
      id: input.id,
      linkId: input.linkId,
      chatJid: input.chatJid,
      kind: "text",
      text: input.text,
      ...(quotedId ? { quotedId } : {}),
      ...(quotedParticipant ? { quotedParticipant } : {}),
    };
  }
  if (input.kind === "reaction") {
    const targetId = optionalId(input.targetId);
    if (!targetId || typeof input.targetFromMe !== "boolean" || !text(input.emoji, 16))
      throw new Error("Invalid WhatsApp operation");
    const targetParticipant = optionalJid(input.targetParticipant);
    return {
      id: input.id,
      linkId: input.linkId,
      chatJid: input.chatJid,
      kind: "reaction",
      emoji: input.emoji,
      targetId,
      targetFromMe: input.targetFromMe,
      ...(targetParticipant ? { targetParticipant } : {}),
    };
  }
  throw new Error("Invalid WhatsApp operation");
}
