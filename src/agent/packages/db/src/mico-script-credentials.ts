import { createHash, randomBytes } from "node:crypto";
import {
  MICO_SCRIPT_REQUESTS_PER_HOUR,
  MICO_SCRIPT_TOKEN_PREFIX,
  MICO_SCRIPT_TOKENS_MAX,
  MicoScriptRequestsPerHourSchema,
  micoScriptsPath,
} from "@mycellios/contracts";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

type Scope = { botId: string; spaceId: string; userId: string };

export function micoScriptTokenDigest(token: string): string | null {
  if (!/^mycs_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

async function lockOwnedMico(tx: Prisma.TransactionClient, scope: Scope) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM bots WHERE id = ${scope.botId} AND "spaceId" = ${scope.spaceId}
    AND "userId" = ${scope.userId} AND "archivedAt" IS NULL FOR UPDATE
  `;
  return rows.length === 1;
}

const tokenMetadata = { id: true, hint: true, createdAt: true, lastUsedAt: true } as const;

export async function readMicoScriptsSettings(prisma: PrismaClient, scope: Scope) {
  const mico = await prisma.bot.findFirst({
    where: { id: scope.botId, spaceId: scope.spaceId, userId: scope.userId, archivedAt: null },
    select: {
      scriptSettings: {
        select: {
          enabled: true, requestsPerHour: true,
          tokens: { select: tokenMetadata, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!mico) return null;
  const settings = mico.scriptSettings;
  return {
    enabled: settings?.enabled ?? false,
    requestsPerHour: settings?.requestsPerHour ?? MICO_SCRIPT_REQUESTS_PER_HOUR,
    tokens: (settings?.tokens ?? []).map(micoScriptTokenMetadata),
    path: micoScriptsPath(scope.botId),
  };
}

export function micoScriptTokenMetadata(record: {
  id: string; hint: string; createdAt: Date; lastUsedAt: Date | null;
}) {
  return {
    id: record.id,
    hint: record.hint,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
  };
}

export async function setMicoScriptsEnabled(
  prisma: PrismaClient, scope: Scope, enabled: boolean, requestsPerHour: number,
) {
  const limit = MicoScriptRequestsPerHourSchema.parse(requestsPerHour);
  return prisma.$transaction(async (tx) => {
    if (!await lockOwnedMico(tx, scope)) return null;
    return tx.micoScriptSettings.upsert({
      where: { botId_spaceId_userId: scope },
      create: { ...scope, enabled, requestsPerHour: limit },
      update: { enabled, requestsPerHour: limit },
    });
  });
}

export async function issueMicoScriptToken(prisma: PrismaClient, scope: Scope) {
  return prisma.$transaction(async (tx) => {
    if (!await lockOwnedMico(tx, scope)) return { status: "unavailable" as const };
    const settings = await tx.micoScriptSettings.findUnique({
      where: { botId_spaceId_userId: scope },
      select: { enabled: true, _count: { select: { tokens: true } } },
    });
    if (!settings?.enabled) return { status: "unavailable" as const };
    if (settings._count.tokens >= MICO_SCRIPT_TOKENS_MAX) return { status: "limit" as const };
    const token = MICO_SCRIPT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const record = await tx.micoScriptToken.create({
      data: { ...scope, digest: micoScriptTokenDigest(token)!, hint: token.slice(0, 13) },
      select: tokenMetadata,
    });
    return { status: "issued" as const, record, token };
  });
}

export async function revokeMicoScriptToken(prisma: PrismaClient, scope: Scope, id: string) {
  const result = await prisma.micoScriptToken.deleteMany({ where: { id, ...scope } });
  return result.count === 1;
}

/** Run in the system context for header admission, then use the returned tenant for each request. */
export async function findMicoScriptCredential(prisma: PrismaClient, botId: string, token: string) {
  const digest = micoScriptTokenDigest(token);
  if (!digest) return null;
  const resolved = await prisma.micoScriptToken.findFirst({
    where: { digest, botId, settings: { enabled: true, bot: { archivedAt: null } } },
    select: {
      id: true, botId: true, spaceId: true, userId: true,
      settings: { select: { requestsPerHour: true, bot: { select: { spaceId: true, userId: true } } } },
    },
  });
  if (!resolved || resolved.spaceId !== resolved.settings.bot.spaceId ||
      resolved.userId !== resolved.settings.bot.userId) return null;
  const { settings, ...scope } = resolved;
  return { ...scope, requestsPerHour: settings.requestsPerHour };
}
