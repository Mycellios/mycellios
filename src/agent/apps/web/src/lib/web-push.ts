import { rememberNotificationSettings, forgetNotificationSettings } from "./account-notifications";
import { useEffect, useRef, useState } from "react";
import { notificationPreferences, subscribeNotifications } from "./notification-preferences";
import { rpc } from "./rpc";
import { desktopBridge } from "./desktop";
import { androidNotificationRequest, isAndroidHost } from "./android-host";

const CLIENT_KEY = "mycellios:notification-device";
const OWNER_KEY = "mycellios:notification-owner";
let temporaryClientId: string | undefined;
function notificationOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}
export function notificationClientId(): string {
  try {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
  } catch { return temporaryClientId ??= crypto.randomUUID(); }
}
export function pushSupported() {
  return (
    !desktopBridge() && !isAndroidHost() &&
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext
  );
}
export function isInstalledWebApp() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function vapidBytes(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="),
  );
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
async function registration() {
  // No permission prompt, and no endless wait when a build has no active worker.
  const scope = new URL(import.meta.env.BASE_URL, location.href);
  const found = await navigator.serviceWorker.getRegistration(scope);
  if (found?.active) return found;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([navigator.serviceWorker.ready,
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 6_000); })]);
    if (ready?.active && ready.scope === scope.href) return ready;
    throw new Error("Reload Mycellios to finish preparing notifications.");
  } finally {
    clearTimeout(timeout);
  }
}

function bindAccount(worker: ServiceWorker, accountId: string | null) {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const complete = (error?: Error) => {
      window.clearTimeout(timer);
      channel.port1.close();
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(() => complete(new Error("Reload Mycellios to finish preparing notifications.")), 3000);
    channel.port1.onmessage = (event) => {
      if (event.data === "bound") complete();
    };
    try {
      worker.postMessage({ type: "mycellios:push-binding", accountId, ...(accountId ? { preferences: notificationPreferences(accountId) } : {}) }, [channel.port2]);
    } catch (error) {
      complete(error instanceof Error ? error : new Error("Could not bind notifications."));
    }
  });
}
async function registerWebPush(publicKey: string, accountId: string) {
  if (!pushSupported())
    throw new Error(
      "Install Mycellios on your Home Screen to enable notifications on iPhone or iPad.",
    );
  if (Notification.permission !== "granted")
    throw new Error("Allow notifications in your browser settings, then try again.");
  const worker = await registration();
  const clientId = notificationClientId();
  let subscription = await worker.pushManager.getSubscription();
  const previousOwner = notificationOwner();
  if (subscription && previousOwner !== accountId) {
    await subscription.unsubscribe();
    subscription = null;
  }
  const expected = vapidBytes(publicKey);
  const savedKey = subscription?.options.applicationServerKey;
  if (
    subscription &&
    (!savedKey || Array.from(new Uint8Array(savedKey)).join() !== Array.from(expected).join())
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: expected,
  });
  try {
    await bindAccount(worker.active!, accountId);
    if (!notificationPreferences(accountId).enabled) throw new Error("Notifications are disabled on this device.");
    await rpc.notifications.webRegister({
      expectedUserId: accountId,
      clientId,
      subscription: subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      },
    });
    if (!notificationPreferences(accountId).enabled) {
      await disableWebPush();
      return;
    }
    localStorage.setItem(OWNER_KEY, accountId);
    window.dispatchEvent(new Event("mycellios:notifications-changed"));
  } catch (error) {
    // Do not leave an unowned subscription attached to a failed registration.
    await clearWebPushBinding().catch(() => subscription.unsubscribe());
    throw error;
  }
}
async function disableWebPush() {
  await Promise.all([rpc.notifications.webUnregister({ clientId: notificationClientId() }), clearWebPushBinding()]);
  window.dispatchEvent(new Event("mycellios:notifications-changed"));
}

async function clearWebPushBinding() {
  try { localStorage.removeItem(OWNER_KEY); } catch { /* Worker unbinding must still happen. */ }
  const worker = await registration();
  worker.active?.postMessage({ type: "mycellios:push-binding", accountId: null });
  await (await worker.pushManager.getSubscription())?.unsubscribe();
}

/** Explicit sign-out only: closing the app must retain its background registration. */
export async function clearNotificationDevice() {
  serverDelivery = false;
  try { localStorage.removeItem(OWNER_KEY); } catch { /* Continue revoking worker/native delivery. */ }
  await desktopBridge()?.notifications?.clear().catch(() => undefined);
  if (isAndroidHost()) await androidNotificationRequest("clear").catch(() => undefined);
  if (!navigator.serviceWorker) return;
  const worker = await navigator.serviceWorker.getRegistration(new URL(import.meta.env.BASE_URL, location.href));
  if (!worker) return;
  try { if (worker.active) await bindAccount(worker.active, null); }
  finally { await (await worker.pushManager.getSubscription())?.unsubscribe(); }
}
let serverDelivery = false;
export function usesServerPush() {
  return serverDelivery;
}

const registrations = new Map<string, Promise<void>>();
let registrationQueue: Promise<void> = Promise.resolve();
export function enableWebPush(publicKey: string, accountId: string) {
  const running = registrations.get(accountId);
  if (running) return running;
  const next = registrationQueue.catch(() => undefined).then(() => registerWebPush(publicKey, accountId))
    .finally(() => registrations.delete(accountId));
  registrationQueue = next;
  registrations.set(accountId, next);
  return next;
}

export function pushEnrollmentAction(input: {
  publicKey: string | null;
  enabled: boolean;
  permission: NotificationPermission;
  registered: boolean;
  bound: boolean;
}) {
  if (!input.publicKey) return null;
  if (!input.enabled || input.permission !== "granted") return input.registered || input.bound ? "remove" : null;
  if (!input.registered || !input.bound) return "register";
  return null;
}

export function useWebPushPresence(userId?: string) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const previousUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    setPublicKey(null);
    const previous = previousUser.current;
    previousUser.current = userId;
    if (!userId) { if (previous) void clearNotificationDevice().catch(() => undefined); return; }
    if (isAndroidHost()) {
      let stopped = false;
      const sync = async () => {
        try {
          const status = await androidNotificationRequest("status", { accountId: userId });
          if (stopped) return;
          const preferences = notificationPreferences(userId);
          if (!preferences.enabled) {
            if (status.registered) {
              await androidNotificationRequest("clear", { accountId: userId });
              if (!stopped) await rpc.notifications.unregisterPush({});
            }
            return;
          }
          if (status.registered) {
            await androidNotificationRequest("preferences", { accountId: userId, ...preferences });
            if (!stopped && status.permission === "granted") await androidNotificationRequest("refresh", { accountId: userId });
          }
        } catch { /* Settings exposes configuration/permission failures; background refresh never prompts. */ }
      };
      void sync();
      const unsubscribe = subscribeNotifications(userId, () => void sync());
      const refresh = () => void sync();
      window.addEventListener("focus", refresh); window.addEventListener("mycellios:notifications-changed", refresh);
      return () => { stopped = true; unsubscribe(); window.removeEventListener("focus", refresh); window.removeEventListener("mycellios:notifications-changed", refresh); };
    }
    const owner = notificationOwner();
    const clearPreviousOwner = owner && owner !== userId ? clearWebPushBinding().catch(() => undefined) : undefined;
    let disposed = false;
    let revision = 0;
    let configured = false;
    const clientId = notificationClientId();
    const heartbeat = () => {
      if (!configured) return;
      const focused = document.visibilityState === "visible" && document.hasFocus();
      void rpc.notifications.webPresence({ clientId, focused }).catch(() => undefined);
    };
    const refresh = async () => {
      const current = ++revision;
      try {
        await clearPreviousOwner;
        if (disposed || current !== revision) return;
        const supported = pushSupported();
        const worker = supported ? await navigator.serviceWorker.getRegistration(new URL(import.meta.env.BASE_URL, location.href)) : undefined;
        if (notificationOwner() === userId && worker?.active) await bindAccount(worker.active, userId);
        if (disposed || current !== revision) return;
        const state = await rpc.notifications.webStatus({ clientId });
        if (disposed || current !== revision) return;
        rememberNotificationSettings(userId, state.settings);
        configured = state.configured;
        setPublicKey(state.publicKey);
        const subscription = await worker?.pushManager.getSubscription();
        if (disposed || current !== revision) return;
        const savedKey = subscription?.options.applicationServerKey;
        const matchesKey = state.publicKey && savedKey &&
          Array.from(new Uint8Array(savedKey)).join() === Array.from(vapidBytes(state.publicKey)).join();
        const bound = notificationOwner() === userId && Boolean(subscription && matchesKey);
        const enabled = notificationPreferences(userId).enabled;
        serverDelivery = configured && state.registered && supported && Notification.permission === "granted" && enabled && bound;
        heartbeat();
        if (!supported) return;
        const action = pushEnrollmentAction({ publicKey: state.publicKey, enabled, permission: Notification.permission,
          registered: state.registered, bound });
        if (action === "remove") await disableWebPush();
        if (action === "register" && state.publicKey) await enableWebPush(state.publicKey, userId);
      } catch { if (!disposed && current === revision) serverDelivery = false; /* Retain local delivery after a failed reconciliation. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", heartbeat);
    const onVisibility = () => document.visibilityState === "visible" ? void refresh() : heartbeat();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("mycellios:notifications-changed", refresh);
    navigator.serviceWorker?.addEventListener("controllerchange", refresh);
    const unsubscribe = subscribeNotifications(userId, refresh);
    return () => {
      disposed = true;
      forgetNotificationSettings(userId);
      serverDelivery = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("mycellios:notifications-changed", refresh);
      navigator.serviceWorker?.removeEventListener("controllerchange", refresh);
      unsubscribe();
      if (configured)
        void rpc.notifications.webPresence({ clientId, focused: false }).catch(() => undefined);
    };
  }, [userId]);
  return publicKey;
}
