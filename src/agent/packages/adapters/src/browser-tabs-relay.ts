import { createHmac, randomUUID } from "node:crypto";
import { getLogger } from "@mycellios/logging";
import type {
  BrowserTabsCapabilities,
  BrowserTabsOperation,
  BrowserTabsOwner,
  BrowserTabsRequest,
  BrowserTabsResult,
} from "../../../../contracts/browser-tabs-bridge.js";
import { signDesktopRelay, verifyDesktopRelay } from "./desktop-relay.js";

/**
 * Chrome tab sharing (specs/agent-chrome-tabs). The Mycellios side panel of one Chrome
 * profile registers while sharing is on and long-polls for operations; the worker reaches
 * this broker through a signed internal route. One API instance owns this volatile state:
 * a restart fails in-flight operations and never replays them.
 */
// Presence outlasts a stalled API, as for the Desktop relay.
export const BROWSER_TABS_LEASE_MS = 90_000;
const POLL_WAIT_MS = 25_000;
const MAX_OPERATIONS = 4;
const OPERATION_TIMEOUT_MS = 20_000;
/** Reading a page may wait for the person to answer the site question in the panel. */
const SNAPSHOT_TIMEOUT_MS = 90_000;

export type BrowserTabsErrorCode = "chrome_not_shared" | "chrome_busy" | "chrome_uncertain";
export class BrowserTabsError extends Error {
  constructor(readonly code: BrowserTabsErrorCode, message: string, readonly status: 409 | 429 = 409) {
    super(message);
    this.name = "BrowserTabsError";
  }
}
const NOT_SHARED = "Chrome is not sharing tabs with this conversation. Ask the person to open the Mycellios side panel in Chrome and turn on Share tabs.";
const UNCERTAIN = "The Chrome connection changed while this request was in progress. Check before retrying.";

type Operation = {
  id: string;
  request: BrowserTabsRequest;
  delivered: boolean;
  resolve(result: BrowserTabsResult): void;
  reject(error: BrowserTabsError): void;
};
type Registration = {
  owner: BrowserTabsOwner;
  generation: string;
  capabilities: BrowserTabsCapabilities;
  seen: number;
  queue: Operation[];
  operations: Map<string, Operation>;
  waiter?: (operations: BrowserTabsOperation[]) => void;
};

export const browserTabsOwnerKey = (owner: BrowserTabsOwner) => JSON.stringify([owner.userId, owner.sessionKey]);

export class BrowserTabsBroker {
  private readonly registrations = new Map<string, Registration>();
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(private readonly now: () => number = Date.now) {
    this.sweep = setInterval(() => this.expire(), 15_000);
    this.sweep.unref?.();
  }

  private expire() {
    const now = this.now();
    for (const registration of [...this.registrations.values()])
      if (now - registration.seen > BROWSER_TABS_LEASE_MS) this.drop(registration, "expired");
  }

  private live(owner: BrowserTabsOwner): Registration | undefined {
    const registration = this.registrations.get(browserTabsOwnerKey(owner));
    if (!registration) return undefined;
    if (this.now() - registration.seen > BROWSER_TABS_LEASE_MS) {
      this.drop(registration, "expired");
      return undefined;
    }
    return registration;
  }

  /** Queued work never ran: settled. Delivered work may have run: uncertain, never replayed. */
  private failAll(registration: Registration) {
    for (const operation of registration.operations.values())
      operation.reject(operation.delivered
        ? new BrowserTabsError("chrome_uncertain", UNCERTAIN)
        : new BrowserTabsError("chrome_not_shared", NOT_SHARED));
    registration.operations.clear();
    registration.queue = [];
  }

  private drop(registration: Registration, reason: "expired" | "released" | "revoked" | "replaced" | "closed") {
    if (this.registrations.get(browserTabsOwnerKey(registration.owner)) === registration)
      this.registrations.delete(browserTabsOwnerKey(registration.owner));
    registration.waiter?.([]);
    registration.waiter = undefined;
    this.failAll(registration);
    if (reason !== "closed") getLogger().info("browser_tabs.registration_ended", { "browser_tabs.reason": reason });
  }

  /**
   * One panel connection per profile session. A new generation (another panel took the
   * lock, or the panel reconnected) replaces the old one; work the old one received is
   * uncertain, queued work is cancelled rather than handed to the new panel.
   */
  register(owner: BrowserTabsOwner, generation: string, capabilities: BrowserTabsCapabilities) {
    const existing = this.live(owner);
    if (existing?.generation === generation) {
      existing.seen = this.now();
      existing.capabilities = capabilities;
      return;
    }
    if (existing) this.drop(existing, "replaced");
    this.registrations.set(browserTabsOwnerKey(owner), {
      owner, generation, capabilities, seen: this.now(), queue: [], operations: new Map(),
    });
  }

  available(owner: BrowserTabsOwner, capability: keyof BrowserTabsCapabilities = "tabs") {
    return this.live(owner)?.capabilities[capability] === 1;
  }

  private current(owner: BrowserTabsOwner, generation: string) {
    const registration = this.live(owner);
    if (!registration || registration.generation !== generation) throw new BrowserTabsError("chrome_not_shared", "Tab sharing is not registered");
    registration.seen = this.now();
    return registration;
  }

  private take(registration: Registration): BrowserTabsOperation[] {
    const operations = registration.queue.splice(0);
    for (const operation of operations) operation.delivered = true;
    return operations.map(({ id, request }) => ({ id, request }));
  }

  /** Delivers queued operations, or waits for one when `wait` is set. */
  async waitPoll(owner: BrowserTabsOwner, generation: string, signal: AbortSignal, wait = false): Promise<{ operations: BrowserTabsOperation[] }> {
    const registration = this.current(owner, generation);
    if (registration.queue.length || !wait) return { operations: this.take(registration) };
    // One outstanding poll per panel; an older one returns empty.
    registration.waiter?.([]);
    return new Promise((resolve) => {
      const finish = (operations: BrowserTabsOperation[]) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        if (registration.waiter === finish) registration.waiter = undefined;
        resolve({ operations });
      };
      const timer = setTimeout(() => finish([]), POLL_WAIT_MS);
      const aborted = () => finish([]);
      signal.addEventListener("abort", aborted, { once: true });
      registration.waiter = finish;
    });
  }

  result(owner: BrowserTabsOwner, generation: string, id: string, result: BrowserTabsResult) {
    const registration = this.current(owner, generation);
    const operation = registration.operations.get(id);
    if (!operation?.delivered) throw new BrowserTabsError("chrome_not_shared", "Operation unavailable");
    registration.operations.delete(id);
    operation.resolve(result);
  }

  /** Closing the panel ends presence now. */
  release(owner: BrowserTabsOwner, generation: string) {
    const registration = this.live(owner);
    if (registration?.generation === generation) this.drop(registration, "released");
  }

  /** Stop sharing or sign-out: every generation of this session ends. */
  revoke(owner: BrowserTabsOwner) {
    const registration = this.registrations.get(browserTabsOwnerKey(owner));
    if (registration) this.drop(registration, "revoked");
  }

  dispatch(owner: BrowserTabsOwner, request: BrowserTabsRequest, signal: AbortSignal, timeoutMs = request.op === "snapshot" ? SNAPSHOT_TIMEOUT_MS : OPERATION_TIMEOUT_MS): Promise<BrowserTabsResult> {
    const registration = this.live(owner);
    if (!registration || registration.capabilities.tabs !== 1 || (request.op === "snapshot" && registration.capabilities.read !== 1))
      return Promise.reject(new BrowserTabsError("chrome_not_shared", NOT_SHARED));
    // One operation per tab: a second read of the same tab waits for the person's first answer.
    if (request.op === "snapshot" && [...registration.operations.values()].some(item => item.request.op === "snapshot" && item.request.tab === request.tab))
      return Promise.reject(new BrowserTabsError("chrome_busy", "This tab is already being read. Wait for that result.", 429));
    if (registration.operations.size >= MAX_OPERATIONS)
      return Promise.reject(new BrowserTabsError("chrome_busy", "Chrome is busy with other requests. Try again in a moment.", 429));
    return new Promise<BrowserTabsResult>((resolve, reject) => {
      const id = randomUUID();
      const settle = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        registration.operations.delete(id);
        registration.queue = registration.queue.filter(item => item.id !== id);
      };
      const operation: Operation = {
        id, request, delivered: false,
        resolve: (result) => { settle(); resolve(result); },
        reject: (error) => { settle(); reject(error); },
      };
      const expire = () => operation.reject(operation.delivered
        ? new BrowserTabsError("chrome_uncertain", UNCERTAIN)
        : new BrowserTabsError("chrome_not_shared", NOT_SHARED));
      const timer = setTimeout(expire, timeoutMs);
      const aborted = () => expire();
      signal.addEventListener("abort", aborted, { once: true });
      registration.operations.set(id, operation);
      registration.queue.push(operation);
      const waiter = registration.waiter;
      if (waiter) {
        registration.waiter = undefined;
        waiter(this.take(registration));
      }
    });
  }

  close() {
    clearInterval(this.sweep);
    for (const registration of [...this.registrations.values()]) this.drop(registration, "closed");
  }
}

/** The worker's HMAC key for the internal route, separate from the Desktop relay key. */
export function browserTabsKey(secret: string) {
  return createHmac("sha256", secret).update("mycellios-browser-tabs-v1").digest("hex");
}
export const signBrowserTabs = signDesktopRelay;
export const verifyBrowserTabs = verifyDesktopRelay;

export type ChromeTabsListResult =
  | { tabs: { tab: string; title: string; url: string; active: boolean; audible: boolean }[]; omitted: number }
  | { error: string; code: string };
export type ChromeSnapshotResult =
  | { page: { title: string; url: string; text: string; truncated: boolean } }
  | { error: string; code: string };
const FAILURE_TEXT: Record<string, string> = {
  tabs_permission_missing: "Chrome has not granted the tabs permission. Ask the person to turn Share tabs on again in the Mycellios side panel.",
  declined: "The person declined reading this site. Do not ask to read it again in this turn unless they say so.",
  consent_timeout: "The person did not answer the question about reading this site in the Mycellios side panel. Ask them in the chat before trying again.",
  refused_site: "This site is never read in the person's Chrome (Mycellios itself, the Chrome Web Store or a password manager).",
  not_web_page: "Only http(s) pages can be read.",
  tab_gone: "That tab is closed or not shared. Call chrome_tabs again.",
  tab_changed: "The tab moved to another site while the person answered. Call chrome_tabs again.",
  not_scriptable: "Chrome did not let the extension read this page.",
  unsupported: "The Mycellios extension in that Chrome cannot do this yet. Ask the person to update it.",
};

/** Worker side: probe and run operations for the browser that sent the owner's message. */
export function browserTabsClient(url: string, key: string) {
  const post = async (payload: Record<string, unknown>, signal: AbortSignal) => {
    const body = JSON.stringify({ ...payload, nonce: randomUUID() });
    const timestamp = String(Date.now());
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-browser-tabs-time": timestamp, "x-browser-tabs-signature": signBrowserTabs(key, timestamp, body) },
      body, signal, redirect: "error",
    });
  };
  const operation = async (scope: BrowserTabsOwner, request: BrowserTabsRequest, signal: AbortSignal, timeoutMs: number) => {
    let response: Response;
    try {
      response = await post({ scope, request }, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5_000)]));
    } catch (error) {
      if (signal.aborted) throw error;
      return { error: UNCERTAIN, code: "chrome_uncertain" } as const;
    }
    const value = await response.json().catch(() => null) as { result?: BrowserTabsResult; error?: unknown; code?: unknown } | null;
    if (!response.ok || !value?.result) {
      const code = typeof value?.code === "string" ? value.code : "chrome_not_shared";
      return { error: typeof value?.error === "string" ? value.error : NOT_SHARED, code } as const;
    }
    const result = value.result;
    if ("error" in result) return { error: FAILURE_TEXT[result.error] ?? NOT_SHARED, code: result.error } as const;
    return result;
  };
  return {
    /** Whether that browser shares tabs now, and can read pages. No answer counts as not sharing. */
    async available(scope: BrowserTabsOwner, signal: AbortSignal): Promise<{ tabs: boolean; read: boolean }> {
      try {
        const response = await post({ scope, probe: "tabs" }, AbortSignal.any([signal, AbortSignal.timeout(1_500)]));
        if (!response.ok) {
          await response.body?.cancel();
          return { tabs: false, read: false };
        }
        const value = (await response.json()) as { available?: unknown; read?: unknown };
        return { tabs: value.available === true, read: value.available === true && value.read === true };
      } catch {
        return { tabs: false, read: false };
      }
    },
    async snapshot(scope: BrowserTabsOwner, tab: string, signal: AbortSignal): Promise<ChromeSnapshotResult> {
      const result = await operation(scope, { op: "snapshot", tab }, signal, SNAPSHOT_TIMEOUT_MS);
      if ("page" in result) return { page: result.page };
      if ("error" in result) return result;
      return { error: "Unexpected answer from Chrome.", code: "unsupported" };
    },
    async list(scope: BrowserTabsOwner, signal: AbortSignal): Promise<ChromeTabsListResult> {
      const result = await operation(scope, { op: "list" }, signal, OPERATION_TIMEOUT_MS);
      if ("tabs" in result) return result;
      if ("error" in result) return result;
      return { error: "Unexpected answer from Chrome.", code: "unsupported" };
    },
  };
}
export type BrowserTabsClient = ReturnType<typeof browserTabsClient>;
