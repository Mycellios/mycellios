import { ORPCError } from "@orpc/server";
import type { WhatsAppLink, WhatsAppSender } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import {
  isWhatsAppGroupJid,
  normalizeWhatsAppPhone,
} from "../../../../../contracts/desktop-whatsapp.js";
import type { RouterContext } from "./context.js";

type SenderRow = {
  id: string;
  kind: string;
  jid: string;
  label: string;
  status: string;
  code: string | null;
  createdAt: Date;
};

/**
 * Settings for WhatsApp numbers linked through Mycellios Desktop
 * (specs/whatsapp-linked-device). Linking itself happens only on the PC that
 * holds the session; these procedures choose the Mico and who may write.
 */
export function whatsappRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma = deps.prisma;
  const owned = (actor: { userId: string; spaceId: string }) => ({
    userId: actor.userId,
    spaceId: actor.spaceId,
    removedAt: null,
  });
  const link = async (actor: { userId: string; spaceId: string }, linkId: string) => {
    const found = await prisma.whatsAppLink.findFirst({ where: { id: linkId, ...owned(actor) } });
    if (!found) throw new ORPCError("NOT_FOUND");
    return found;
  };
  const ownedBot = async (actor: { userId: string; spaceId: string }, botId: string) => {
    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId: actor.userId, spaceId: actor.spaceId, archivedAt: null },
      select: { id: true },
    });
    if (!bot) throw new ORPCError("NOT_FOUND");
  };
  return {
    whatsapp: {
      links: {
        list: authed.whatsapp.links.list.handler(async ({ context }) =>
          linkDtos(
            prisma,
            await prisma.whatsAppLink.findMany({
              where: owned(context.actor),
              orderBy: { createdAt: "asc" },
              select: { id: true },
            }),
          ),
        ),
        setBot: authed.whatsapp.links.setBot.handler(async ({ context, input }) => {
          const found = await link(context.actor, input.linkId);
          await ownedBot(context.actor, input.botId);
          await prisma.whatsAppLink.update({
            where: { id: found.id },
            data: { botId: input.botId },
          });
          const [dto] = await linkDtos(prisma, [found]);
          if (!dto) throw new ORPCError("NOT_FOUND");
          return dto;
        }),
        remove: authed.whatsapp.links.remove.handler(async ({ context, input }) => {
          // The Desktop that holds the session logs out when its next sync omits the link.
          const { count } = await prisma.whatsAppLink.updateMany({
            where: { id: input.linkId, ...owned(context.actor) },
            data: { removedAt: new Date(), status: "logged_out" },
          });
          if (count !== 1) throw new ORPCError("NOT_FOUND");
          return { ok: true as const };
        }),
      },
      senders: {
        add: authed.whatsapp.senders.add.handler(async ({ context, input }) => {
          const found = await link(context.actor, input.linkId);
          let jid: string;
          let label: string;
          if (input.kind === "contact") {
            const phone = normalizeWhatsAppPhone(input.phone);
            if (!phone)
              throw new ORPCError("BAD_REQUEST", {
                message: "Enter the phone number with its country code.",
              });
            jid = `${phone}@s.whatsapp.net`;
            label = phone;
          } else {
            const group = isWhatsAppGroupJid(input.jid)
              ? linkGroups(found.groups).find((entry) => entry.jid === input.jid)
              : undefined;
            if (!group)
              throw new ORPCError("BAD_REQUEST", {
                message: "That group is not on this WhatsApp number.",
              });
            jid = group.jid;
            label = group.name;
          }
          const sender = await prisma.whatsAppSender.upsert({
            where: { linkId_jid: { linkId: found.id, jid } },
            create: { linkId: found.id, kind: input.kind, jid, label, status: "allowed" },
            update: { kind: input.kind, label, status: "allowed", code: null },
          });
          return senderDto(sender);
        }),
        respond: authed.whatsapp.senders.respond.handler(async ({ context, input }) => {
          const sender = await prisma.whatsAppSender.findFirst({
            where: { id: input.senderId, link: owned(context.actor) },
          });
          if (!sender) throw new ORPCError("NOT_FOUND");
          return senderDto(
            await prisma.whatsAppSender.update({
              where: { id: sender.id },
              data: { status: input.accept ? "allowed" : "denied", code: null },
            }),
          );
        }),
        remove: authed.whatsapp.senders.remove.handler(async ({ context, input }) => {
          const { count } = await prisma.whatsAppSender.deleteMany({
            where: { id: input.senderId, link: owned(context.actor) },
          });
          if (count !== 1) throw new ORPCError("NOT_FOUND");
          return { ok: true as const };
        }),
      },
    },
  };
}

async function linkDtos(prisma: PrismaClient, ids: Array<{ id: string }>): Promise<WhatsAppLink[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.whatsAppLink.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    orderBy: { createdAt: "asc" },
    include: {
      bot: { select: { name: true } },
      senders: { orderBy: { createdAt: "asc" } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    botId: row.botId,
    botName: row.bot.name,
    mode: row.mode === "dedicated" ? "dedicated" : "personal",
    phone: row.phone,
    pushName: row.pushName,
    status: row.status === "connected" || row.status === "connecting" ? row.status : "logged_out",
    desktopDeviceId: row.desktopDeviceId,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    senders: row.senders.map(senderDto),
    groups: linkGroups(row.groups),
  }));
}

function senderDto(row: SenderRow): WhatsAppSender {
  return {
    id: row.id,
    kind: row.kind === "group" ? "group" : "contact",
    jid: row.jid,
    label: row.label,
    status: row.status === "allowed" || row.status === "pending" ? row.status : "denied",
    code: row.code,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Groups as Desktop last reported them; anything malformed is dropped. */
function linkGroups(value: unknown): Array<{ jid: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry &&
    typeof entry === "object" &&
    isWhatsAppGroupJid((entry as { jid?: unknown }).jid) &&
    typeof (entry as { name?: unknown }).name === "string"
      ? [{ jid: (entry as { jid: string }).jid, name: (entry as { name: string }).name }]
      : [],
  );
}
