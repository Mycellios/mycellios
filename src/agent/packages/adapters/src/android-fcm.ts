import { createHash, createPrivateKey, sign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AdapterContext, NotificationMessage } from "@rakazo/adapter-kit";

type Credentials = { projectId: string; clientEmail: string; privateKey: ReturnType<typeof createPrivateKey> };
export function androidFcmConfig(env: NodeJS.ProcessEnv): Credentials | undefined {
  if (!env.ANDROID_FCM_SERVICE_ACCOUNT_JSON) return undefined;
  try {
    const value = JSON.parse(env.ANDROID_FCM_SERVICE_ACCOUNT_JSON);
    if (value.type !== "service_account" || !/^[a-z][a-z0-9-]{4,62}$/.test(value.project_id) ||
      !/^[a-zA-Z0-9._-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(value.client_email)) throw new Error();
    const key = createPrivateKey(value.private_key);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    return { projectId: value.project_id, clientEmail: value.client_email, privateKey: key };
  } catch { throw new Error("Invalid Android FCM service-account configuration"); }
}

async function json(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Android push returned no response");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
      if (bytes > 64 * 1024) throw new Error("Android push response exceeded its limit"); chunks.push(next.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Android push returned an invalid response"); }
  } finally { await reader.cancel().catch(() => undefined); }
}

/** HTTP v1 only. Credentials and vendor responses are never included in logs/errors. */
export class AndroidFcm {
  private cached?: { value: string; expires: number };
  private refreshing?: Promise<string>;
  constructor(private readonly credentials: Credentials, private readonly request: typeof fetch = fetch) {}
  private token(): Promise<string> {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return Promise.resolve(this.cached.value);
    if (this.refreshing) return this.refreshing;
    const operation = this.authorize().finally(() => { this.refreshing = undefined; });
    this.refreshing = operation; return operation;
  }
  private async authorize() {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: this.credentials.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), this.credentials.privateKey).toString("base64url")}`;
    const response = await this.request("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Android push could not authenticate with Google"); }
    const body = await json(response);
    if (typeof body?.access_token !== "string" || !/^\S{1,8192}$/.test(body.access_token) ||
      !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error("Android push returned invalid authorization");
    this.cached = { value: body.access_token, expires: Date.now() + Math.min(3600, body.expires_in) * 1000 };
    return body.access_token as string;
  }
  async send(token: string, message: NotificationMessage, context: AdapterContext): Promise<"delivered" | "unregistered"> {
    const delivery = createHash("sha256").update([context.operationId, context.runId ?? "", message.threadId, message.kind].join(":" )).digest("hex");
    const data: Record<string, string> = { version: "1", deliveryId: delivery, accountId: context.userId,
      botId: message.botId, threadId: message.threadId, spaceId: context.spaceId, kind: message.kind,
      title: message.title.slice(0, 100), body: message.body.slice(0, 180), expiresAt: String(Date.now() + 300_000) };
    if (message.groupId) data.groupId = message.groupId;
    else if (message.taskThreadId) data.taskThreadId = message.taskThreadId;
    // Data-only: the native receiver must check account binding and deduplicate before displaying.
    for (let attempt = 0; attempt < 3; attempt++) {
      const accessToken = await this.token();
      let response: Response;
      try { response = await this.request(`https://fcm.googleapis.com/v1/projects/${this.credentials.projectId}/messages:send`, {
        method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15_000), context.signal]),
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { token, data, android: { priority: "high", ttl: "300s", collapse_key: createHash("sha256").update(message.threadId).digest("hex").slice(0, 32) } } }),
      }); } catch {
        if (attempt >= 2 || context.signal.aborted) throw new Error("Android push could not reach FCM");
        await delay(500 * (2 ** attempt), undefined, { signal: context.signal }); continue;
      }
      if (response.status === 401 && attempt < 2) { await response.body?.cancel(); this.cached = undefined; continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        await delay(500 * (2 ** attempt), undefined, { signal: context.signal }); continue;
      }
      const body = await json(response);
      if (response.ok && typeof body?.name === "string") return "delivered";
      const codes = Array.isArray(body?.error?.details) ? body.error.details.map((value: any) => value?.errorCode) : [];
      if (codes.includes("UNREGISTERED")) return "unregistered";
      throw new Error("Android push was not accepted by FCM");
    }
    throw new Error("Android push authentication failed");
  }
}
