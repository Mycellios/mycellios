import { ORPCError } from "@orpc/server";
import { MessageBlock, type Actor, type MessagePin } from "@mycellios/contracts";
import { messageReplyPreview } from "@mycellios/core/message-quote";
import {
  createRepos,
  listMessagePins,
  listMicoMessagePins,
  MESSAGE_PIN_LIMIT_ERROR,
  type PrismaClient,
  setMessagePin,
} from "@mycellios/db";
import { searchThreadMessages } from "../search.js";
import { resolveThreadTarget } from "../thread-target.js";
import { loadMessagePage, withoutPeerRunMessages } from "../thread-message-pages.js";
import type { RouterContext } from "./context.js";

type PinRef = { messageId: string; pinnedAt: Date; pinnedByBotId: string | null };

/**
 * The current preview of each pinned message that still exists and that the transcript shows,
 * plus who pinned it. Nothing is copied into the pin itself.
 */
async function pinPreviews(prisma: PrismaClient, pins: Array<PinRef & { threadId: string }>) {
  if (!pins.length) return new Map<string, MessagePin>();
  const threadIds = [...new Set(pins.map((pin) => pin.threadId))];
  const rows = await prisma.message.findMany({
    where: {
      threadId: threadIds.length === 1 ? threadIds[0]! : { in: threadIds },
      id: { in: pins.map((pin) => pin.messageId) },
      role: { in: ["user", "bot"] },
    },
  });
  const visible = await withoutPeerRunMessages(prisma, rows);
  const authors = [...new Set(pins.flatMap((pin) => (pin.pinnedByBotId ? [pin.pinnedByBotId] : [])))];
  const names = new Map(
    authors.length
      ? (await prisma.bot.findMany({ where: { id: { in: authors } }, select: { id: true, name: true } })).map(
          (bot) => [bot.id, bot.name] as const,
        )
      : [],
  );
  const byId = new Map(visible.map((message) => [message.id, message]));
  const previews = new Map<string, MessagePin>();
  for (const pin of pins) {
    const message = byId.get(pin.messageId);
    if (!message || message.threadId !== pin.threadId) continue;
    const parsed = MessageBlock.array().safeParse(message.blocks);
    const preview = messageReplyPreview(parsed.success ? parsed.data : [], message.role as "user" | "bot").text;
    previews.set(pin.messageId, {
      messageId: message.id,
      seq: message.seq,
      role: message.role as "user" | "bot",
      preview: preview.slice(0, 800),
      createdAt: message.createdAt.toISOString(),
      pinnedAt: pin.pinnedAt.toISOString(),
      pinnedByBotId: pin.pinnedByBotId,
      ...(pin.pinnedByBotId && names.has(pin.pinnedByBotId) ? { pinnedByName: names.get(pin.pinnedByBotId) } : {}),
    });
  }
  return previews;
}

function rejectLimit(error: unknown): never {
  if (error instanceof Error && error.message === MESSAGE_PIN_LIMIT_ERROR)
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  throw error;
}

export function messagePinRoutes({ deps, authed }: RouterContext) {
  return {
    pinned: authed.threads.pinned.handler(async ({ context, input }) => {
      const target = await resolveThreadTarget(deps.prisma, context.actor, input, { includeArchived: true });
      const pins = await listMessagePins(deps.prisma, context.actor, target.threadId);
      if (!pins.length) return { threadId: target.threadId, pins: [] };
      const previews = await pinPreviews(
        deps.prisma,
        pins.map((pin) => ({ ...pin, threadId: target.threadId })),
      );
      return {
        threadId: target.threadId,
        pins: pins.flatMap((pin) => {
          const preview = previews.get(pin.messageId);
          return preview ? [preview] : [];
        }),
      };
    }),
    setPin: authed.threads.setPin.handler(async ({ context, input }) => {
      const target = await resolveThreadTarget(deps.prisma, context.actor, input, { includeArchived: true });
      const page = await loadMessagePage(deps.prisma, target.threadId, undefined, 1, { messageId: input.messageId });
      if (
        !page.messages.some(
          (message) => message.id === input.messageId && (message.role === "user" || message.role === "bot"),
        )
      )
        throw new ORPCError("NOT_FOUND");
      try {
        await setMessagePin(deps.prisma, context.actor as Actor, target.threadId, input.messageId, input.pinned);
      } catch (error) {
        rejectLimit(error);
      }
      return { ok: true as const };
    }),
    searchMessages: authed.threads.searchMessages.handler(async ({ context, input }) => {
      const target = await resolveThreadTarget(deps.prisma, context.actor, input, { includeArchived: true });
      const result = await searchThreadMessages(deps.prisma, context.actor, target.threadId, input.q);
      return { threadId: target.threadId, ...result };
    }),
  };
}

/** Pins across one Mico's main chat and side conversations, for the combined pin list. */
export function micoPinRoutes({ deps, authed }: RouterContext) {
  return {
    pins: {
      mico: authed.pins.mico.handler(async ({ context, input }) => {
        const bot = await createRepos(deps.prisma).getBot(context.actor, input.botId, { includeArchived: true });
        const pins = await listMicoMessagePins(deps.prisma, context.actor, bot.id);
        const previews = await pinPreviews(deps.prisma, pins);
        return {
          pins: pins.flatMap((pin) => {
            const preview = previews.get(pin.messageId);
            if (!preview) return [];
            const main = pin.botId === bot.id;
            return [
              {
                ...preview,
                threadId: pin.threadId,
                taskThreadId: main ? null : pin.threadId,
                // The client names the main chat and untitled conversations in its own language.
                conversationTitle: main ? "" : (pin.title?.trim() ?? ""),
                archived: Boolean(pin.archivedAt),
              },
            ];
          }),
        };
      }),
      unpin: authed.pins.unpin.handler(async ({ context, input }) => {
        const bot = await createRepos(deps.prisma).getBot(context.actor, input.botId, { includeArchived: true });
        // Only the Mico's own main chat or one of its side conversations, for this owner and Space.
        const thread = await deps.prisma.thread.findFirst({
          where: {
            id: input.threadId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            groupId: null,
            OR: [{ botId: bot.id }, { botId: null, taskBotId: bot.id }],
          },
          select: { id: true },
        });
        if (!thread) throw new ORPCError("NOT_FOUND");
        await setMessagePin(deps.prisma, context.actor as Actor, thread.id, input.messageId, false);
        return { ok: true as const };
      }),
    },
  };
}
