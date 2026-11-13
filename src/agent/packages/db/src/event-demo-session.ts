import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/** Queued tasks cannot outlive a temporary event login, including after sign-out. */
export async function eventDemoSessionActive(prisma: Pick<PrismaClient, "session">, userId: string, now = new Date()) {
  if (!userId.startsWith("ed_")) return true;
  return runAsSystem("check temporary event worker authorization", async () => Boolean(await prisma.session.findFirst({
    where: { userId, id: { startsWith: "event-session-" }, expiresAt: { gt: now } }, select: { id: true },
  })));
}
