import { MICO_AVATAR_DEFAULT_SHAPES, MICO_PRIMARY_AVATAR, micoAvatarValue } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("new bot avatars (PostgreSQL)", () => {
  const provider = "sendblue";
  // A prefix no other test file uses, so parallel files never share this account.
  const address = `+1554${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };

  const actor = () => ({
    userId: owner.userId,
    spaceId: owner.spaceId,
    email: "avatars@example.com",
    isDeploymentOwner: false,
  });
  const botInput = (name: string) => ({
    name,
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider, address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
  });

  afterAll(async () => {
    if (prisma && owner) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({ where: { provider, address } });
      await system.organization.deleteMany({ where: { id: owner.spaceId } });
      await system.user.deleteMany({ where: { id: owner.userId } });
    }
    await close?.();
  });

  it("gives each new bot a shape and colour the user's other bots use least", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    const before = await system.bot.findMany({
      where: { spaceId: owner.spaceId, userId: owner.userId },
      select: { id: true, color: true },
    });

    const created = await runAsTenant(owner, async () => {
      const bots = [];
      for (let index = 0; index < 9; index++) {
        bots.push(await repos.createBot(actor(), botInput(`Helper ${index}`)));
      }
      // A bot made by a bot goes through the same choice.
      bots.push(await repos.createBot(actor(), { ...botInput("Child"), parentBotId: bots[0]!.id }));
      return bots;
    });

    const expected = [
      ...(before.length === 0 ? [MICO_PRIMARY_AVATAR] : []),
      ...MICO_AVATAR_DEFAULT_SHAPES.map(({ index, originalColor }) => micoAvatarValue(index, originalColor)),
    ].filter((value) => !before.some((bot) => bot.color === value));
    expect(created.map((bot) => bot.color)).toEqual(expected.slice(0, created.length));
    expect(created.every((bot) => /^c[a-z0-9]{24}$/.test(bot.id))).toBe(true);

    // Existing bots keep their id and colour.
    const after = await system.bot.findMany({
      where: { id: { in: before.map((bot) => bot.id) } },
      select: { id: true, color: true },
    });
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it("serializes concurrent creation before reading the existing avatar looks", async () => {
    const repos = createRepos(prisma);
    await asSystem(prisma).bot.updateMany({
      where: { spaceId: owner.spaceId, userId: owner.userId },
      data: { archivedAt: new Date() },
    });
    const created = await runAsTenant(owner, () =>
      Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          repos.createBot(actor(), botInput(`Concurrent ${index}`)),
        ),
      ),
    );
    expect(new Set(created.map((bot) => bot.color)).size).toBe(8);
    expect(created.map((bot) => bot.color)).toContain(MICO_PRIMARY_AVATAR);
    expect(created.map((bot) => bot.color)).toContain("#D47046::shape_1001");
  });

  it("keeps a colour the caller chose and skips archived bots", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    await system.bot.updateMany({
      where: { spaceId: owner.spaceId, userId: owner.userId, color: "#D47046::shape_1001" },
      data: { archivedAt: new Date() },
    });
    const next = await runAsTenant(owner, () =>
      repos.createBot(actor(), { ...botInput("Picked"), color: "#123456" }),
    );
    expect(next.color).toBe("#123456");
    const automatic = await runAsTenant(owner, () =>
      repos.createBot(actor(), botInput("Automatic")),
    );
    expect(automatic.color).toBe("#D47046::shape_1001");
  });
});
