import type {
  DesktopWhatsAppInbound,
  DesktopWhatsAppInboundOutcome,
  DesktopWhatsAppLinkConfig,
  DesktopWhatsAppOperation,
  DesktopWhatsAppRegister,
  DesktopWhatsAppResult,
  DesktopWhatsAppSync,
  DesktopWhatsAppUnlink,
} from "../../../../../contracts/desktop-whatsapp.js";
import {
  parseDesktopWhatsAppLinkConfig,
  parseDesktopWhatsAppOperation,
} from "../../../../../contracts/desktop-whatsapp.js";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface AccountContext {
  base: string;
  fetch: Fetch;
}

export class WhatsAppApiError extends Error {
  constructor(readonly status: number) {
    super(`WhatsApp service answered ${status}`);
  }
  /** Worth retrying: the server may not have stored the request. */
  get transient() {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

const OUTCOMES = new Set<DesktopWhatsAppInboundOutcome>([
  "accepted",
  "pending_approval",
  "ignored",
]);

/** `POST {server}/api/desktop-whatsapp/<action>` with the native session, like the Desktop relay. */
export class WhatsAppApiClient {
  constructor(private readonly context: AccountContext) {}

  get base() {
    return this.context.base;
  }

  private async post(
    action: string,
    input: unknown,
    timeoutMs = 15_000,
    signal?: AbortSignal,
    spaceId?: string,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await this.context.fetch(
      `${this.context.base}/api/desktop-whatsapp/${action}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-mycellios-desktop": "1",
          ...(spaceId ? { "x-rakazo-space-id": spaceId } : {}),
        },
        body: JSON.stringify(input),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new WhatsAppApiError(response.status);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }

  /** Signed-in account of the native session, or null when signed out. */
  async userId(): Promise<string | null> {
    const response = await this.context.fetch(`${this.context.base}/api/auth/get-session`, {
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = (await response.json().catch(() => null)) as { user?: { id?: unknown } } | null;
    const id = body?.user?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 256 ? id : null;
  }

  /** `spaceId` is the Space the owner was in when linking; the server binds the link to it. */
  async register(
    input: DesktopWhatsAppRegister,
    spaceId?: string,
  ): Promise<DesktopWhatsAppLinkConfig> {
    const body = (await this.post("register", input, 15_000, undefined, spaceId)) as {
      link?: unknown;
    };
    return parseDesktopWhatsAppLinkConfig(
      body && typeof body === "object" && "link" in body ? body.link : body,
    );
  }

  async sync(input: DesktopWhatsAppSync): Promise<DesktopWhatsAppLinkConfig[]> {
    const body = (await this.post("sync", input)) as { links?: unknown };
    if (!body || !Array.isArray(body.links) || body.links.length > 20)
      throw new Error("Invalid WhatsApp sync");
    return body.links.map(parseDesktopWhatsAppLinkConfig);
  }

  async inbound(
    input: DesktopWhatsAppInbound,
  ): Promise<Map<string, DesktopWhatsAppInboundOutcome>> {
    const body = (await this.post("inbound", input, 60_000)) as { results?: unknown };
    const results = new Map<string, DesktopWhatsAppInboundOutcome>();
    if (body && Array.isArray(body.results))
      for (const entry of body.results as Array<{ id?: unknown; outcome?: unknown }>)
        if (
          typeof entry?.id === "string" &&
          OUTCOMES.has(entry.outcome as DesktopWhatsAppInboundOutcome)
        )
          results.set(entry.id, entry.outcome as DesktopWhatsAppInboundOutcome);
    return results;
  }

  /** Claimed operations; malformed ones are returned by id so they can be reported as failed. */
  async pull(
    desktopDeviceId: string,
    signal?: AbortSignal,
  ): Promise<{ operations: DesktopWhatsAppOperation[]; invalid: string[] }> {
    const body = (await this.post("pull", { desktopDeviceId, wait: true }, 60_000, signal)) as {
      operations?: unknown;
    };
    if (!body || !Array.isArray(body.operations) || body.operations.length > 100)
      throw new Error("Invalid WhatsApp pull");
    const operations: DesktopWhatsAppOperation[] = [];
    const invalid: string[] = [];
    for (const raw of body.operations as unknown[]) {
      try {
        operations.push(parseDesktopWhatsAppOperation(raw));
      } catch {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id === "string" && id.length > 0 && id.length <= 256) invalid.push(id);
      }
    }
    return { operations, invalid };
  }

  async result(input: DesktopWhatsAppResult): Promise<void> {
    await this.post("result", input);
  }

  async unlink(input: DesktopWhatsAppUnlink): Promise<void> {
    await this.post("unlink", input);
  }
}
