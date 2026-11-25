import { afterAll, describe, expect, it } from "vitest";
import { createDb, type PrismaClient } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("default Space membership trigger (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `trigger-user-${suffix}`;
  const organizationId = `trigger-organization-${suffix}`;
  const spaceId = `trigger-space-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close();
  });

  it("adds a new organization owner to its default Space, never an invited member", async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };

    const createdAt = new Date();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Trigger Test User",
        email: `${userId}@mycellios.test`,
        emailVerified: false,
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Trigger Test Organization",
        slug: organizationId,
        createdAt,
      },
    });
    await prisma.space.create({
      data: {
        id: spaceId,
        organizationId,
        name: "General",
        isDefault: true,
        createdByUserId: userId,
      },
    });

    // The default Space is the owner's Personal Space: someone invited to another of its
    // Spaces joins only that one (specs/space-members).
    const memberId = `trigger-member-${suffix}`;
    await prisma.member.create({
      data: {
        id: memberId,
        organizationId,
        userId,
        role: "member",
        createdAt,
      },
    });
    await expect(
      prisma.spaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId } } }),
    ).resolves.toBeNull();

    await prisma.member.delete({ where: { id: memberId } });
    const ownerId = `trigger-owner-${suffix}`;
    await prisma.member.create({
      data: {
        id: ownerId,
        organizationId,
        userId,
        role: "owner",
        createdAt,
      },
    });
    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
    });
    expect(membership).toMatchObject({
      id: `default-space-member:${ownerId}`,
      spaceId,
      organizationId,
      userId,
      role: "owner",
    });
  });
});
