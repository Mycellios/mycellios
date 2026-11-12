/// <reference lib="webworker" />
// Keep the classic worker self-contained and only allow artwork bundled with it.
const NOTIFICATION_AVATARS = new Set([
  "mushroom", "sprout", "branch", "node", "spore", "colony",
  "hypha", "nexus", "bridge", "loop", "crest", "weave",
]);

const NOTICE_COPY = {
  en: {
    completion: ["Reply ready", "Open the chat to read the reply."],
    failure: ["Task interrupted", "Open the chat to see what happened."],
    help: ["Your Mico needs an answer", "Open the chat to reply."],
    takeover: ["Your Mico needs your help", "Open the chat to continue."],
  },
  es: {
    completion: ["Respuesta lista", "Abre el chat para leerla."],
    failure: ["Tarea interrumpida", "Abre el chat para ver qué ha pasado."],
    help: ["Tu Mico espera una respuesta", "Abre el chat para responder."],
    takeover: ["Tu Mico necesita tu ayuda", "Abre el chat para continuar."],
  },
} as const;

/** Independent of the shell cache/update protocol. No remote URL is accepted from a push. */
type PushPayload = {
  version: 1;
  id: string;
  accountId: string;
  title: string;
  body: string;
  kind?: keyof typeof NOTICE_COPY.en;
  preview?: boolean;
  avatar?: string;
  avatarArt?: string;
  botId: string;
  threadId: string;
  spaceId: string;
  groupId?: string;
  taskThreadId?: string;
  tag: string;
  expiresAt: number;
};
const ID = /^[A-Za-z0-9_-]{1,160}$/;
export function parsePushPayload(value: unknown, now = Date.now()): PushPayload | null {
  if (!value || typeof value !== "object") return null;
  const p = { ...value } as PushPayload;
  // Already queued payloads retain their privacy/identity checks and use new art.
  const legacy: Readonly<Record<string, string>> = {
    fox: "sprout", hedgehog: "crest", frog: "nexus", moth: "branch", snail: "loop",
    owl: "spore", turtle: "colony", axolotl: "node", crab: "hypha", fish: "spore",
    octopus: "weave", raven: "bridge", hare: "sprout", otter: "colony",
  };
  if (p.avatar && Object.hasOwn(legacy, p.avatar)) p.avatar = legacy[p.avatar];
  if (p.avatarArt && Object.hasOwn(legacy, p.avatarArt)) p.avatarArt = legacy[p.avatarArt];
  if (
    p.version !== 1 ||
    ![p.accountId, p.botId, p.threadId, p.spaceId].every(
      (v) => typeof v === "string" && ID.test(v),
    ) ||
    [p.groupId, p.taskThreadId].some((id) => id !== undefined && (typeof id !== "string" || !ID.test(id))) ||
    typeof p.id !== "string" ||
    p.id.length > 400 ||
    typeof p.title !== "string" ||
    p.title.length > 100 ||
    typeof p.body !== "string" ||
    p.body.length > 200 ||
    (p.kind !== undefined && (typeof p.kind !== "string" || !Object.hasOwn(NOTICE_COPY.en, p.kind))) ||
    (p.preview !== undefined && typeof p.preview !== "boolean") ||
    [p.avatar, p.avatarArt].some((art) => art !== undefined && !NOTIFICATION_AVATARS.has(art)) ||
    p.tag !== `mycellios:${p.threadId}` ||
    !Number.isFinite(p.expiresAt) ||
    p.expiresAt <= now ||
    p.expiresAt > now + 360_000
  )
    return null;
  return p;
}

export function pushNotification(p: PushPayload, scopeUrl: string, language: string) {
  const spanish = /^es(?:-|$)/i.test(language);
  const copy = p.kind ? NOTICE_COPY[spanish ? "es" : "en"][p.kind] : undefined;
  const art = p.avatarArt ?? p.avatar;
  const avatar = p.preview && art && NOTIFICATION_AVATARS.has(art) ? art : undefined;
  return {
    title: copy && !p.preview ? copy[0] : p.title,
    options: {
      body: copy ? (p.preview && p.body.trim() ? p.body : copy[1]) : p.body,
      tag: p.tag,
      badge: new URL("mycellios/notification-badge.png", scopeUrl).href,
      icon: new URL(`mycellios/notification-micos/${avatar ?? "mushroom"}.png`, scopeUrl).href,
      actions: [{ action: "open-chat", title: spanish ? "Abrir chat" : "Open chat" }],
      data: { url: pushChatUrl(p, scopeUrl), pushAccountId: p.accountId, botId: p.botId },
    },
  };
}
export function pushChatUrl(
  p: Pick<PushPayload, "botId" | "groupId" | "spaceId" | "taskThreadId">,
  scopeUrl: string,
) {
  const url = new URL(
    p.groupId ? `app/g/${encodeURIComponent(p.groupId)}` : `app/${encodeURIComponent(p.botId)}`,
    scopeUrl,
  );
  url.searchParams.set("noticeSpace", p.spaceId);
  if (!p.groupId && p.taskThreadId) url.searchParams.set("task", p.taskThreadId);
  return url.href;
}

export function installPushWorker(scope: ServiceWorkerGlobalScope) {
  // Durable and origin-local: reject in-flight messages for a signed-out or switched account.
  const bindingCache = "mycellios-push-binding-v1";
  const bindingUrl = new URL("__push_binding", scope.registration.scope).href;
  const getAccount = async () =>
    (await (await scope.caches.open(bindingCache)).match(bindingUrl))?.text();
  scope.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "mycellios:push-binding") return;
    const source = event.source;
    if (
      !source ||
      !("url" in source) ||
      new URL(source.url).origin !== scope.location.origin ||
      !source.url.startsWith(scope.registration.scope)
    )
      return;
    event.waitUntil(
      (async () => {
        const cache = await scope.caches.open(bindingCache);
        const previous = await getAccount();
        if (typeof data.accountId === "string" && ID.test(data.accountId)) {
          await cache.put(bindingUrl, new Response(data.accountId));
        } else {
          await cache.delete(bindingUrl);
        }
        event.ports[0]?.postMessage("bound");
        if (previous !== data.accountId)
          for (const notice of await scope.registration.getNotifications()) notice.close();
        if (typeof data.botId === "string" && ID.test(data.botId)) {
          for (const notice of await scope.registration.getNotifications()) {
            if (notice.data?.botId === data.botId) notice.close();
          }
        }
        if (typeof data.threadId === "string" && ID.test(data.threadId)) {
          for (const notice of await scope.registration.getNotifications({
            tag: `mycellios:${data.threadId}`,
          }))
            notice.close();
        }
      })(),
    );
  });
  let pendingPush: Promise<void> = Promise.resolve();
  scope.addEventListener("push", (event) => {
    const delivery = pendingPush.then(async () => {
      let value: unknown;
      try {
        value = event.data?.json();
      } catch {
        return;
      }
      const p = parsePushPayload(value);
      if (!p || (await getAccount()) !== p.accountId) return;
      // Serial SW events use a persistent receipt; a restart cannot replay a delivered event.
      const receipts = await scope.caches.open("mycellios-push-receipts-v1");
      const key = new URL(`__push_receipt/${encodeURIComponent(p.id)}`, scope.registration.scope)
        .href;
      if (await receipts.match(key)) return;
      // Foreground suppression happens in the server presence hold before transport.
      const notice = pushNotification(p, scope.registration.scope, scope.navigator.language);
      await scope.registration.showNotification(notice.title, notice.options);
      await receipts.put(key, new Response(String(p.expiresAt)));
      for (const receipt of await receipts.keys()) {
        const expiry = Number(await (await receipts.match(receipt))?.text());
        if (expiry < Date.now()) await receipts.delete(receipt);
      }
    });
    pendingPush = delivery.catch(() => undefined);
    event.waitUntil(delivery);
  });
  return getAccount;
}
