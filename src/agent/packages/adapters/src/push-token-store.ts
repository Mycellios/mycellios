import type { PrismaClient } from "@rakazo/db";
import { runAsSystem, withTransactionRetry } from "@rakazo/db";
import { credentialDigest } from "./credential-digest.js";
import { EncryptedSecretStore } from "./secrets.js";

export interface PushRecord {
  token: string;
  sessionId?: string;
  transport?: "expo" | "fcm";
}

/** Account-wide registrations, shared by API replicas and notification workers. */
export interface PushTokenStore {
  load(userId: string): Promise<PushRecord | undefined>;
  list?(userId: string): Promise<PushRecord[]>;
  save(userId: string, token: string, sessionId: string, transport?: "expo" | "fcm"): Promise<void>;
  /** Import only when neither the account nor the device is registered already. */
  importLegacy(userId: string, token: string, sessionId: string): Promise<boolean>;
  remove(userId: string, tokenDigest?: string): Promise<void>;
  endSession(userId: string, sessionId: string, nextSessionId?: string): Promise<void>;
}

export class PushSessionEndedError extends Error {
  constructor() {
    super("Push session ended");
  }
}

export class PrismaPushTokenStore implements PushTokenStore {
  private readonly encryption: EncryptedSecretStore;

  constructor(
    private readonly prisma: PrismaClient,
    encryptionKey: string,
  ) {
    this.encryption = new EncryptedSecretStore(encryptionKey);
  }

  async load(userId: string): Promise<PushRecord | undefined> {
    return runAsSystem("load an account's notification registration", async () => {
      const row = await this.prisma.pushToken.findUnique({ where: { userId } });
      if (!row) return undefined;
      return {
        token: await this.encryption.load(row.ciphertext, `push-token:${userId}`),
        sessionId: row.sessionId,
      };
    });
  }

  async list(userId: string): Promise<PushRecord[]> {
    return runAsSystem("load an account's notification devices", async () => {
      const rows = await this.prisma.mobilePushDevice.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
      const legacy = await this.prisma.pushToken.findUnique({ where: { userId } });
      if (legacy && !rows.some(row => row.tokenDigest === legacy.tokenDigest)) {
        // A token handed to another account must not be resurrected by its legacy row.
        const owner = await this.prisma.mobilePushDevice.findUnique({ where: { tokenDigest: legacy.tokenDigest }, select: { userId: true } });
        if (!owner || owner.userId === userId) rows.push({ ...legacy, transport: "expo" });
      }
      return Promise.all(rows.map(async row => ({ token: await this.encryption.load(row.ciphertext, `push-token:${userId}`), sessionId: row.sessionId, transport: row.transport as "expo" | "fcm" })));
    });
  }

  async save(userId: string, token: string, sessionId: string, transport: "expo" | "fcm" = "expo"): Promise<void> {
    await this.register(userId, token, sessionId, "register", transport);
  }

  importLegacy(userId: string, token: string, sessionId: string): Promise<boolean> {
    return this.register(userId, token, sessionId, "import");
  }

  private async register(
    userId: string,
    token: string,
    sessionId: string,
    mode: "register" | "import",
    transport: "expo" | "fcm" = "expo",
  ): Promise<boolean> {
    const value = token.trim();
    if (!value) throw new Error("Push token is empty");
    const tokenDigest = credentialDigest(value);
    const sealed = await this.encryption.put(
      value,
      {
        operationId: "push.register",
        traceId: "push.register",
        spaceId: "",
        userId,
        signal: new AbortController().signal,
      },
      { recordId: `push-token:${userId}` },
    );
    return runAsSystem("register or import a notification device", () =>
      withTransactionRetry(() =>
        this.prisma.$transaction(async (tx) => {
          // Account locks serialize sign-out/replacement; token locks serialize device handover.
          // Keep advisory acquisition ordered; row-lock conflicts during handover are retried.
          for (const key of [`push-user:${userId}`, `push-token:${tokenDigest}`].sort())
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
          // Legacy files are weaker evidence than any existing database registration.
          // Use the same locks as live registration so the check and insert are atomic.
          if (
            mode === "import" &&
            ((await tx.mobilePushDevice.findFirst({ where: { OR: [{ userId }, { tokenDigest }] }, select: { userId: true } })) || await tx.pushToken.findFirst({
              where: { OR: [{ userId }, { tokenDigest }] },
              select: { userId: true },
            }))
          )
            return false;
          // Lock the session against deletion until registration commits. A late registration
          // after sign-out cannot publish a token, even when its request authenticated earlier.
          const sessions = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "session" WHERE id = ${sessionId} AND "userId" = ${userId}
          AND "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE`;
          if (!sessions.length) throw new PushSessionEndedError();
          const data = { ciphertext: sealed.ciphertext, tokenDigest, sessionId };
          await tx.mobilePushDevice.upsert({ where: { tokenDigest }, create: { userId, ...data, transport }, update: { userId, ciphertext: sealed.ciphertext, sessionId, transport } });
          const stale = await tx.mobilePushDevice.findMany({ where: { userId, tokenDigest: { not: tokenDigest } }, orderBy: [{ updatedAt: "desc" }, { tokenDigest: "asc" }], skip: 19, select: { tokenDigest: true } });
          if (stale.length) await tx.mobilePushDevice.deleteMany({ where: { userId, tokenDigest: { in: stale.map(row => row.tokenDigest) } } });
          if (mode === "import") await tx.pushToken.create({ data: { userId, ...data } });
          else if (transport === "expo") {
            await tx.pushToken.deleteMany({ where: { tokenDigest, userId: { not: userId } } });
            await tx.pushToken.upsert({
              where: { userId },
              create: { userId, ...data },
              update: data,
            });
          }
          return true;
        }),
      ),
    );
  }

  async remove(userId: string, tokenDigest?: string): Promise<void> {
    await runAsSystem("remove an account's notification registration", () =>
      withTransactionRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push-user:${userId}`}, 0))::text`;
          await tx.pushToken.deleteMany({
            where: { userId, ...(tokenDigest ? { tokenDigest } : {}) },
          });
          await tx.mobilePushDevice.deleteMany({ where: { userId, ...(tokenDigest ? { tokenDigest } : {}) } });
        }),
      ),
    );
  }

  async endSession(userId: string, sessionId: string, nextSessionId?: string): Promise<void> {
    await runAsSystem("revoke or retarget a session's notification registration", () =>
      withTransactionRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push-user:${userId}`}, 0))::text`;
          const where = { userId, sessionId };
          if (nextSessionId) {
            const session = await tx.session.findFirst({
              where: { id: nextSessionId, userId, expiresAt: { gt: new Date() } },
              select: { id: true },
            });
            if (!session) {
              await tx.pushToken.deleteMany({ where });
              await tx.mobilePushDevice.deleteMany({ where });
              return;
            }
            await tx.pushToken.updateMany({ where, data: { sessionId: nextSessionId } });
            await tx.mobilePushDevice.updateMany({ where, data: { sessionId: nextSessionId } });
          } else {
            await tx.pushToken.deleteMany({ where });
            await tx.mobilePushDevice.deleteMany({ where });
          }
        }),
      ),
    );
  }
}
