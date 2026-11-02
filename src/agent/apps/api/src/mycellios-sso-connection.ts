import { readMycelliosAccount } from "@rakazo/adapters";
import type { StoredModelSecret } from "@rakazo/adapters";
import { productBrand } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import { readMycelliosChatModels } from "./mycellios-model-catalog.js";

export class MycelliosConnectionUnavailable extends Error {
  constructor() {
    super("Mycellios account access is temporarily unavailable. No credits were spent.");
    this.name = "MycelliosConnectionUnavailable";
  }
}

/** The browser selects neither an authority nor an account. Tokens stay server-side. */
export async function provisionMycelliosConnection(
  accessToken: string,
  options: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    modelId?: string;
    existing?: Extract<StoredModelSecret, { kind: "openai_compatible" }>;
  } = {},
) {
  const transport = options.fetch ?? fetch;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  const baseUrl = productBrand.apiBaseUrl;
  let keyId: string | undefined;
  const revoke = async () => {
    if (!keyId) return;
    const response = await transport(`${baseUrl}/api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Could not revoke the unused Mycellios connection.");
  };
  try {
    let saved = options.existing;
    if (!saved?.apiKey?.trim()) {
      const response = await transport(`${baseUrl}/api-keys`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Mycellios Agent" }),
      });
      if (!response.ok) throw new Error();
      const created = await readBoundedJsonResponse<Record<string, unknown>>(
        response,
        16_384,
        signal,
      );
      if (
        typeof created.id !== "string" ||
        !created.id ||
        created.id.length > 100 ||
        typeof created.secret !== "string" ||
        created.secret.length < 16 ||
        created.secret.length > 4096
      )
        throw new Error();
      keyId = created.id;
      saved = { ...saved, kind: "openai_compatible", baseUrl, apiKey: created.secret };
    }
    const account = await readMycelliosAccount(saved, { fetch: transport, signal });
    if (!account?.contributionFundingSupported) throw new Error();
    const connection = {
      ...saved,
      headers: { ...saved.headers, "x-mycellios-funding": "contribution-credits" },
    };
    const models = await readMycelliosChatModels(connection.apiKey!, { fetch: transport, signal });
    const selected =
      models.find((model) => model.id === options.modelId) ??
      models.find((model) => model.recommended) ??
      models[0];
    if (!selected) throw new Error();
    return { connection, modelId: selected.id, revoke };
  } catch {
    try {
      await revoke();
    } catch {
      /* An unused key remains revocable in Mycellios. */
    }
    throw new MycelliosConnectionUnavailable();
  }
}
