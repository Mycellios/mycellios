import { createOpenAiCompatibleFetch, isChatModelId } from "@rakazo/adapters";
import type { ModelCatalogEntry } from "@rakazo/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID, productBrand } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";

/** Account-scoped discovery only. No inference, credit changes or key creation. */
export async function readMycelliosChatModels(
  token: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; credentialId?: string } = {},
): Promise<ModelCatalogEntry[]> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const response = await createOpenAiCompatibleFetch(options.fetch)(
    `${productBrand.apiBaseUrl}/models`,
    {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "x-mycellios-funding": "contribution-credits",
      },
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Mycellios model catalog is temporarily unavailable.");
  }
  const body = await readBoundedJsonResponse<{ data?: unknown }>(response, 1_048_576, signal);
  if (!Array.isArray(body.data)) throw new Error("Invalid Mycellios model catalog.");
  const seen = new Set<string>();
  const result: ModelCatalogEntry[] = [];
  for (const item of body.data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !isChatModelId(row.id) ||
      /(?:^|[-/_])kokoro(?:[-/_]|$)/i.test(row.id)
    )
      continue;
    // Prefer explicit service metadata; legacy text catalogs expose only an id.
    const task = row.task ?? row.type;
    if (
      typeof task === "string" &&
      !["model", "chat", "text", "text-generation", "text_generation"].includes(task)
    )
      continue;
    if (row.available === false || row.creditEligible === false || seen.has(row.id)) continue;
    if (
      typeof row.x_replicas === "number" &&
      typeof row.x_pipelines === "number" &&
      row.x_replicas <= 0 &&
      row.x_pipelines <= 0
    )
      continue;
    seen.add(row.id);
    result.push({
      provider: OPENAI_COMPATIBLE_PROVIDER_ID,
      providerName: productBrand.shortName,
      id: row.id,
      label: typeof row.name === "string" && row.name.trim() ? row.name : row.id,
      billing: "Uses your Mycellios credits",
      live: true,
      ...(row.recommended === true ? { recommended: true } : {}),
      ...(options.credentialId ? { credentialIds: [options.credentialId] } : {}),
    });
  }
  return result;
}
