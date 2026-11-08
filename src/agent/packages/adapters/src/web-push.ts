import { createHash, randomUUID } from "node:crypto";
import type {
  AdapterContext,
  JobPublisher,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import {
  NotificationSettingsSchema,
  notificationAllowed,
  WebPushSubscriptionSchema,
} from "@rakazo/contracts";
import type { NotificationSettings, WebPushSubscription } from "@rakazo/contracts";
import { micoAvatarShape, parseBotAvatarValue } from "@rakazo/contracts";
import { currentMicoAvatarValue } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import webpush from "web-push";
import { EncryptedSecretStore } from "./secrets.js";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export function webPushConfig(env: NodeJS.ProcessEnv): VapidConfig | undefined {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = env.WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject) return undefined;
  if (
    !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey) ||
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)
  ) {
    throw new Error("Invalid Web Push VAPID configuration");
  }
  return { publicKey, privateKey, subject };
}

/** Only browser-vendor push services, never a user-chosen HTTP proxy or private host. */
export function validatePushEndpoint(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const vendor =
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com");
  if (
    !vendor ||
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    value.length > 2048
  ) {
    throw new Error("Unsupported browser push endpoint");
  }
  return url.href;
}

export function privateNotification(message: NotificationMessage, previews: boolean) {
  // Even opt-in previews must not reveal common credentials or arbitrarily long content.
  const clean = (text: string, limit: number) =>
    text
      .replace(/\b(?:Bearer\s+\S+|(?:sk-|rk-|ghp_|github_pat_)[A-Za-z0-9_-]+)\b/gi, "[hidden]")
      .replace(/(?:password|token|api[_ -]?key|secret)\s*[:=]\s*\S+/gi, "[hidden]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, limit);
  return {
    title: previews ? clean(message.title, 80) : "Mycellios",
    body: previews
      ? clean(message.body, 180)
      : {
          completion: "Your Mico has finished. Open the chat to see the result.",
          failure: "Your Mico needs attention. Open the chat for details.",
          help: "Your Mico needs your answer.",
          takeover: "Your Mico needs you to continue.",
        }[message.kind],
  };
}

type Device = {
  id: string;
  userId: string;
  sessionId: string;
  ciphertext: string;
  focusedUntil: Date | null;
};
type Delivery = {
  id: string;
  deviceId: string;
  ciphertext: string;
  spaceId: string;
  botId: string;
  runId: string;
  kind: NotificationMessage["kind"];
  eventId: string;
  attempts: number;
  expiresAt: Date;
};
type Sender = (
  subscription: WebPushSubscription,
  payload: string,
  config: VapidConfig,
) => Promise<unknown>;
const send: Sender = (subscription, payload, config) =>
  webpush.sendNotification(subscription, payload, {
    vapidDetails: config,
    TTL: 300,
    urgency: "normal",
    timeout: 10_000,
  });
const system = <T>(fn: () => Promise<T>) => runAsSystem("account-owned Web Push delivery", fn);

/** Durable registrations and outbox; queue payloads contain IDs, never endpoints or chat text. */
export class WebPushService {
  private readonly encryption: EncryptedSecretStore;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly db: PrismaClient,
    encryptionKey: string,
    private readonly jobs: JobPublisher,
    readonly config?: VapidConfig,
    private readonly sender: Sender = send,
  ) {
    this.encryption = new EncryptedSecretStore(encryptionKey);
  }

  async settings(userId: string): Promise<NotificationSettings> {
    return system(async () => {
      const rows = await this.db.$queryRaw<Array<{ settings: unknown }>>`
        SELECT settings FROM web_push_settings WHERE "userId" = ${userId}`;
      const settings = NotificationSettingsSchema.parse(rows[0]?.settings ?? {});
      if (Object.keys(settings.bots).length) {
        const owned = await this.db.bot.findMany({
          where: { userId, id: { in: Object.keys(settings.bots) } },
          select: { id: true },
        });
        const ids = new Set(owned.map((bot) => bot.id));
        settings.bots = Object.fromEntries(
          Object.entries(settings.bots).filter(([id]) => ids.has(id)),
        );
      }
      return settings;
    });
  }
  async saveSettings(userId: string, input: NotificationSettings) {
    const settings = NotificationSettingsSchema.parse(input);
    if (Object.keys(settings.bots).length > 200) throw new Error("Too many Mico overrides");
    if (settings.mutedUntil && Date.parse(settings.mutedUntil) > Date.now() + 7 * 86400_000) {
      throw new Error("Notification pause must be within seven days");
    }
    return system(async () => {
      for (const botId of Object.keys(settings.bots)) {
        if (
          !(await this.db.bot.findFirst({ where: { id: botId, userId }, select: { id: true } }))
        ) {
          throw new Error("Mico not available to this account");
        }
      }
      await this.db.$executeRaw`INSERT INTO web_push_settings ("userId", settings)
        VALUES (${userId}, ${JSON.stringify(settings)}::jsonb)
        ON CONFLICT ("userId") DO UPDATE SET settings = EXCLUDED.settings`;
      return settings;
    });
  }
  async status(userId: string, sessionId: string, clientId: string) {
    return system(async () => {
      const rows = await this.db.$queryRaw<Array<{ id: string }>>`SELECT id FROM web_push_devices
        WHERE "userId" = ${userId} AND "sessionId" = ${sessionId} AND "clientId" = ${clientId}`;
      const bots = await this.db.bot.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, name: true, notifyOnFinish: true },
      });
      return {
        configured: Boolean(this.config),
        publicKey: this.config?.publicKey ?? null,
        registered: Boolean(rows.length),
        settings: await this.settings(userId),
        bots,
      };
    });
  }
  async register(userId: string, sessionId: string, clientId: string, input: WebPushSubscription) {
    if (!this.config) throw new Error("Web Push is not configured");
    const subscription = WebPushSubscriptionSchema.parse(input);
    subscription.endpoint = validatePushEndpoint(subscription.endpoint);
    const digest = createHash("sha256").update(subscription.endpoint).digest("hex");
    const id = randomUUID();
    const ciphertext = await this.seal(JSON.stringify(subscription), id, userId);
    await system(() =>
      this.db.$transaction(async (tx) => {
        // This lock is also used on revocation; a late request cannot revive a logged-out session.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webpush:${userId}`}, 0))::text`;
        const sessions = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "session"
        WHERE id = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > now() FOR UPDATE`;
        if (!sessions.length) throw new Error("Notification session ended");
        const existing = await tx.$queryRaw<
          Array<{ userId: string }>
        >`SELECT "userId" FROM web_push_devices WHERE digest = ${digest} FOR UPDATE`;
        if (existing[0] && existing[0].userId !== userId)
          throw new Error("Unsubscribe this browser before changing accounts");
        const count = await tx.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM web_push_devices WHERE "userId" = ${userId}`;
        if (Number(count[0]?.count) >= 20 && !existing.length)
          throw new Error("Notification device limit reached");
        // Replace only this endpoint or this exact device/session, retaining other phones and PCs.
        await tx.$executeRaw`DELETE FROM web_push_devices WHERE "userId" = ${userId}
        AND (digest = ${digest} OR ("sessionId" = ${sessionId} AND "clientId" = ${clientId}))`;
        await tx.$executeRaw`INSERT INTO web_push_devices (id, "userId", "sessionId", "clientId", digest, ciphertext)
        VALUES (${id}, ${userId}, ${sessionId}, ${clientId}, ${digest}, ${ciphertext})`;
      }),
    );
  }
  async unregister(userId: string, sessionId: string, clientId: string) {
    await system(
      () => this.db.$executeRaw`DELETE FROM web_push_devices
      WHERE "userId" = ${userId} AND "sessionId" = ${sessionId} AND "clientId" = ${clientId}`,
    );
  }
  async endSession(userId: string, sessionId: string, nextSessionId?: string) {
    await system(() =>
      this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`webpush:${userId}`}, 0))::text`;
        const next = nextSessionId
          ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "session"
        WHERE id = ${nextSessionId} AND "userId" = ${userId} AND "expiresAt" > now() FOR UPDATE`
          : [];
        if (next.length)
          await tx.$executeRaw`UPDATE web_push_devices SET "sessionId" = ${nextSessionId!}
        WHERE "userId" = ${userId} AND "sessionId" = ${sessionId}`;
        else
          await tx.$executeRaw`DELETE FROM web_push_devices WHERE "userId" = ${userId} AND "sessionId" = ${sessionId}`;
      }),
    );
  }
  async presence(userId: string, sessionId: string, clientId: string, focused: boolean) {
    // A hidden tab cannot clear a sibling tab's active heartbeat for the same device.
    if (!focused) return;
    await system(() => this.db.$executeRaw`INSERT INTO web_push_presence ("userId", "sessionId", "clientId", "focusedUntil")
      SELECT ${userId}, ${sessionId}, ${clientId}, now() + interval '45 seconds' FROM "session"
      WHERE id = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > now()
      ON CONFLICT ("userId", "sessionId", "clientId") DO UPDATE SET "focusedUntil" = EXCLUDED."focusedUntil"`);
  }

  /** Existing executor notices cover completed/failed runs, questions, approvals and takeovers. */
  async enqueue(message: NotificationMessage, context: AdapterContext) {
    const runId = context.runId;
    if (!this.config || !runId) return 0;
    const settings = await this.settings(context.userId);
    if (!notificationAllowed(settings, message.botId, message.kind)) return 0;
    return system(async () => {
      const run = await this.db.run.findFirst({
        where: {
          id: runId,
          userId: context.userId,
          spaceId: context.spaceId,
          botId: message.botId,
          threadId: message.threadId,
        },
        select: {
          bot: { select: { name: true, color: true } },
          thread: { select: { group: { select: { name: true } } } },
        },
      });
      if (!run) return 0;
      const event = await this.notificationEvent(runId, message.kind);
      if (!event || event.createdAt.getTime() < Date.now() - 300_000) return 0;
      const expiresAt = event.createdAt.getTime() + 300_000;
      const eventKey = event.id;
      const name = run.thread.group?.name ?? run.bot.name;
      const appearance = parseBotAvatarValue(currentMicoAvatarValue(run.bot.color, message.botId));
      const avatar = appearance.kind === "shape" ? micoAvatarShape(appearance.shapeIndex)?.id : undefined;
      const devices = await this.db.$queryRaw<
        Device[]
      >`SELECT * FROM web_push_devices WHERE "userId" = ${context.userId}`;
      for (const device of devices) {
        const id = randomUUID();
        const payload = {
          version: 1,
          id: eventKey,
          accountId: context.userId,
          ...privateNotification({ ...message, title: name }, settings.previews),
          kind: message.kind,
          preview: settings.previews,
          avatar: settings.previews && !message.groupId ? avatar : undefined,
          botId: message.botId,
          threadId: message.threadId,
          spaceId: context.spaceId,
          groupId: message.groupId,
          taskThreadId: message.taskThreadId,
          tag: `mycellios:${message.threadId}`,
          expiresAt,
        };
        const ciphertext = await this.seal(JSON.stringify(payload), id, context.userId);
        await this.db.$executeRaw`INSERT INTO web_push_deliveries
          (id, "deviceId", "eventKey", ciphertext, "spaceId", "botId", "runId", kind, "eventId", "dueAt", "expiresAt")
          VALUES (${id}, ${device.id}, ${eventKey}, ${ciphertext}, ${context.spaceId}, ${message.botId}, ${runId}, ${message.kind}, ${event.id}, ${new Date(Date.now() + 3_000)}, ${new Date(expiresAt)})
          ON CONFLICT ("deviceId", "eventKey") DO NOTHING`;
      }
      await this.drain();
      return devices.length;
    });
  }
  /** Repair the commit/enqueue gap and expired worker leases without replaying tools. */
  async drain() {
    if (!this.config) return;
    await system(async () => {
      await this.db.$executeRaw`DELETE FROM web_push_presence WHERE "focusedUntil" < now() - interval '1 minute'`;
      await this.db
        .$executeRaw`DELETE FROM web_push_deliveries WHERE "expiresAt" < now() - interval '1 day'`;
      await this.db.$executeRaw`DELETE FROM web_push_devices d WHERE NOT EXISTS
        (SELECT 1 FROM "session" s WHERE s.id = d."sessionId" AND s."userId" = d."userId" AND s."expiresAt" > now())`;
      const rows = await this.db.$queryRaw<
        Array<{ id: string; dueAt: Date }>
      >`SELECT id, "dueAt" FROM web_push_deliveries
        WHERE "finishedAt" IS NULL AND "expiresAt" > now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        ORDER BY "dueAt" LIMIT 100`;
      for (const row of rows)
        await this.jobs.enqueue({
          name: "webpush.deliver",
          payload: { id: row.id },
          availableAt: row.dueAt,
          replaceKey: `webpush:${row.id}`,
          keepExisting: true,
          maxAttempts: 5,
        });
    });
  }
  start() {
    if (!this.config || this.timer) return;
    const tick = () =>
      void this.drain().catch(() => getLogger().warn("Web Push outbox unavailable"));
    tick();
    this.timer = setInterval(tick, 30_000);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async anyFocused(userId: string) {
    return system(async () => {
      const rows = await this.db.$queryRaw<Array<{ clientId: string }>>`SELECT p."clientId" FROM web_push_presence p
        JOIN "session" s ON s.id = p."sessionId" AND s."userId" = p."userId"
        WHERE p."userId" = ${userId} AND p."focusedUntil" > now() AND s."expiresAt" > now() LIMIT 1`;
      return rows.length > 0;
    });
  }
  async hasRecipient(userId: string) {
    if (!this.config) return false;
    return system(async () => {
      const rows = await this.db.$queryRaw<
        Array<{ id: string }>
      >`SELECT d.id FROM web_push_devices d
        JOIN "session" s ON s.id = d."sessionId" AND s."userId" = d."userId"
        WHERE d."userId" = ${userId} AND s."expiresAt" > now() LIMIT 1`;
      return rows.length > 0;
    });
  }

  async deliver(id: string) {
    if (!this.config) return;
    await system(async () => {
      const [row] = await this.db.$queryRaw<Delivery[]>`UPDATE web_push_deliveries SET
        "leaseUntil" = now() + interval '30 seconds', attempts = attempts + 1
        WHERE id = ${id} AND "finishedAt" IS NULL AND "dueAt" <= now() AND "expiresAt" > now()
        AND attempts < 4 AND ("leaseUntil" IS NULL OR "leaseUntil" < now()) RETURNING *`;
      if (!row) return;
      const [device] = await this.db.$queryRaw<
        Device[]
      >`SELECT * FROM web_push_devices WHERE id = ${row.deviceId}`;
      const finish = () =>
        this.db
          .$executeRaw`UPDATE web_push_deliveries SET "finishedAt" = now(), "leaseUntil" = NULL WHERE id = ${id}`;
      if (!device || !(await this.validDelivery(row, device))) {
        await finish();
        return;
      }
      // Active clients suppress all devices, not just the one displaying the conversation.
      if (await this.anyFocused(device.userId)) {
        await this.db
          .$executeRaw`UPDATE web_push_deliveries SET "leaseUntil" = NULL, attempts = attempts - 1,
          "dueAt" = now() + interval '15 seconds' WHERE id = ${id}`;
        return;
      }
      try {
        const subscription = WebPushSubscriptionSchema.parse(
          JSON.parse(await this.encryption.load(device.ciphertext, `webpush:${device.id}`)),
        );
        validatePushEndpoint(subscription.endpoint);
        const saved = JSON.parse(await this.encryption.load(row.ciphertext, `webpush:${row.id}`));
        const currentSettings = await this.settings(device.userId);
        const payload = JSON.stringify({
          ...saved,
          ...privateNotification({ ...saved, kind: row.kind }, currentSettings.previews),
          kind: row.kind,
          preview: currentSettings.previews && saved.preview !== false,
          avatar: currentSettings.previews && saved.preview === true ? saved.avatar : undefined,
        });
        // Standard encrypted Web Push. Provider errors are never logged with endpoint/payload.
        await this.sender(subscription, payload, this.config!);
        await finish();
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await this.db.$executeRaw`DELETE FROM web_push_devices WHERE id = ${device.id}`;
        } else if ((status === 0 || status === 429 || status >= 500) && row.attempts < 4) {
          await this.db.$executeRaw`UPDATE web_push_deliveries SET "leaseUntil" = NULL,
            "dueAt" = ${new Date(Date.now() + [0, 10_000, 60_000, 120_000][row.attempts]!)} WHERE id = ${id}`;
        } else {
          await finish();
        }
      }
    });
  }
  private async validDelivery(row: Delivery, device: Device) {
    const session = await this.db.session.findFirst({
      where: { id: device.sessionId, userId: device.userId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session || !notificationAllowed(await this.settings(device.userId), row.botId, row.kind))
      return false;
    const run = await this.db.run.findFirst({
      where: { id: row.runId, userId: device.userId, botId: row.botId, spaceId: row.spaceId },
      select: {
        status: true,
        updatedAt: true,
        thread: { select: { unread: true, groupId: true } },
        bot: { select: { notifyOnFinish: true, archivedAt: true } },
        space: {
          select: { memberships: { where: { userId: device.userId }, select: { userId: true } } },
        },
      },
    });
    if (
      !run ||
      !run.space.memberships.length ||
      run.bot.archivedAt ||
      (!run.bot.notifyOnFinish && !run.thread.groupId) ||
      !run.thread.unread
    )
      return false;
    if (row.kind === "help" || row.kind === "takeover") {
      return (
        run.status === (row.kind === "takeover" ? "waiting_takeover" : "waiting_input") &&
        (await this.notificationEvent(row.runId, row.kind))?.id === row.eventId
      );
    }
    return row.kind === "completion" ? run.status === "completed" : run.status === "failed";
  }
  private notificationEvent(runId: string, kind: NotificationMessage["kind"]) {
    const type = { help: "run.waiting_input", takeover: "computer.takeover.requested", completion: "run.completed", failure: "run.failed" }[kind];
    return this.db.event.findFirst({ where: { runId, type }, orderBy: { seq: "desc" }, select: { id: true, createdAt: true } });
  }
  private async seal(value: string, id: string, userId: string) {
    return (
      await this.encryption.put(
        value,
        {
          operationId: "webpush",
          traceId: "webpush",
          userId,
          spaceId: "",
          signal: new AbortController().signal,
        },
        { recordId: `webpush:${id}` },
      )
    ).ciphertext;
  }
}

/** Shared policy, while retaining native delivery acceptance and receipt semantics. */
export function notificationChannels(
  native: NotificationProvider,
  web: WebPushService,
): NotificationProvider {
  const legacy = async (
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<"delivered" | "undeliverable"> => {
    if (native.deliver) return native.deliver(message, context);
    await native.send(message, context);
    return "delivered";
  };
  const deliver = async (
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<"delivered" | "undeliverable"> => {
    const outcomes = await Promise.allSettled([
      legacy(message, context),
      web.enqueue(message, context),
    ]);
    const accepted =
      (outcomes[0]?.status === "fulfilled" && outcomes[0].value === "delivered") ||
      (outcomes[1]?.status === "fulfilled" && Number(outcomes[1].value) > 0);
    if (accepted) return "delivered";
    if (outcomes.some((result) => result.status === "rejected"))
      throw new Error("Notification channels unavailable");
    return "undeliverable";
  };
  return {
    describe: () => native.describe(),
    deliver,
    async hasPushRecipient(userId) {
      return Boolean(await native.hasPushRecipient?.(userId)) || (await web.hasRecipient(userId));
    },
    async send(message, context) {
      await deliver(message, context);
    },
  };
}
