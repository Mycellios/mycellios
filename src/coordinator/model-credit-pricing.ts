import type { EconomicLedger } from "../economy/economic-ledger.js";
import type { ManagedModel,ManagedCatalogDiscovery } from "../contracts/managed-provider.js";
import { TRANSCRIPTION_MODEL } from "../contracts/transcription.js";
import type { BrowserInference } from "./browser-inference.js";
import { markedUpUnitPrice } from "../economy/managed-pricing.js";

function credits(microunits: number): string {
  if (!Number.isSafeInteger(microunits) || microunits < 0) throw new Error("native_catalog_price_invalid");
  const value = BigInt(microunits);
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
}
/** Read-only upper bounds for currently available native routes, not an external markup. */
export async function nativeCreditMetadata(ledger: EconomicLedger,
  model: { id: string; replicas: number; pipelines: number }) {
  const routes = [...(model.replicas > 0 ? ["remote-replica" as const] : []),
    ...(model.pipelines > 0 ? ["distributed-pipeline" as const] : [])];
  const policies = await Promise.all(routes.map(route => ledger.resolvePricingPolicy(model.id, route, Date.now())));
  if (!policies.length || policies.some(policy => policy === null))
    return { processing: "network" as const, creditEligible: false };
  const priced = policies.filter(policy => policy !== null);
  return { processing: "network" as const, creditEligible: true, pricing: {
    currency: "credits" as const, unit: "token" as const, serviceFeeBasisPoints: 0 as const, estimate: "maximum" as const,
    input: credits(Math.max(...priced.map(p => p.inputMicrounitsPerToken))),
    output: credits(Math.max(...priced.map(p => p.outputMicrounitsPerToken))) } };
}

export async function mycelliosModelCatalog(models: Array<{ id: string; replicas: number; pipelines: number }>,
  ledger: EconomicLedger, managed: { catalog(): Promise<ManagedModel[]>;inventory?():Promise<ManagedCatalogDiscovery[]> } | null,
  browser?: Pick<BrowserInference, "models">) {
  const native = await Promise.all(models.map(async model => ({
    id: model.id, object: "model", created: 0, owned_by: "mycellios",
    ...await nativeCreditMetadata(ledger, model), x_replicas: model.replicas, x_pipelines: model.pipelines,
    ...(model.id === TRANSCRIPTION_MODEL ? { task: "transcription", max_audio_seconds: 30 } : {}),
  })));
  const external = managed ? (await managed.catalog()).map(model => ({ ...model, task: "chat", available: true, creditEligible: true })) : [];
  const known=new Set(external.map(m=>m.id));
  const discovered=managed?.inventory?(await managed.inventory()).filter(m=>!known.has(m.id)).map(m=>({...m,
    object:"model",owned_by:"mycellios",modality:m.outputModalities.length===1?m.outputModalities[0]:"multimodal",
    task:m.outputModalities.length===1?m.outputModalities[0]:"multimodal",available:false,creditEligible:false,
    reason:m.available?"route_not_enabled":m.reason})):[];
  const browserModels = browser?.models().filter(o => "kind" in o).map(o => ({ id: o.model, name: "GPT-2 · 124M · Browser",
    object: "model", owned_by: "mycellios", processing: "network", task: "chat", available: true, creditEligible: true,
    experimental: true, supports_tools: false, context_length: 160, max_input_tokens: 128, max_output_tokens: 32,
    pricing: { currency: "credits", unit: "token", serviceFeeBasisPoints: 400, estimate: "maximum",
      input: markedUpUnitPrice(credits(o.costMicrounitsPerToken)), output: markedUpUnitPrice(credits(o.costMicrounitsPerToken)) } })) ?? [];
  return { object: "list", data: [...native, ...browserModels, ...external,...discovered] };
}
