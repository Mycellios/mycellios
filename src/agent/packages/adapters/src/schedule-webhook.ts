import { createHash, randomBytes } from "node:crypto";
import type { AdapterContext, ConnectorTool, SecretStore } from "@mycellios/adapter-kit";
import {
  ROUTINE_WEBHOOK_REVEAL_HOURS,
  RoutineEventFiltersSchema,
  RoutineEventTypeSchema,
  routineEventsPath,
} from "@mycellios/contracts";
import type { Prisma, PrismaClient } from "@mycellios/db";
import * as z from "zod";
import { MAX_ACTIVE_ROUTINES_PER_BOT, userTimeZone } from "./schedule-tools.js";

const input = z.strictObject({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(16_000),
  eventType: RoutineEventTypeSchema.optional(),
  filters: RoutineEventFiltersSchema.optional(),
});

export const createWebhookRoutineTool: ConnectorTool = {
  name: "schedule_create_webhook",
  description: "Create a signed webhook routine only when the person explicitly asks for one in this chat. The chat card gives the person the URL and a one-time secret. Never ask for or repeat the secret.",
  inputSchema: z.toJSONSchema(input),
};

export async function createWebhookRoutineFromChat<T>(
  prisma: PrismaClient,
  secrets: SecretStore,
  context: AdapterContext,
  actor: { runId: string; botId: string; spaceId: string; userId: string },
  executionId: string,
  args: unknown,
  persistCard: (tx: Prisma.TransactionClient, routine: { id: string; name: string }) => Promise<T>,
) {
  const parsed = input.safeParse(args);
  if (!parsed.success) return { result: { error: "Check the webhook routine name, instruction, event type and filters." } };
  const id = "webhook-" + createHash("sha256").update(JSON.stringify([actor.runId, executionId])).digest("hex");
  const { name, prompt, eventType, filters } = parsed.data;
  const scope = { botId: actor.botId, spaceId: actor.spaceId, userId: actor.userId };
  const timezone = await userTimeZone(prisma, actor.userId);
  return prisma.$transaction(async (tx) => {
    const bots = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bots WHERE id = ${actor.botId} AND "spaceId" = ${actor.spaceId}
      AND "userId" = ${actor.userId} AND "archivedAt" IS NULL FOR UPDATE
    `;
    if (!bots.length) return { result: { error: "This Mico is unavailable." } };
    const earlier = await tx.routine.findFirst({ where: { id, ...scope }, select: { id: true } });
    const result = { ok: true as const, routineId: id, path: routineEventsPath(id) };
    if (earlier) return { result };
    const active = await tx.routine.findMany({ where: { ...scope, active: true }, select: { name: true } });
    if (active.some((row) => row.name.trim().toLowerCase() === name.toLowerCase()))
      return { result: { error: "There is already an active routine with that name." } };
    if (active.length >= MAX_ACTIVE_ROUTINES_PER_BOT)
      return { result: { error: "This Mico has reached its active routine limit." } };
    const stored = await secrets.put(`whsec_${randomBytes(32).toString("base64")}`, context);
    const now = new Date();
    await tx.routine.create({
      data: {
        id, ...scope, name, prompt, timezone, crons: [], active: true, notify: true,
        webhookEnabled: true, webhookEventType: eventType ?? null, webhookFilters: filters ?? [],
        webhookSecrets: { create: {
          id: stored.id, spaceId: actor.spaceId, userId: actor.userId, ciphertext: stored.ciphertext,
          createdAt: now, revealUntil: new Date(now.getTime() + ROUTINE_WEBHOOK_REVEAL_HOURS * 3_600_000),
        } },
      },
    });
    return { result, card: await persistCard(tx, { id, name }) };
  });
}
