import type { MycelliosAccount } from "@rakazo/contracts";
import { ModelHeadersSchema, MycelliosAccountSchema } from "@rakazo/contracts";
import { readBoundedResponseBytes } from "@rakazo/core";
import { mycelliosApiBaseUrl } from "./mycellios-api.js";
import { createOpenAiCompatibleFetch } from "./pi-openai-compatible-provider.js";
import { withAbort } from "./web-ssrf.js";

/** Enable account-funded inference only when the canonical authority supports it. */
export async function configureMycelliosFunding<
  T extends { baseUrl: string; apiKey?: string; headers?: Record<string, string> },
>(
  connection: T,
  options: { signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<T> {
  if (!mycelliosAccountUrl(connection.baseUrl)) return connection;
  const account = await readMycelliosAccount(connection, options);
  if (!account?.contributionFundingSupported) return connection;
  const headers = new Headers(connection.headers);
  headers.set("x-mycellios-funding", "contribution-credits");
  return { ...connection, headers: ModelHeadersSchema.parse(Object.fromEntries(headers)) };
}

/** Only a saved connection to the canonical service can supply a Mycellios balance. */
export function mycelliosAccountUrl(baseUrl: string): string | null {
  const url = mycelliosApiBaseUrl(baseUrl);
  return url ? `${url.origin}/v1/account/economy` : null;
}

export async function readMycelliosAccount(
  connection: { baseUrl: string; apiKey?: string },
  options: { signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<MycelliosAccount | null> {
  const url = mycelliosAccountUrl(connection.baseUrl);
  if (!url) return null;
  if (!connection.apiKey?.trim())
    throw new Error("Connect your Mycellios account to see its credits.");
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const transport = createOpenAiCompatibleFetch(options.fetch);
  try {
    signal.throwIfAborted();
    const response = await withAbort(
      transport(url, {
        signal,
        redirect: "error",
        cache: "no-store",
        headers: { authorization: `Bearer ${connection.apiKey}`, accept: "application/json" },
      }),
      signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Account lookup failed");
    }
    const bytes = await readBoundedResponseBytes(response, {
      maxBytes: 16_384,
      tooLargeMessage: "Account response is too large",
      read: (operation) => withAbort(operation(), signal),
    });
    return MycelliosAccountSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    // Provider bodies and network exceptions can contain credentials. Do not relay them.
    throw new Error(
      "Mycellios credits are temporarily unavailable. Your balance has not been changed.",
    );
  }
}
