import { createOpenAiCompatibleFetch, isChatModelId } from "@mycellios/adapters";
import type { ModelCatalogEntry } from "@mycellios/contracts";
import {
  knownModelContextWindow,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  productBrand,
} from "@mycellios/contracts";
import { readBoundedJsonResponse } from "@mycellios/core";

const MIN_MICO_CONTEXT_TOKENS = 8_192;

function managedPrice(row: Record<string, unknown>) {
  if (!["external", "network"].includes(String(row.processing)) || !row.pricing || typeof row.pricing !== "object") return null;
  const value = row.pricing as Record<string, unknown>;
  const valid = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,8})(\.\d{1,18})?$/.test(v);
  if (value.currency !== "credits" || value.unit !== "token"
    || value.serviceFeeBasisPoints !== (row.processing === "external" ? 400 : 0)
    || !valid(value.input) || !valid(value.output) || (value.request!==undefined&&!valid(value.request))) return null;
  return { currency: "credits" as const, unit: "token" as const, serviceFeeBasisPoints: value.serviceFeeBasisPoints as 0 | 400,
    input: value.input, output: value.output, ...(typeof value.request==="string"?{request:value.request}:{}),
    ...(value.estimate === "maximum" ? { estimate: "maximum" as const } : {}) };
}
/** Display only: exact decimal shift so a tiny nonzero price is never shown as free. */
function perMillion(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const atoms = (BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))) * 1_000_000n;
  return `${atoms / 10n ** 18n}.${(atoms % 10n ** 18n).toString().padStart(18, "0")}`.replace(/\.?0+$/, "");
}
function creditBilling(pricing:NonNullable<ReturnType<typeof managedPrice>>) {
  const zero=(value:string)=>/^0(?:\.0+)?$/.test(value);
  const fixed=pricing.request&&!zero(pricing.request)?`${pricing.request} Credits / request`:null;
  if(zero(pricing.input)&&zero(pricing.output))return fixed?`${fixed} · 4% included`:"0 Credits";
  return `Credits / 1M tokens · Input ${pricing.estimate==="maximum"?"up to ":""}${perMillion(pricing.input)} · Output ${pricing.estimate==="maximum"?"up to ":""}${perMillion(pricing.output)}${fixed?` · ${fixed}`:""}${pricing.serviceFeeBasisPoints===400?" · 4% included":""}`;
}

/** Account-scoped discovery only. No inference, credit changes or key creation. */
export async function readMycelliosChatModels(
  token: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; credentialId?: string } = {},
): Promise<ModelCatalogEntry[]> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const fetcher = createOpenAiCompatibleFetch(options.fetch);
  const init: RequestInit = {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "x-mycellios-funding": "contribution-credits",
      },
  };
  const readModels = async () => {
    const response = await fetcher(`${productBrand.apiBaseUrl}/models`, init);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Mycellios model catalog is temporarily unavailable.");
    }
    return readBoundedJsonResponse<{ data?: unknown }>(response, 4_194_304, signal);
  };
  let body = await readModels();
  // Native discovery refreshes external metadata without blocking native callers.
  // At its TTL boundary, wait once for owned metadata, then reread the canonical
  // enabled catalog. Inventory entries and expired prices never grant admission.
  if (Array.isArray(body.data) && body.data.some(item => item && typeof item === "object"
    && item.processing === "external" && item.available === false && item.reason === "ready")) {
    const refreshed = await fetcher(`${productBrand.apiBaseUrl}/managed/catalog`, init);
    const ready = refreshed.ok;
    await refreshed.body?.cancel();
    if (ready) body = await readModels();
  }
  if (!Array.isArray(body.data)) throw new Error("Invalid Mycellios model catalog.");
  const seen = new Set<string>();
  const result: ModelCatalogEntry[] = [];
  for (const item of body.data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    // Tiny browser demos without tool calls cannot execute a Mico's agent turn.
    if (row.supports_tools === false) continue;
    // A Mico's instructions and tools alone exceed a tiny window, so every turn would fail
    // with "context window is too small"; such services are not conversational capacity.
    if (typeof row.context_length === "number" && row.context_length < MIN_MICO_CONTEXT_TOKENS) continue;
    const externalText=row.processing==="external"&&row.modality==="text"&&typeof row.id==="string"&&row.id.startsWith("mycellios/managed/");
    if(row.processing==="external"&&row.modality!==undefined&&row.modality!=="text")continue;
    if (
      typeof row.id !== "string" ||
      !/^[\x21-\x7e]{1,1024}$/.test(row.id) ||
      (!externalText&&(!isChatModelId(row.id)||/(?:^|[-/_])kokoro(?:[-/_]|$)/i.test(row.id)))
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
    const pricing = managedPrice(row);
    if (row.processing === "external" && !pricing) continue; // Unknown cost is unavailable, never free.
    if (
      row.processing !== "external" &&
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
      billing: pricing ? creditBilling(pricing)
        : "Uses your Mycellios credits",
      ...(pricing ? { mycelliosProcessing: row.processing as "external" | "network", mycelliosPricing: pricing }
        : row.processing === "network" ? { mycelliosProcessing: "network" as const } : {}),
      live: true,
      // The coordinator's own figure for the route; absent or malformed means unknown.
      ...(knownModelContextWindow(row.context_length) !== undefined
        ? { contextWindow: row.context_length as number }
        : {}),
      ...(row.recommended === true ? { recommended: true } : {}),
      ...(options.credentialId ? { credentialIds: [options.credentialId] } : {}),
    });
  }
  // Real distributed chat capacity precedes external capacity; saved defaults do
  // not reorder the catalog or make an unavailable route look executable.
  return result.sort((a, b) => Number(a.mycelliosProcessing === "external") - Number(b.mycelliosProcessing === "external") || a.label.localeCompare(b.label));
}
