import type { Actor } from "@mycellios/contracts";
import { createDb, provisionMessagingIdentity, runAsSystem, runAsTenant } from "@mycellios/db";
import { expect, it } from "vitest";
import { adoptLocalEngines, localEngineAdoptionNote } from "./local-engine-adoption.js";

const databaseUrl = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;

it.skipIf(!databaseUrl)("adopts an idle This PC Mico once across concurrent requests (PostgreSQL)", async () => {
  const { prisma, pool } = createDb(databaseUrl!, { encryptContent: false });
  try {
    const identity = await runAsSystem("test fixture", () => provisionMessagingIdentity(prisma, {
      provider: "sendblue",
      address: `local-engine-adoption-${crypto.randomUUID()}`,
    }, { signupsEnabled: undefined, signupAllowlist: undefined }));
    const actor: Actor = { ...identity, email: "fixture@example.test", isDeploymentOwner: false };
    const scope = { spaceId: actor.spaceId, userId: actor.userId };
    try {
      await runAsTenant(actor, async () => {
        async function createMico(name: string, computerScope = "dedicated") {
          const key = `${actor.spaceId}:${name}`;
          const computer = await prisma.computer.create({
            data: { ...scope, kind: "desktop", scope: computerScope, scopeKey: key, homeKey: key },
          });
          const bot = await prisma.bot.create({
            data: {
              ...scope, name, color: "#10B981", agentEngine: "pi", modelId: "saved-model",
              computerId: computer.id,
              thread: { create: scope },
            },
            include: { thread: true },
          });
          return { ...bot, threadId: bot.thread!.id };
        }

        const idle = await createMico("Idle");
        const waiting = await createMico("Waiting for input");
        const delegated = await createMico("Delegated work");
        const team = await createMico("Team", "team");
        const waitingScope = { ...scope, botId: waiting.id, threadId: waiting.threadId };
        const task = await prisma.task.create({ data: { ...waitingScope, prompt: "Synthetic", status: "running" } });
        await prisma.run.create({
          data: { ...waitingScope, taskId: task.id, status: "waiting_input", trigger: "user" },
        });
        await prisma.task.create({
          data: { ...scope, botId: delegated.id, threadId: delegated.threadId,
            prompt: "Synthetic", status: "queued", delegationState: "queued" },
        });

        // Make both requests select the old row before either tries to adopt it.
        const bothProbed = Promise.withResolvers<void>();
        let idleProbes = 0;
        const engineFor = async (botId: string) => {
          if (botId === idle.id) {
            if (++idleProbes === 2) bothProbed.resolve();
            await bothProbed.promise;
          }
          return "codex" as const;
        };
        const results = await Promise.all([
          adoptLocalEngines(prisma, actor, engineFor),
          adoptLocalEngines(prisma, actor, engineFor),
        ]);
        expect(results.flat()).toEqual([{ botId: idle.id, engine: "codex" }]);

        const after = await prisma.bot.findUniqueOrThrow({ where: { id: idle.id } });
        expect(after).toMatchObject({ agentEngine: "codex", modelId: "saved-model", localEngineAdoptedAt: expect.any(Date) });
        const notes = await prisma.message.findMany({ where: { threadId: idle.threadId } });
        expect(notes).toMatchObject([{ role: "system", blocks: [{ kind: "meta", text: localEngineAdoptionNote("codex") }] }]);
        const skipped = await prisma.bot.findMany({ where: { id: { in: [waiting.id, delegated.id, team.id] } } });
        expect(skipped).toHaveLength(3);
        for (const bot of skipped) expect(bot).toMatchObject({ agentEngine: "pi", localEngineAdoptedAt: null });

        await prisma.bot.update({ where: { id: idle.id }, data: { agentEngine: "pi", modelId: "manual-model" } });
        expect(await adoptLocalEngines(prisma, actor, async () => "claude")).toEqual([]);
        expect(await prisma.bot.findUniqueOrThrow({ where: { id: idle.id } })).toMatchObject({
          agentEngine: "pi", modelId: "manual-model", localEngineAdoptedAt: after.localEngineAdoptedAt,
        });
        expect(await prisma.message.count({ where: { threadId: idle.threadId } })).toBe(1);
      });
    } finally {
      await runAsSystem("test fixture cleanup", () => prisma.user.delete({ where: { id: actor.userId } }));
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}, 15_000);
