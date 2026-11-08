import { useEffect } from "react";
import { rpc } from "./rpc";

const CLIENT_KEY = "mycellios:notification-device";
const OWNER_KEY = "mycellios:notification-owner";
export function notificationClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}
export function pushSupported() {
  return (
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext
  );
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
  const found = await navigator.serviceWorker.getRegistration(
    new URL(import.meta.env.BASE_URL, location.href),
  );
  if (!found?.active) throw new Error("Reload Mycellios to finish preparing notifications.");
  return found;
}
export async function enableWebPush(publicKey: string, accountId: string) {
  if (!pushSupported())
    throw new Error(
      "Install Mycellios on your Home Screen to enable notifications on iPhone or iPad.",
    );
  // Must happen directly inside the click gesture, before RPC or Service Worker awaits.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Allow notifications in your browser settings, then try again.");
  const worker = await registration();
  const clientId = notificationClientId();
  let subscription = await worker.pushManager.getSubscription();
  const previousOwner = localStorage.getItem(OWNER_KEY);
  if (subscription && previousOwner && previousOwner !== accountId) {
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
    await rpc.notifications.webRegister({
      clientId,
      subscription: subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      },
    });
    worker.active?.postMessage({ type: "mycellios:push-binding", accountId });
    localStorage.setItem(OWNER_KEY, accountId);
    window.dispatchEvent(new Event("mycellios:notifications-changed"));
  } catch (error) {
    // Do not leave an unowned subscription attached to a failed registration.
    await subscription.unsubscribe();
    throw error;
  }
}
export async function disableWebPush() {
  await rpc.notifications.webUnregister({ clientId: notificationClientId() });
  await clearWebPushBinding();
  window.dispatchEvent(new Event("mycellios:notifications-changed"));
}

async function clearWebPushBinding() {
  localStorage.removeItem(OWNER_KEY);
  const worker = await registration();
  worker.active?.postMessage({ type: "mycellios:push-binding", accountId: null });
  await (await worker.pushManager.getSubscription())?.unsubscribe();
}
let serverDelivery = false;
export function usesServerPush() {
  return serverDelivery;
}

export function useWebPushPresence(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== userId) void clearWebPushBinding().catch(() => undefined);
    let disposed = false;
    let configured = false;
    const clientId = notificationClientId();
    const heartbeat = () => {
      if (!configured) return;
      const focused = document.visibilityState === "visible" && document.hasFocus();
      void rpc.notifications.webPresence({ clientId, focused }).catch(() => undefined);
    };
    const refresh = async () => {
      try {
        const state = await rpc.notifications.webStatus({ clientId });
        if (disposed) return;
        configured = state.configured;
        serverDelivery = configured && state.registered && pushSupported() && Notification.permission === "granted"
          && localStorage.getItem(OWNER_KEY) === userId;
        heartbeat();
      } catch { /* Older API: retain local delivery. */ }
    };
    void refresh();
    const timer = window.setInterval(heartbeat, 20_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
    window.addEventListener("mycellios:notifications-changed", refresh);
    return () => {
      disposed = true;
      serverDelivery = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", heartbeat);
      document.removeEventListener("visibilitychange", heartbeat);
      window.removeEventListener("mycellios:notifications-changed", refresh);
      if (configured)
        void rpc.notifications.webPresence({ clientId, focused: false }).catch(() => undefined);
    };
  }, [userId]);
}
