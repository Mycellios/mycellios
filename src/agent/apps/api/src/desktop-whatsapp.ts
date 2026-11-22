import { randomInt } from "node:crypto";
import type { JobPublisher, MessagingInboundAttachment } from "@mycellios/adapter-kit";
import { runContinueJob } from "@mycellios/adapter-kit";
import { WHATSAPP_DEVICE_NONCE_PREFIX } from "@mycellios/adapters";
import type { Actor, MessageBlock } from "@mycellios/contracts";
import {
  messageBlockForArtifact,
  promptTextForAttachments,
  sanitizeMessagingLabel,
} from "@mycellios/core";
import type { PrismaClient, ThreadEvents } from "@mycellios/db";
import { runAsSystem, runAsTenant } from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import type { Hono } from "hono";
import {
  bareWhatsAppJid,
  type DesktopWhatsAppInboundMessage,
  type DesktopWhatsAppInboundOutcome,
  type DesktopWhatsAppLinkConfig,
  type DesktopWhatsAppOperation,
  isWhatsAppGroupJid,
  parseDesktopWhatsAppInbound,
  parseDesktopWhatsAppPull,
  parseDesktopWhatsAppRegister,
  parseDesktopWhatsAppResult,
  parseDesktopWhatsAppSync,
  parseDesktopWhatsAppUnlink,
  WHATSAPP_MAX_ATTACHMENT_BYTES,
  WHATSAPP_MAX_BATCH,
  WHATSAPP_MAX_BODY_BYTES,
  WHATSAPP_MAX_INBOUND_AGE_SECONDS,
} from "../../../../contracts/desktop-whatsapp.js";
import { readBoundedBody } from "./http-body.js";
import { isUniqueViolation } from "./routes/shared.js";

/** Provider name in channel_message blocks of contacts and groups. */
export const WHATSAPP_DEVICE_PROVIDER = "whatsapp_device";
/** A claim without a result after this long is reported failed, never replayed. */
export const WHATSAPP_CLAIM_TIMEOUT_MS = 2 * 60_000;
const LONG_POLL_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Six characters without look-alikes (no I, O, 0 or 1). */
export function whatsAppApprovalCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export interface DesktopWhatsAppDeps {
  enabled: boolean;
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "sendUserMessage">;
  jobs: Pick<JobPublisher, "enqueue">;
  authenticate(request: Request): Promise<{ actor: Actor; sessionId: string } | null>;
  ownsBot(actor: Pick<Actor, "userId" | "spaceId">, botId: string): Promise<boolean>;
  storeAttachment?: (
    owner: { spaceId: string; userId: string },
    input: { botId: string; attachment: MessagingInboundAttachment; clientNonce: string },
  ) => Promise<{ id: string; name: string; mimeType: string; size: number }>;
  now?: () => number;
  pollIntervalMs?: number;
  longPollMs?: number;
}

type LinkRow = {
  id: string;
  userId: string;
  spaceId: string;
  botId: string;
  mode: string;
  accountJid: string;
  accountLid: string | null;
};

class RouteError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Links this Desktop may still act on: its own, not removed, Mico and Space membership intact. */
function liveLinks(userId: string, desktopDeviceId: string) {
  return {
    userId,
    desktopDeviceId,
    removedAt: null,
    bot: { userId, archivedAt: null },
    space: { memberships: { some: { userId } } },
  };
}

/**
 * `POST /api/desktop-whatsapp/<action>`: the WhatsApp linked-device connector of
 * Mycellios Desktop (specs/whatsapp-linked-device). Same native-only rules as the
 * Desktop relay: no Origin, the native marker and a fresh session on every call.
 * Every link is bound to the Desktop device that registered it.
 */
export function mountDesktopWhatsApp(app: Hono, deps: DesktopWhatsAppDeps) {
  const db = deps.prisma;
  const now = () => deps.now?.() ?? Date.now();
  const system = <T>(fn: () => Promise<T>) =>
    runAsSystem("whatsapp linked device acting for its signed-in owner", fn);

  const configs = async (links: LinkRow[]): Promise<DesktopWhatsAppLinkConfig[]> => {
    if (links.length === 0) return [];
    const senders = await db.whatsAppSender.findMany({
      where: {
        linkId: { in: links.map((link) => link.id) },
        status: { in: ["allowed", "pending"] },
      },
      orderBy: { createdAt: "asc" },
    });
    return links.map((link) => {
      const own = senders.filter((sender) => sender.linkId === link.id);
      return {
        linkId: link.id,
        botId: link.botId,
        mode: link.mode === "dedicated" ? "dedicated" : "personal",
        accountJid: link.accountJid,
        allowed: own
          .filter((sender) => sender.status === "allowed")
          .map((sender) => ({
            jid: sender.jid,
            kind: sender.kind === "group" ? "group" : "contact",
          })),
        pending: own.filter((sender) => sender.status === "pending").map((sender) => sender.jid),
      };
    });
  };

  const queue = (rows: Array<Record<string, unknown>>) =>
    db.whatsAppOutbound.createMany({ data: rows as never, skipDuplicates: true });

  const seen = (link: LinkRow, message: DesktopWhatsAppInboundMessage) => ({
    idempotencyKey: `wa:seen:${link.id}:${message.id}`,
    linkId: link.id,
    chatJid: message.chatJid,
    kind: "reaction",
    emoji: "👀",
    targetId: message.id,
    targetFromMe: message.kind === "self",
    targetParticipant: message.kind === "group" ? (message.participant ?? message.senderJid) : null,
  });

  async function accept(
    link: LinkRow,
    message: DesktopWhatsAppInboundMessage,
    build: (artifacts: Array<{ id: string; name: string; mimeType: string; size: number }>) => {
      blocks: MessageBlock[];
      prompt: string;
    },
  ): Promise<DesktopWhatsAppInboundOutcome> {
    const owner = { spaceId: link.spaceId, userId: link.userId };
    const where = { linkId_waMessageId: { linkId: link.id, waMessageId: message.id } };
    const existing = await db.whatsAppInbound.findUnique({ where });
    if (existing?.threadMessageId) return "accepted";
    const thread = await db.thread.findFirst({
      where: { botId: link.botId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!thread) throw new RouteError(404, "This Mico has no conversation");
    if (!existing)
      await db.whatsAppInbound
        .create({
          data: {
            linkId: link.id,
            waMessageId: message.id,
            chatJid: message.chatJid,
            senderJid: message.senderJid,
            participant:
              message.kind === "group" ? (message.participant ?? message.senderJid) : null,
            kind: message.kind,
          },
        })
        .catch(async (error) => {
          // A concurrent upload of the same message won the unique key.
          if (!(await db.whatsAppInbound.findUnique({ where }))) throw error;
        });
    const nonce = `${WHATSAPP_DEVICE_NONCE_PREFIX}${link.id}:${message.id}`;
    const artifacts: Array<{ id: string; name: string; mimeType: string; size: number }> = [];
    const unavailable: string[] = [];
    if (message.attachment) {
      const attachment = message.attachment;
      const bytes = Buffer.from(attachment.dataBase64, "base64");
      if (
        !deps.storeAttachment ||
        bytes.byteLength === 0 ||
        bytes.byteLength > WHATSAPP_MAX_ATTACHMENT_BYTES
      )
        unavailable.push(`[file: ${sanitizeMessagingLabel(attachment.name)} (unavailable)]`);
      else
        try {
          artifacts.push(
            await runAsTenant(owner, () =>
              deps.storeAttachment!(owner, {
                botId: link.botId,
                attachment: {
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  size: bytes.byteLength,
                  fetch: async () => new Uint8Array(bytes),
                },
                clientNonce: `${nonce}:attachment`,
              }),
            ),
          );
        } catch (error) {
          getLogger().warn("whatsapp attachment was not stored", {
            reason: error instanceof Error ? error.message : String(error),
          });
          unavailable.push(`[file: ${sanitizeMessagingLabel(attachment.name)} (unavailable)]`);
        }
    }
    const { blocks, prompt } = build(artifacts);
    const note = unavailable.join("\n");
    const sent = await runAsTenant(owner, () =>
      deps.events.sendUserMessage({
        ...owner,
        threadId: thread.id,
        botId: link.botId,
        blocks: note ? [...blocks, { kind: "text", text: note }] : blocks,
        prompt: note ? `${prompt}\n${note}` : prompt,
        trigger: "messaging",
        clientNonce: nonce,
      }),
    );
    await db.whatsAppInbound.update({
      where,
      data: { threadMessageId: sent.messageId, runId: sent.runId },
    });
    await queue([seen(link, message)]);
    if (sent.runId)
      await deps.jobs.enqueue(runContinueJob(sent.runId)).catch((error) => {
        getLogger().error("whatsapp inbound run enqueue error", error);
      });
    return "accepted";
  }

  async function inbound(
    link: LinkRow,
    message: DesktopWhatsAppInboundMessage,
  ): Promise<DesktopWhatsAppInboundOutcome> {
    if (message.timestamp < now() / 1000 - WHATSAPP_MAX_INBOUND_AGE_SECONDS) return "ignored";
    if (!message.text.trim() && !message.attachment) return "ignored";
    const own = new Set([link.accountJid, link.accountLid].filter(Boolean));
    const chat = bareWhatsAppJid(message.chatJid);
    const sender = bareWhatsAppJid(message.senderJid);
    if (message.kind === "self") {
      if (!own.has(chat) || !own.has(sender)) return "ignored";
      // A reply Desktop sent into "Message yourself" is not new owner input.
      const echo = await db.whatsAppOutbound.findFirst({
        where: { linkId: link.id, providerHandle: message.id },
        select: { id: true },
      });
      if (echo) return "ignored";
      return accept(link, message, (artifacts) => {
        const text = message.text.trim();
        return {
          blocks: [
            ...(text ? [{ kind: "text" as const, text }] : []),
            ...artifacts.map((artifact) => messageBlockForArtifact(artifact)),
          ],
          prompt: promptTextForAttachments(text, artifacts),
        };
      });
    }
    if (message.kind === "contact" && (isWhatsAppGroupJid(chat) || own.has(chat))) return "ignored";
    const known = await db.whatsAppSender.findUnique({
      where: { linkId_jid: { linkId: link.id, jid: chat } },
    });
    if (message.kind === "group") {
      if (known?.kind !== "group" || known.status !== "allowed") return "ignored";
    } else if (known?.status !== "allowed") {
      if (link.mode !== "dedicated" || known?.status === "denied" || known?.kind === "group")
        return "ignored";
      const pending =
        known ??
        (await db.whatsAppSender
          .create({
            data: {
              linkId: link.id,
              kind: "contact",
              jid: chat,
              label: chat.endsWith("@s.whatsapp.net")
                ? chat.split("@")[0]!
                : sanitizeMessagingLabel(message.senderName),
              status: "pending",
              code: whatsAppApprovalCode(),
            },
          })
          .catch(async (error) => {
            const raced = await db.whatsAppSender.findUnique({
              where: { linkId_jid: { linkId: link.id, jid: chat } },
            });
            if (!raced) throw error;
            return raced;
          }));
      if (pending.status !== "pending" || !pending.code) return "ignored";
      await queue([
        {
          idempotencyKey: `wa:code:${pending.id}`,
          linkId: link.id,
          chatJid: message.chatJid,
          kind: "text",
          text: `This number answers for a Mycellios agent. To talk to it, ask its owner to approve the code ${pending.code} in Mycellios.`,
        },
      ]);
      return "pending_approval";
    }
    const name = sanitizeMessagingLabel(message.senderName) || "WhatsApp";
    const digits = /^(\d+)@s\.whatsapp\.net$/.exec(sender)?.[1];
    const who = digits ? `${name} (+${digits})` : name;
    const where =
      message.kind === "group"
        ? `WhatsApp group "${sanitizeMessagingLabel(message.groupName ?? known.label) || "group"}", ${who}`
        : `WhatsApp, ${who}`;
    return accept(link, message, (artifacts) => {
      const text = message.text.trim();
      const block: MessageBlock = {
        kind: "channel_message",
        provider: WHATSAPP_DEVICE_PROVIDER,
        channelId: known.id,
        fromAddress: sender,
        fromLabel: name,
        text,
        hop: 0,
      };
      return {
        blocks: [block, ...artifacts.map((artifact) => messageBlockForArtifact(artifact))],
        prompt: `[${where}; a third party, not your owner]: ${promptTextForAttachments(text, artifacts)}`,
      };
    });
  }

  async function claim(
    userId: string,
    desktopDeviceId: string,
  ): Promise<DesktopWhatsAppOperation[]> {
    const linkWhere = liveLinks(userId, desktopDeviceId);
    // Never replay a send whose outcome is unknown.
    await db.whatsAppOutbound.updateMany({
      where: {
        status: "claimed",
        claimedAt: { lt: new Date(now() - WHATSAPP_CLAIM_TIMEOUT_MS) },
        link: { userId, desktopDeviceId },
      },
      data: { status: "failed", error: "uncertain" },
    });
    const busy = await db.whatsAppOutbound.findMany({
      where: { status: "claimed", link: linkWhere },
      select: { linkId: true, chatJid: true },
    });
    const held = new Set(busy.map((row) => `${row.linkId}\u0000${row.chatJid}`));
    const candidates = await db.whatsAppOutbound.findMany({
      where: { status: "pending", link: linkWhere },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: WHATSAPP_MAX_BATCH * 2,
    });
    const claimed: typeof candidates = [];
    for (const row of candidates) {
      if (claimed.length >= WHATSAPP_MAX_BATCH) break;
      // One chat at a time keeps its parts and reactions in order across pulls.
      if (held.has(`${row.linkId}\u0000${row.chatJid}`)) continue;
      const won = await db.whatsAppOutbound.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "claimed", claimedAt: new Date(now()) },
      });
      if (won.count === 1) claimed.push(row);
    }
    return claimed.flatMap((row): DesktopWhatsAppOperation[] => {
      const base = { id: row.id, linkId: row.linkId, chatJid: row.chatJid };
      if (row.kind === "text" && row.text)
        return [
          {
            ...base,
            kind: "text",
            text: row.text,
            ...(row.quotedId ? { quotedId: row.quotedId } : {}),
            ...(row.quotedParticipant ? { quotedParticipant: row.quotedParticipant } : {}),
          },
        ];
      if (row.kind === "reaction" && row.emoji && row.targetId)
        return [
          {
            ...base,
            kind: "reaction",
            emoji: row.emoji,
            targetId: row.targetId,
            targetFromMe: row.targetFromMe,
            ...(row.targetParticipant ? { targetParticipant: row.targetParticipant } : {}),
          },
        ];
      return [];
    });
  }

  app.post("/api/desktop-whatsapp/:action", async (c) => {
    c.header("cache-control", "no-store");
    if (!deps.enabled) return c.json({ error: "Unavailable" }, 404);
    // Native main is the only caller. Do not permit form/CSRF requests from web origins.
    if (c.req.header("origin") || c.req.header("x-mycellios-desktop") !== "1")
      return c.json({ error: "Native client required" }, 403);
    const session = await deps.authenticate(c.req.raw);
    if (!session) return c.json({ error: "Sign in again" }, 401);
    const { actor } = session;
    const body = await readBoundedBody(c.req.raw, WHATSAPP_MAX_BODY_BYTES);
    if (body === null) return c.json({ error: "Too large" }, 413);
    const action = c.req.param("action");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
    try {
      switch (action) {
        case "register": {
          const value = parse(() => parseDesktopWhatsAppRegister(input));
          if (!(await deps.ownsBot(actor, value.botId)))
            return c.json({ error: "Unavailable agent" }, 404);
          const link = await system(async () => {
            const existing = await db.whatsAppLink.findUnique({
              where: { accountJid: value.accountJid },
            });
            if (existing && existing.userId !== actor.userId) {
              if (!existing.removedAt)
                throw new RouteError(409, "This WhatsApp number is linked to another account");
              // A link its previous owner removed: its senders and history are theirs, not ours.
              await db.whatsAppLink.deleteMany({
                where: { id: existing.id, removedAt: { not: null } },
              });
            }
            const data = {
              spaceId: actor.spaceId,
              botId: value.botId,
              desktopDeviceId: value.desktopDeviceId,
              mode: value.mode,
              accountLid: value.accountLid ?? null,
              phone: value.phone,
              pushName: value.pushName ?? null,
              status: "connected",
              removedAt: null,
              lastSeenAt: new Date(now()),
            };
            // Re-linking the same number keeps its senders and conversations.
            if (existing && existing.userId === actor.userId)
              return db.whatsAppLink.update({ where: { id: existing.id }, data });
            return db.whatsAppLink
              .create({ data: { ...data, userId: actor.userId, accountJid: value.accountJid } })
              .catch((error) => {
                if (!isUniqueViolation(error)) throw error;
                throw new RouteError(409, "This WhatsApp number is linked to another account");
              });
          });
          const [config] = await system(() => configs([link]));
          return c.json(config);
        }
        case "sync": {
          const value = parse(() => parseDesktopWhatsAppSync(input));
          const links = await system(async () => {
            for (const reported of value.links)
              await db.whatsAppLink.updateMany({
                where: { id: reported.linkId, ...liveLinks(actor.userId, value.desktopDeviceId) },
                data: {
                  status: reported.status,
                  lastSeenAt: new Date(now()),
                  ...(reported.groups
                    ? { groups: reported.groups.map(({ jid, name }) => ({ jid, name })) }
                    : {}),
                },
              });
            return configs(
              await db.whatsAppLink.findMany({
                where: liveLinks(actor.userId, value.desktopDeviceId),
                orderBy: { createdAt: "asc" },
              }),
            );
          });
          return c.json({ links });
        }
        case "inbound": {
          const value = parse(() => parseDesktopWhatsAppInbound(input));
          const results = await system(async () => {
            const link = await db.whatsAppLink.findFirst({
              where: { id: value.linkId, ...liveLinks(actor.userId, value.desktopDeviceId) },
            });
            if (!link) throw new RouteError(404, "Unavailable link");
            const out: Array<{ id: string; outcome: DesktopWhatsAppInboundOutcome }> = [];
            for (const message of value.messages)
              out.push({ id: message.id, outcome: await inbound(link, message) });
            return out;
          });
          return c.json({ results });
        }
        case "pull": {
          const value = parse(() => parseDesktopWhatsAppPull(input));
          const deadline = Date.now() + (value.wait ? (deps.longPollMs ?? LONG_POLL_MS) : 0);
          for (;;) {
            const operations = await system(() => claim(actor.userId, value.desktopDeviceId));
            if (operations.length > 0 || Date.now() >= deadline || c.req.raw.signal.aborted)
              return c.json({ operations });
            await sleep(deps.pollIntervalMs ?? POLL_INTERVAL_MS, c.req.raw.signal);
            if (c.req.raw.signal.aborted) return c.json({ operations: [] });
            // A long poll claims only for a session that is still signed in.
            const current = await deps.authenticate(c.req.raw);
            if (current?.actor.userId !== actor.userId)
              return c.json({ error: "Sign in again" }, 401);
          }
        }
        case "result": {
          const value = parse(() => parseDesktopWhatsAppResult(input));
          const updated = await system(() =>
            db.whatsAppOutbound.updateMany({
              where: {
                id: value.id,
                status: "claimed",
                link: { userId: actor.userId, desktopDeviceId: value.desktopDeviceId },
              },
              data: value.ok
                ? { status: "sent", providerHandle: value.handle ?? null, error: null }
                : {
                    status: "failed",
                    error: value.error ?? "failed",
                    attempts: { increment: 1 },
                  },
            }),
          );
          if (updated.count !== 1) return c.json({ error: "Operation unavailable" }, 409);
          return c.json({ ok: true });
        }
        case "unlink": {
          const value = parse(() => parseDesktopWhatsAppUnlink(input));
          const updated = await system(() =>
            db.whatsAppLink.updateMany({
              where: {
                id: value.linkId,
                userId: actor.userId,
                desktopDeviceId: value.desktopDeviceId,
              },
              data: { status: "logged_out" },
            }),
          );
          if (updated.count !== 1) return c.json({ error: "Unavailable link" }, 404);
          return c.json({ ok: true });
        }
        default:
          return c.json({ error: "Unavailable" }, 404);
      }
    } catch (error) {
      if (error instanceof RouteError) return c.json({ error: error.message }, error.status);
      getLogger().error("desktop.whatsapp.request_failed", error, { "desktop.action": action });
      return c.json({ error: "WhatsApp request failed. Try again." }, 409);
    }
  });
}

function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new RouteError(400, "Invalid request");
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
