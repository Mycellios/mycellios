import { createHash, randomUUID } from "node:crypto";
import type {
  AdapterContext,
  JobPublisher,
  NotificationDismissal,
  NotificationMessage,
  NotificationProvider,
} from "@mycellios/adapter-kit";
import {
  NotificationSettingsSchema,
  notificationAllowed,
  isTaskConversation,
  notificationBaseKind,
  validNotificationPause,
  WebPushSubscriptionSchema,
} from "@mycellios/contracts";
import type { NotificationKind, NotificationSettings, WebPushSubscription } from "@mycellios/contracts";
import { micoAvatarShape, parseBotAvatarValue } from "@mycellios/contracts";
import { currentMicoAvatarValue } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import { runAsSystem } from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
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

/** Fixed copy for hidden previews: no Mico, group or conversation name and no message text. */
const HIDDEN_PREVIEW_BODY: Record<NotificationKind, string> = {
  completion: "Your Mico has finished. Open the chat to see the result.",
  failure: "Your Mico needs attention. Open the chat for details.",
  help: "Your Mico needs your answer.",
  takeover: "Your Mico needs you to continue.",
  not_started: "A message or routine could not start. Open the chat for details.",
  helper_failed: "A helper or teammate could not finish its part. Open the chat for details.",
  usage_limit: "Your Mico stopped at a usage limit. Open the chat for details.",
  sign_in: "Your Mico needs you to sign in to its provider again or reconnect it.",
};

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
    body: previews ? clean(message.body, 200) : HIDDEN_PREVIEW_BODY[message.kind],
  };
}

/** Apple requires every Web Push to show a notice, so a silent close is never sent there. */
export function silentPushAllowed(endpoint: string): boolean {
  return !new URL(endpoint).hostname.toLowerCase().endsWith(".push.apple.com");
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
  /** A notice kind, or "dismiss" for a request answered elsewhere. */
  kind: NotificationKind | "dismiss";
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
const REQUEST_KINDS = new Set<NotificationKind>(["help", "takeover"]);
/** Kinds whose run ended failed; the later ones only refine why. */
const FAILED_RUN_KINDS = new Set<NotificationKind>(["failure", "not_started", "usage_limit", "sign_in"]);

/** Durable registrations and outbox; queue payloads contain IDs, never endpoints or chat text. */
export class WebPushService {
  private readonly encryption: EncryptedSecretStore;
  private timer?: ReturnType<typeof setInterval>;
  private nativeDismiss?: (request: NotificationDismissal) => Promise<void>;
  constructor(
    private readonly db: PrismaClient,
    encryptionKey: string,
    private readonly jobs: JobPublisher,
    readonly config?: VapidConfig,
    private readonly sender: Sender = send,
  ) {
    this.encryption = new EncryptedSecretStore(encryptionKey);
  }

  /** Native channels close their copy of an answered request through this hook. */
  useNativeDismiss(dismiss: (request: NotificationDismissal) => Promise<void>) {
    this.nativeDismiss = dismiss;
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
    if (!validNotificationPause(settings.mutedUntil)) {
      throw new Error("Notification pause must be within seven days or until turned back on");
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
        WHERE id = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > (now() AT TIME ZONE 'UTC') FOR UPDATE`;
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
        WHERE id = ${nextSessionId} AND "userId" = ${userId} AND "expiresAt" > (now() AT TIME ZONE 'UTC') FOR UPDATE`
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
        WHERE id = ${sessionId} AND "userId" = ${userId} AND "expiresAt" > (now() AT TIME ZONE 'UTC')
      ON CONFLICT ("userId", "sessionId", "clientId") DO UPDATE SET "focusedUntil" = EXCLUDED."focusedUntil"`);
  }

  /**
   * Executor notices: completed and failed runs (with refined failure kinds), helpers or
   * teammates that failed, questions, approvals and takeovers.
   */
  async enqueue(message: NotificationMessage, context: AdapterContext) {
    const runId = message.taskReminder ? `task-reminder:${message.taskReminder.id}` : context.runId;
    if (!this.config || !runId || (message.taskReminder && (!Number.isFinite(Date.parse(message.taskReminder.at)) || Date.parse(message.taskReminder.at)>Date.now()))) return 0;
    const settings = await this.settings(context.userId);
    if (!notificationAllowed(settings, message.botId, message.kind, Date.now(), { taskConversation: message.taskConversation })) return 0;
    return system(async () => {
      const reminder = message.taskReminder ? await this.db.inboxTask.findFirst({
        where:{id:message.taskReminder.id,userId:context.userId,spaceId:context.spaceId,botId:message.botId,threadId:message.threadId,
          thread:{archivedAt:null,deleteAfter:null},remindAt:new Date(message.taskReminder.at),bot:{archivedAt:null},
          space:{memberships:{some:{userId:context.userId}}}},
        select:{bot:{select:{name:true,color:true}},thread:{select:{group:{select:{name:true}}}}},
      }) : null;
      const run = message.taskReminder ? reminder : await this.db.run.findFirst({
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
      const event = message.taskReminder ? {id:message.taskReminder.at,createdAt:new Date()} : await this.notificationEvent(runId, message.kind);
      if (!event || event.createdAt.getTime() < Date.now() - 300_000) return 0;
      const expiresAt = event.createdAt.getTime() + 300_000;
      const eventKey = message.taskReminder ? `${runId}:${event.id}` : event.id;
      const name = run.thread.group?.name ?? run.bot.name;
      const appearance = parseBotAvatarValue(currentMicoAvatarValue(run.bot.color, message.botId));
      const art = settings.previews && !message.groupId && appearance.kind === "shape"
        ? micoAvatarShape(appearance.shapeIndex)
        : undefined;
      // Original installed workers validate avatar against their fixed 12-icon list.
      // They ignore avatarArt and render the mushroom fallback for later shapes.
      const legacyArt = art && art.index < 1012;
      const devices = await this.db.$queryRaw<
        Device[]
      >`SELECT * FROM web_push_devices WHERE "userId" = ${context.userId}`;
      for (const device of devices) {
        const id = randomUUID();
        const payload = {
          version: 1,
          id: eventKey,
          accountId: context.userId,
          ...privateNotification({ ...message, title: message.taskReminder ? message.title : name }, settings.previews),
          ...transportKind(message.kind),
          preview: settings.previews,
          avatar: legacyArt ? art.id : undefined,
          avatarArt: art && !legacyArt ? art.id : undefined,
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
          VALUES (${id}, ${device.id}, ${eventKey}, ${ciphertext}, ${context.spaceId}, ${message.botId}, ${runId}, ${message.kind}, ${event.id}, ${new Date(Date.now() + 3_000).toISOString()}::timestamptz, ${new Date(expiresAt).toISOString()}::timestamptz)
          ON CONFLICT ("deviceId", "eventKey") DO NOTHING`;
      }
      await this.drain();
      return devices.length;
    });
  }

  /** The waiting event a question or takeover notice is about; none for other kinds. */
  async requestEvent(message: NotificationMessage, context: AdapterContext) {
    if (message.taskReminder || !context.runId || !REQUEST_KINDS.has(message.kind)) return undefined;
    const runId = context.runId;
    return system(async () => (await this.notificationEvent(runId, message.kind))?.id);
  }
  /** Remember a request notice that reached a channel, so its answer can close it elsewhere. */
  async recordRequest(message: NotificationMessage, context: AdapterContext) {
    if (message.taskReminder || !context.runId || !message.requestId || !REQUEST_KINDS.has(message.kind)) return;
    await system(() => this.db.$executeRaw`INSERT INTO notification_requests
      (id, "userId", "spaceId", "botId", "threadId", "runId", "eventId", kind)
      VALUES (${randomUUID()}, ${context.userId}, ${context.spaceId}, ${message.botId}, ${message.threadId}, ${context.runId}, ${message.requestId}, ${message.kind})
      ON CONFLICT ("runId", "eventId") DO NOTHING`);
  }

  /**
   * Requests whose run no longer waits on them were answered, retired or stopped. Each one is
   * claimed once across processes, then closed on the devices that showed it.
   */
  async resolveRequests() {
    return system(async () => {
      await this.db.$executeRaw`DELETE FROM notification_requests WHERE "createdAt" < now() - interval '2 days'`;
      const resolved = await this.db.$queryRaw<
        Array<NotificationDismissal & { runId: string }>
      >`UPDATE notification_requests q SET "resolvedAt" = now()
        WHERE q.id IN (
          SELECT o.id FROM notification_requests o LEFT JOIN runs r ON r.id = o."runId"
          WHERE o."resolvedAt" IS NULL AND o."createdAt" > now() - interval '1 day'
            AND (r.id IS NULL OR r.status <> CASE WHEN o.kind = 'takeover' THEN 'waiting_takeover' ELSE 'waiting_input' END)
          ORDER BY o."createdAt" LIMIT 100 FOR UPDATE OF o SKIP LOCKED)
        RETURNING q."userId", q."spaceId", q."botId", q."threadId", q."runId", q."eventId" AS "requestId"`;
      for (const request of resolved) {
        await this.queueDismissals(request).catch(() => getLogger().warn("Web Push dismissal unavailable"));
        await this.nativeDismiss?.(request).catch(() => getLogger().warn("Native notification dismissal unavailable"));
      }
      return resolved.length;
    });
  }
  /** Only devices whose push service accepted the request notice receive a close message. */
  private async queueDismissals(request: NotificationDismissal & { runId: string }) {
    if (!this.config) return;
    const devices = await this.db.$queryRaw<Array<{ deviceId: string }>>`SELECT DISTINCT d."deviceId"
      FROM web_push_deliveries d JOIN web_push_devices v ON v.id = d."deviceId"
      WHERE d."eventKey" = ${request.requestId} AND d."sentAt" IS NOT NULL AND v."userId" = ${request.userId}`;
    const expiresAt = Date.now() + 300_000;
    for (const { deviceId } of devices) {
      const id = randomUUID();
      const payload = {
        version: 2,
        type: "dismiss",
        id: `dismiss:${request.requestId}`,
        accountId: request.userId,
        notice: request.requestId,
        threadId: request.threadId,
        expiresAt,
      };
      const ciphertext = await this.seal(JSON.stringify(payload), id, request.userId);
      await this.db.$executeRaw`INSERT INTO web_push_deliveries
        (id, "deviceId", "eventKey", ciphertext, "spaceId", "botId", "runId", kind, "eventId", "dueAt", "expiresAt")
        VALUES (${id}, ${deviceId}, ${`dismiss:${request.requestId}`}, ${ciphertext}, ${request.spaceId}, ${request.botId}, ${request.runId}, 'dismiss', ${request.requestId}, now(), ${new Date(expiresAt).toISOString()}::timestamptz)
        ON CONFLICT ("deviceId", "eventKey") DO NOTHING`;
    }
    if (devices.length) await this.drain();
  }

  /** Repair the commit/enqueue gap and expired worker leases without replaying tools. */
  async drain() {
    if (!this.config) return;
    await system(async () => {
      await this.db.$executeRaw`DELETE FROM web_push_presence WHERE "focusedUntil" < now() - interval '1 minute'`;
      await this.db
        .$executeRaw`DELETE FROM web_push_deliveries WHERE "expiresAt" < now() - interval '1 day'`;
      await this.db.$executeRaw`DELETE FROM web_push_devices d WHERE NOT EXISTS
        (SELECT 1 FROM "session" s WHERE s.id = d."sessionId" AND s."userId" = d."userId" AND s."expiresAt" > (now() AT TIME ZONE 'UTC'))`;
      const rows = await this.db.$queryRaw<
        Array<{ id: string; dueAtMs: string }>
      >`SELECT id, (extract(epoch FROM "dueAt")*1000)::text AS "dueAtMs" FROM web_push_deliveries
        WHERE "finishedAt" IS NULL AND "expiresAt" > now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        ORDER BY "dueAt" LIMIT 100`;
      for (const row of rows)
        await this.jobs.enqueue({
          name: "webpush.deliver",
          payload: { id: row.id },
          availableAt: new Date(Number(row.dueAtMs)),
          replaceKey: `webpush:${row.id}`,
          keepExisting: true,
          maxAttempts: 5,
        });
    });
  }
  start() {
    if ((!this.config && !this.nativeDismiss) || this.timer) return;
    const tick = () => {
      void this.drain().catch(() => getLogger().warn("Web Push outbox unavailable"));
      void this.resolveRequests().catch(() => getLogger().warn("Notification request sweep unavailable"));
    };
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
        WHERE p."userId" = ${userId} AND p."focusedUntil" > now() AND s."expiresAt" > (now() AT TIME ZONE 'UTC') LIMIT 1`;
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
        WHERE d."userId" = ${userId} AND s."expiresAt" > (now() AT TIME ZONE 'UTC') LIMIT 1`;
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
      const dismissal = row.kind === "dismiss";
      if (!device || !(await (dismissal ? this.liveSession(device) : this.validDelivery(row, device)))) {
        await finish();
        return;
      }
      // Active clients suppress all devices, not just the one displaying the conversation.
      // Closing an answered request is not a new alert, so it is never held.
      if (!dismissal && (await this.anyFocused(device.userId))) {
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
        let payload: string;
        if (row.kind === "dismiss") {
          if (!silentPushAllowed(subscription.endpoint)) {
            await finish();
            return;
          }
          payload = JSON.stringify(saved);
        } else {
          const currentSettings = await this.settings(device.userId);
          payload = JSON.stringify({
            ...saved,
            ...privateNotification({ ...saved, kind: row.kind }, currentSettings.previews),
            ...transportKind(row.kind),
            preview: currentSettings.previews && saved.preview !== false,
            avatar: currentSettings.previews && saved.preview === true ? saved.avatar : undefined,
            avatarArt: currentSettings.previews && saved.preview === true ? saved.avatarArt : undefined,
          });
        }
        // Standard encrypted Web Push. Provider errors are never logged with endpoint/payload.
        await this.sender(subscription, payload, this.config!);
        await this.db
          .$executeRaw`UPDATE web_push_deliveries SET "finishedAt" = now(), "sentAt" = now(), "leaseUntil" = NULL WHERE id = ${id}`;
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (status === 404 || status === 410) {
          await this.db.$executeRaw`DELETE FROM web_push_devices WHERE id = ${device.id}`;
        } else if ((status === 0 || status === 429 || status >= 500) && row.attempts < 4) {
          await this.db.$executeRaw`UPDATE web_push_deliveries SET "leaseUntil" = NULL,
            "dueAt" = ${new Date(Date.now() + [0, 10_000, 60_000, 120_000][row.attempts]!).toISOString()}::timestamptz WHERE id = ${id}`;
        } else {
          await finish();
        }
      }
    });
  }
  private async liveSession(device: Device) {
    return Boolean(await this.db.session.findFirst({
      where: { id: device.sessionId, userId: device.userId, expiresAt: { gt: new Date() } },
      select: { id: true },
    }));
  }
  private async validDelivery(row: Delivery, device: Device) {
    if (row.kind === "dismiss" || !(await this.liveSession(device))) return false;
    if(row.runId.startsWith("task-reminder:")) {
      if (!notificationAllowed(await this.settings(device.userId), row.botId, row.kind)) return false;
      return Boolean(await this.db.inboxTask.findFirst({where:{
        id:row.runId.slice("task-reminder:".length),userId:device.userId,spaceId:row.spaceId,botId:row.botId,
        thread:{archivedAt:null,deleteAfter:null},remindAt:new Date(row.eventId),bot:{archivedAt:null},
        space:{memberships:{some:{userId:device.userId}}},
      },select:{id:true}}));
    }
    const run = await this.db.run.findFirst({
      where: { id: row.runId, userId: device.userId, botId: row.botId, spaceId: row.spaceId },
      select: {
        status: true,
        updatedAt: true,
        thread: { select: { unread: true, groupId: true, taskBotId: true, taskKey: true } },
        bot: { select: { notifyOnFinish: true, archivedAt: true } },
        space: {
          select: { memberships: { where: { userId: device.userId }, select: { userId: true } } },
        },
      },
    });
    if (
      !run ||
      !notificationAllowed(await this.settings(device.userId), row.botId, row.kind, Date.now(), {
        taskConversation: isTaskConversation(run.thread, row.botId),
      }) ||
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
    // A helper can fail while its turn keeps working; its card is the unread message.
    if (row.kind === "helper_failed") return true;
    return row.kind === "completion" ? run.status === "completed" : FAILED_RUN_KINDS.has(row.kind) && run.status === "failed";
  }
  private notificationEvent(runId: string, kind: NotificationKind) {
    const types =
      kind === "help" ? ["run.waiting_input"]
      : kind === "takeover" ? ["computer.takeover.requested"]
      : kind === "completion" ? ["run.completed"]
      : kind === "helper_failed" ? ["thread.subagent", "run.failed"]
      : ["run.failed"];
    return this.db.event.findFirst({ where: { runId, type: { in: types } }, orderBy: { seq: "desc" }, select: { id: true, createdAt: true } });
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

/** Older installed workers accept only the original four kinds; the refinement rides beside them. */
function transportKind(kind: NotificationKind) {
  const base = notificationBaseKind(kind);
  return { kind: base, detail: base === kind ? undefined : kind };
}

/** Shared policy, while retaining native delivery acceptance and receipt semantics. */
export function notificationChannels(
  native: NotificationProvider,
  web: WebPushService,
): NotificationProvider {
  if (native.dismiss) web.useNativeDismiss((request) => native.dismiss!(request));
  const legacy = async (
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<"delivered" | "undeliverable"> => {
    const settings = await web.settings(context.userId);
    if (!notificationAllowed(settings, message.botId, message.kind, Date.now(), { taskConversation: message.taskConversation })) return "undeliverable";
    const safeMessage = { ...message, ...privateNotification(message, settings.previews) };
    if (native.deliver) return native.deliver(safeMessage, context);
    await native.send(safeMessage, context);
    return "delivered";
  };
  const deliver = async (
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<"delivered" | "undeliverable"> => {
    // A request notice names its waiting event so an answer on any device can close it.
    const requestId = REQUEST_KINDS.has(message.kind)
      ? await web.requestEvent(message, context).catch(() => undefined)
      : undefined;
    const notice = requestId ? { ...message, requestId } : message;
    const outcomes = await Promise.allSettled([
      legacy(notice, context),
      web.enqueue(notice, context),
    ]);
    const accepted =
      (outcomes[0]?.status === "fulfilled" && outcomes[0].value === "delivered") ||
      (outcomes[1]?.status === "fulfilled" && Number(outcomes[1].value) > 0);
    if (accepted) {
      if (requestId)
        await web.recordRequest(notice, context).catch(() => getLogger().warn("Notification request record unavailable"));
      return "delivered";
    }
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
    async dismiss(request) {
      await native.dismiss?.(request);
    },
  };
}
