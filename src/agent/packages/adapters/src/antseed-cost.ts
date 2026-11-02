import { createHash } from "node:crypto";
import {
  assertAllowedOpenAiCompatibleUrl,
  assertHttpsForKeyedOpenAiCompatibleUrl,
} from "./openai-compatible-url.js";
import { createOpenAiCompatibleFetch } from "./pi-openai-compatible-provider.js";

export type AntSeedCost = {
  costUsd: number | null;
  state: "confirmed" | "pending" | "unavailable";
  tags: string[];
};
const sessions = new Map<string, { cookie: string; expires: number }>();
const unavailable = (): AntSeedCost => ({ costUsd: null, state: "unavailable", tags: [] });

/** Decimal USDC receipts, never a shared wallet balance delta or a catalog quote. */
export function antseedReceiptCost(rows: unknown, callId: string): AntSeedCost {
  if (!Array.isArray(rows)) return unavailable();
  const matches = rows.filter((row) => row && row.endUser === callId);
  if (!matches.length || matches.length >= 200) return unavailable();
  const seen = new Set<string>();
  let micros = 0n;
  let pending = false;
  for (const row of matches) {
    if (typeof row.tag !== "string" || !row.tag || row.tag.length > 256) return unavailable();
    if (seen.has(row.tag)) continue;
    seen.add(row.tag);
    if (row.finishedAt == null) {
      pending = true;
      continue;
    }
    if (row.servedFree === true) continue;
    if (row.costPending === true) {
      pending = true;
      continue;
    }
    if (typeof row.spent !== "string" || !/^\d{1,10}(\.\d{1,6})?$/.test(row.spent))
      return unavailable();
    const [whole, fraction = ""] = row.spent.split(".");
    micros += BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  }
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  return {
    costUsd: pending ? null : Number(micros) / 1e6,
    state: pending ? "pending" : "confirmed",
    tags: [...seen],
  };
}

/** A normal key sign-in grants read access only to that key's receipts. No admin token. */
export async function readAntSeedCost(input: {
  baseUrl: string;
  apiKey: string;
  callId: string;
  allowPrivate?: boolean;
  fetch?: typeof fetch;
}): Promise<AntSeedCost> {
  if (!/^[\w-]{1,128}$/.test(input.callId)) return unavailable();
  const transport = createOpenAiCompatibleFetch(input.fetch, undefined, {
    allowPrivate: input.allowPrivate,
  });
  let base: URL;
  try {
    base = assertAllowedOpenAiCompatibleUrl(input.baseUrl, { allowPrivate: input.allowPrivate });
    assertHttpsForKeyedOpenAiCompatibleUrl(base, input.apiKey);
  } catch {
    return unavailable();
  }
  const prefix = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = (path: string) => {
    const target = new URL(base.origin);
    target.pathname = prefix + "/console/api/" + path;
    return target;
  };
  const sessionKey = createHash("sha256")
    .update(base.origin + prefix + "\0" + input.apiKey)
    .digest("hex");
  const signal = AbortSignal.timeout(1800);
  try {
    let session = sessions.get(sessionKey);
    if (!session || session.expires <= Date.now()) {
      const response = await transport(url("auth/api-key"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-antseed-console": "1" },
        body: JSON.stringify({ key: input.apiKey }),
        redirect: "error",
        signal,
      });
      await response.body?.cancel();
      if (!response.ok) return unavailable();
      const cookies = response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .filter((cookie) => /^[\w-]+=[^\r\n;]+$/.test(cookie ?? ""));
      if (!cookies.length) return unavailable();
      session = { cookie: cookies.join("; "), expires: Date.now() + 30 * 60_000 };
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
      sessions.set(sessionKey, session);
    }
    const target = url("requests");
    target.searchParams.set("q", input.callId);
    target.searchParams.set("limit", "200");
    const response = await transport(target, {
      headers: { cookie: session.cookie },
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) sessions.delete(sessionKey);
      await response.body?.cancel();
      return unavailable();
    }
    // Keep receipt inspection bounded and never retain response/request content.
    const reader = response.body?.getReader();
    if (!reader) return unavailable();
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512_000) {
        await reader.cancel();
        return unavailable();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (body.nextBefore != null) return unavailable();
    return antseedReceiptCost(body.requests, input.callId);
  } catch {
    return unavailable();
  }
}

export function antseedCostObserver(fetcher: typeof fetch, callId: string, allowPrivate?: boolean) {
  let connection: { baseUrl: string; apiKey: string } | undefined;
  let provenFree = false;
  let requests = 0;
  const wrapped: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const key = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (key && /\/v1\/(chat\/completions|responses|messages)$/.test(target.pathname)) {
      requests++;
      connection = {
        baseUrl: target.origin + target.pathname.replace(/\/v1\/.+$/, "/v1"),
        apiKey: key,
      };
      headers.set("x-antseed-end-user", callId);
    }
    const response = await fetcher(input, { ...init, headers });
    const zero = (name: string) => {
      const raw = response.headers.get(name);
      return raw !== null && /^0+(\.0+)?$/.test(raw.trim());
    };
    provenFree =
      response.ok &&
      zero("x-antseed-input-usd-per-million") &&
      zero("x-antseed-output-usd-per-million") &&
      (!response.headers.has("x-antseed-cached-input-usd-per-million") ||
        zero("x-antseed-cached-input-usd-per-million"));
    return response;
  };
  return {
    fetch: wrapped,
    async cost(): Promise<AntSeedCost> {
      if (provenFree && requests === 1) return { costUsd: 0, state: "confirmed", tags: [] };
      return connection
        ? readAntSeedCost({ ...connection, callId, allowPrivate, fetch: fetcher })
        : unavailable();
    },
  };
}
