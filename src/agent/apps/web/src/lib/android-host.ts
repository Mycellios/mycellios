/** Optional, main-frame-only transport installed by the official Android container. */
type NativePort = { postMessage(message: string): void; onmessage?: (event: { data: string }) => void };
declare global { interface Window { MycelliosNative?: NativePort } }
const sessions = new Map<string, (message: NativeMessage) => void>();
type NativeMessage = { type: string; id?: string; text?: string; error?: string };
let shortcutRequested = false;
export function takeAndroidShortcut() { const pending = shortcutRequested; shortcutRequested = false; return pending; }
export function androidChatReady(ready: boolean) {
  if (isAndroidHost()) window.MycelliosNative!.postMessage(JSON.stringify({ type: ready ? "chat-ready" : "chat-not-ready" }));
}
let installed: NativePort | undefined;
export function isAndroidHost(): boolean {
  return typeof window !== "undefined" && typeof window.MycelliosNative?.postMessage === "function";
}
export type AndroidNotificationStatus = { supported: boolean; configured: boolean; permission: "default" | "denied" | "granted"; registered: boolean };
/** Tokens/cookies stay in native code; web receives only status or a bounded error. */
export function androidNotificationRequest(type: "status" | "enable" | "refresh" | "clear" | "settings" | "test" | "preferences", values: { accountId?: string; preview?: boolean; sound?: boolean; attentionOnly?: boolean; mutedUntil?: number } = {}): Promise<AndroidNotificationStatus> {
  if (!isAndroidHost()) return Promise.reject(new Error("Open the native Android app to continue."));
  installAndroidHost();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = () => { window.clearTimeout(timer); sessions.delete(id); };
    const timer = window.setTimeout(() => { finish(); reject(new Error("Android did not answer. Update the app or try again.")); }, type === "enable" ? 90_000 : 5000);
    sessions.set(id, message => {
      if (message.type !== "notification-result" && message.type !== "error") return;
      finish();
      if (typeof message.error === "string") { reject(new Error(message.error.slice(0, 300))); return; }
      try {
        const status = JSON.parse(message.text ?? "{}");
        if (["status", "enable", "refresh"].includes(type)) {
          if (!status || typeof status.supported !== "boolean" || typeof status.configured !== "boolean" ||
            typeof status.registered !== "boolean" || !["default", "denied", "granted"].includes(status.permission)) throw new Error();
          resolve({ supported: status.supported, configured: status.configured, registered: status.registered, permission: status.permission });
        } else resolve({} as AndroidNotificationStatus);
      }
      catch { reject(new Error("Android returned an invalid notification status.")); }
    });
    try { installed!.postMessage(JSON.stringify({ type: `notification-${type}`, id, ...values })); }
    catch { finish(); reject(new Error("Android notifications are unavailable.")); }
  });
}
export function installAndroidHost() {
  if (!isAndroidHost() || installed === window.MycelliosNative) return;
  installed = window.MycelliosNative;
  installed!.onmessage = event => {
    if (typeof event.data !== "string" || event.data.length > 65536) return;
    let message: NativeMessage;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message.type !== "string") return;
    if (message.type === "dictate") { shortcutRequested = true; window.dispatchEvent(new Event("mycellios:dictate")); }
    else if (typeof message.id === "string") sessions.get(message.id)?.(message);
  };
  installed!.postMessage(JSON.stringify({ type: "ready" }));
}
export function startAndroidDictation(callbacks: {
  transcript: (text: string) => void; final: (text: string) => void; error: (message: string) => void;
}) {
  installAndroidHost();
  const port = installed!;
  const id = crypto.randomUUID();
  let disposed = false;
  sessions.set(id, message => {
    if (disposed) return;
    const text = typeof message.text === "string" ? message.text.slice(0, 32000) : "";
    if (message.type === "partial") callbacks.transcript(text);
    if (message.type === "final") { sessions.delete(id); callbacks.final(text); }
    if (message.type === "error") { sessions.delete(id); callbacks.error(message.error || "Could not start dictation. Try again."); }
  });
  port.postMessage(JSON.stringify({ type: "start", id, language: navigator.language }));
  return {
    finish() { if (!disposed) port.postMessage(JSON.stringify({ type: "finish", id })); },
    cancel() {
      disposed = true; sessions.delete(id);
      port.postMessage(JSON.stringify({ type: "cancel", id }));
    },
  };
}
