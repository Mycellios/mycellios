import { isAndroidHost } from "./android-host";
import { desktopBridge } from "./desktop";

/**
 * Registration-free guest chat (specs/guest-chat/spec.md). Only an ordinary browser tab on
 * the bare Agent entry may use it; its cookie is scoped by the coordinator to the guest routes.
 */
export type GuestMessage = { role: "user" | "assistant"; content: string };
export type GuestLimits = { messagesPerSession: number; messageChars: number; historyMessages: number; historyBytes: number };
export type GuestConfig = { enabled: false } | {
  enabled: true; limits: GuestLimits; challenge: { token: string; difficulty: number; expiresAt: number };
};
export type GuestStatus = { remaining: number; limit: number; expiresAt: number };
export type GuestResult = { status: "completed" | "pending"; content?: string; truncated?: boolean; remaining: number };
export type GuestPending = { key: string; messages: GuestMessage[] };

export class GuestChatRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}

const BASE = "/mobile/v1/guest";
/** Three missed coordinator heartbeats. */
export const GUEST_IDLE_MS = 30_000;
const NONCE_KEY = "mycellios:guest:nonce";
const CHAT_KEY = "mycellios:guest:chat";
let memoryNonce: string | undefined;

type HostWindow = Pick<Window, "matchMedia" | "location"> & {
  ReactNativeWebView?: unknown; navigator?: Navigator & { standalone?: boolean };
};

/** Desktop, the Android host, native WebViews and installed PWAs keep requiring sign-in. */
export function guestChatEligible(host: HostWindow = window): boolean {
  try {
    if (desktopBridge(host as Window) || isAndroidHost() || host.ReactNativeWebView) return false;
    if (host.matchMedia?.("(display-mode: standalone)").matches) return false;
    if ((host.navigator ?? (navigator as Navigator & { standalone?: boolean })).standalone === true) return false;
    return true;
  } catch { return false; }
}

/** Only the bare entry: deep links (?task=, ?inbox=, ?settings=, …) keep the sign-in redirect. */
export function isGuestEntry(search: string): boolean {
  return search === "" || search === "?";
}

function browserNonce(): string {
  let value = memoryNonce;
  try { value ??= localStorage.getItem(NONCE_KEY) ?? undefined; } catch { /* Restricted storage keeps a memory nonce. */ }
  if (!value || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    try { localStorage.setItem(NONCE_KEY, value); } catch { /* Memory fallback. */ }
  }
  memoryNonce = value;
  return value;
}
function forgetNonce() {
  memoryNonce = undefined;
  try { localStorage.removeItem(NONCE_KEY); } catch { /* Nothing stored. */ }
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Finds the signed challenge's proof of work in small batches, so the page stays responsive. */
export async function solveChallenge(token: string, difficulty: number, signal?: AbortSignal): Promise<string> {
  const encoder = new TextEncoder();
  for (let start = 0; start < 50_000_000; start += 512) {
    signal?.throwIfAborted();
    const digests = await Promise.all(Array.from({ length: 512 }, (_, offset) =>
      crypto.subtle.digest("SHA-256", encoder.encode(token + ":" + (start + offset)))));
    const found = digests.findIndex(digest => leadingZeroBits(new Uint8Array(digest)) >= difficulty);
    if (found >= 0) return String(start + found);
  }
  throw new GuestChatRequestError("guest_challenge_invalid");
}

/** Bounded recent history the server accepts; the newest messages win. */
export function guestHistory(messages: GuestMessage[], limits: GuestLimits): GuestMessage[] {
  const recent = messages.slice(-limits.historyMessages);
  while (recent.length > 1 && (new TextEncoder().encode(JSON.stringify(recent)).length > limits.historyBytes
    || recent[0]!.role !== "user")) recent.shift();
  return recent;
}

/** Generated output must not load remote images: keep only their alternative text. */
export function withoutImages(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt)
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_match, alt: string) => alt)
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, "");
}

async function read<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, { credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000), ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  if (!response.ok) throw new GuestChatRequestError(value?.error?.code ?? "guest_temporarily_unavailable");
  return value as T;
}

export const guestApi = {
  config: () => read<GuestConfig>("/config"),
  async status(): Promise<GuestStatus | null> {
    try { return await read<GuestStatus>("/session"); }
    catch (error) {
      if (error instanceof GuestChatRequestError && error.code === "guest_session_expired") forgetNonce();
      if (error instanceof GuestChatRequestError && ["guest_session_required", "guest_session_expired"].includes(error.code)) return null;
      throw error;
    }
  },
  /** Solves a fresh challenge and creates (or resumes, for this browser) a guest session. */
  async enter(signal?: AbortSignal): Promise<GuestStatus> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const config = await read<GuestConfig>("/config", { signal });
      if (!config.enabled) throw new GuestChatRequestError("guest_chat_unavailable");
      const solution = await solveChallenge(config.challenge.token, config.challenge.difficulty, signal);
      try {
        return await read<GuestStatus>("/session", { method: "POST", signal, body: JSON.stringify({
          nonce: browserNonce(), challenge: config.challenge.token, solution }) });
      } catch (error) {
        // An expired earlier session keeps its nonce; start a new one once.
        if (attempt === 0 && error instanceof GuestChatRequestError && error.code === "guest_session_expired") { forgetNonce(); continue; }
        throw error;
      }
    }
    throw new GuestChatRequestError("guest_session_expired");
  },
  async chat(input: GuestPending, onText: (text: string) => void, signal: AbortSignal, idleMs = GUEST_IDLE_MS): Promise<GuestResult> {
    // The coordinator writes a heartbeat every 10 s while the answer is prepared; silence longer than
    // idleMs means the connection is gone, and the turn ends with a retryable error instead of hanging.
    const idle = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; idle.abort(); }, idleMs); };
    // AbortSignal.any is missing in browsers before Safari 17.4; link the two by hand.
    const onAbort = () => idle.abort();
    if (signal.aborted) idle.abort(); else signal.addEventListener("abort", onAbort, { once: true });
    const linked = idle.signal;
    touch();
    try {
      return await this.stream(input, onText, linked, touch);
    } catch (error) {
      if (timedOut && !signal.aborted) throw new GuestChatRequestError("guest_answer_timeout");
      if (!signal.aborted && !(error instanceof GuestChatRequestError)) throw new GuestChatRequestError("guest_connection_lost");
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
  },
  async stream(input: GuestPending, onText: (text: string) => void, signal: AbortSignal, touch: () => void): Promise<GuestResult> {
    const response = await fetch(BASE + "/chat", { method: "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", signal, headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(input) });
    touch();
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
      if (value?.error?.code === "guest_session_expired") forgetNonce();
      throw new GuestChatRequestError(value?.error?.code ?? "guest_temporarily_unavailable");
    }
    if (!response.body) throw new GuestChatRequestError("guest_temporarily_unavailable");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", text = "", bytes = 0, result: GuestResult | undefined;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        touch();
        bytes += chunk.value.length; if (bytes > 1_048_576) throw new GuestChatRequestError("guest_temporarily_unavailable");
        buffer += decoder.decode(chunk.value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6)) as { type?: string; content?: unknown; result?: GuestResult; code?: string };
          if (event.type === "delta" && typeof event.content === "string") { text += event.content; onText(text); }
          else if (event.type === "result" && event.result) result = event.result;
          else if (event.type === "error") throw new GuestChatRequestError(event.code ?? "guest_temporarily_unavailable");
        }
      }
    } finally { reader.releaseLock(); }
    if (!result) throw new GuestChatRequestError("guest_temporarily_unavailable");
    return result;
  },
};

/** The transcript lives only in this tab: a reload keeps it, closing the tab forgets it. */
export const guestCache = {
  load(): { messages: GuestMessage[]; pending: GuestPending | null } {
    try {
      const raw = sessionStorage.getItem(CHAT_KEY);
      if (!raw || raw.length > 200_000) return { messages: [], pending: null };
      const value = JSON.parse(raw) as { messages?: unknown; pending?: unknown };
      const valid = (m: unknown): m is GuestMessage => Boolean(m) && typeof m === "object"
        && ["user", "assistant"].includes((m as GuestMessage).role) && typeof (m as GuestMessage).content === "string"
        && (m as GuestMessage).content.length <= 16_000;
      if (!Array.isArray(value.messages) || !value.messages.every(valid)) return { messages: [], pending: null };
      const pending = value.pending as GuestPending | null | undefined;
      const pendingValid = pending && typeof pending.key === "string" && /^[0-9a-f-]{36}$/i.test(pending.key)
        && Array.isArray(pending.messages) && pending.messages.length > 0 && pending.messages.every(valid);
      return { messages: value.messages.slice(-60), pending: pendingValid ? pending : null };
    } catch { return { messages: [], pending: null }; }
  },
  save(messages: GuestMessage[], pending: GuestPending | null) {
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify({ messages: messages.slice(-60), pending })); }
    catch { /* The live conversation keeps working. */ }
  },
};

// Dev only: guest state lives in this module, so an edit reloads the page instead of keeping two copies.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
