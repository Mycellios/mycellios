import { readFileSync } from "node:fs";

export interface ManagedProviderConfig {
  upstream?: "antseed" | "antseed-gateway" | "openrouter";
  openRouterKey?: string;
  antseedControlSecret?: string;
  antseedGatewayKey?: string;
  antseedGatewayBaseUrl?: string;
  antseedGatewayContract?: string;
  modelAllowlist: readonly string[];
  requestLimitMicrounits: number;
  dailyLimitMicrounits: number;
  /** Effective supplier funding fee, including minimums. Unknown costs disable paid admission. */
  fundingCostBasisPoints?: number;
  mediaEnabled?:boolean;
  mediaOffers?: import("../contracts/managed-provider.js").MediaOffer[];
  walletTopups?: boolean;
  antseedEditControlSecret?:string;
  textRoutes?:import("../contracts/managed-provider.js").ManagedTextRoute[];
}
/** Operator-only opt-in. Never infer credentials from a user's BYOK connection. */
export function readManagedProviderConfig(env: NodeJS.ProcessEnv): ManagedProviderConfig | undefined {
  if (env.MYCELLIOS_MANAGED_PROVIDER_ENABLED !== "true") return undefined;
  const upstream = env.MYCELLIOS_MANAGED_UPSTREAM ?? "antseed";
  if (upstream !== "antseed" && upstream !== "antseed-gateway" && upstream !== "openrouter") throw new Error("managed_configuration_invalid");
  const key = upstream === "openrouter" ? env.MYCELLIOS_MANAGED_OPENROUTER_KEY : upstream === "antseed-gateway" ? gatewayKey(env) : requiredControl(env);
  let models: unknown;
  try { models = JSON.parse(env.MYCELLIOS_MANAGED_MODEL_ALLOWLIST ?? '["*"]'); } catch { throw new Error("managed_configuration_invalid"); }
  const limit = Number(env.MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS);
  const daily = Number(env.MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS);
  if (!key || !Array.isArray(models) || !models.length || models.length > 100
    || models.some(m => typeof m !== "string" || (m!=="*"&&!/^[A-Za-z0-9._:/-]{1,180}$/.test(m)))
    || (models.includes("*")&&models.length!==1)
    || new Set(models).size !== models.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 100_000_000
    || !Number.isSafeInteger(daily) || daily < limit || daily > 1_000_000_000_000)
    throw new Error("managed_configuration_invalid");
  const mediaOffers = env.MYCELLIOS_MANAGED_MEDIA_OFFERS ? JSON.parse(env.MYCELLIOS_MANAGED_MEDIA_OFFERS) : [];
  if(!Array.isArray(mediaOffers)||mediaOffers.length>100) throw new Error("managed_configuration_invalid");
  if(mediaOffers.length)throw new Error("managed_media_cost_contract_not_qualified");
  const textRoutes=env.MYCELLIOS_MANAGED_TEXT_ROUTES?JSON.parse(env.MYCELLIOS_MANAGED_TEXT_ROUTES):undefined;
  const funding=env.MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS===undefined?undefined:Number(env.MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS);
  if(funding!==undefined&&(!env.MYCELLIOS_MANAGED_FUNDING_COST_BASIS_POINTS?.trim()||!Number.isSafeInteger(funding)||funding<0||funding>100000))throw new Error("managed_funding_cost_invalid");
  if(textRoutes!==undefined&&(!Array.isArray(textRoutes)||!textRoutes.length||textRoutes.length>100))throw new Error("managed_configuration_invalid");
  if (upstream !== "openrouter" && env.MYCELLIOS_MANAGED_MEDIA_ENABLED === "true") throw new Error("managed_antseed_media_not_qualified");
  if (upstream === "antseed-gateway" && (!env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_BASE_URL
    || env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_CONTRACT !== "deepseek-bounded-v1")) throw new Error("managed_antseed_gateway_configuration_invalid");
  return { upstream, ...(upstream === "openrouter" ? {openRouterKey:key} : upstream === "antseed-gateway" ? {
    antseedGatewayKey:key, antseedGatewayBaseUrl:env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_BASE_URL!,
    antseedGatewayContract:env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_CONTRACT!} : {antseedControlSecret:key}), modelAllowlist: models as string[], requestLimitMicrounits: limit, dailyLimitMicrounits: daily,
    mediaOffers,mediaEnabled:env.MYCELLIOS_MANAGED_MEDIA_ENABLED==="true",walletTopups:env.MYCELLIOS_WALLET_TOPUPS_ENABLED==="true",...(funding===undefined?{}:{fundingCostBasisPoints:funding}),
    ...(textRoutes?{textRoutes}:{}),
    ...(env.MYCELLIOS_MANAGED_ANTSEED_EDIT_ENABLED==="true"?{antseedEditControlSecret:requiredControl(env)}:{}) };
}
function requiredControl(env:NodeJS.ProcessEnv){const value=env.MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET;if(!value||value.length<24)throw new Error("managed_antseed_control_required");return value;}
function gatewayKey(env:NodeJS.ProcessEnv) {
  if (env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY && env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY_FILE)
    throw new Error("managed_antseed_gateway_key_ambiguous");
  let value = env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY;
  if (env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY_FILE) {
    try {value = readFileSync(env.MYCELLIOS_MANAGED_ANTSEED_GATEWAY_KEY_FILE, "utf8").trim();}
    catch {throw new Error("managed_antseed_gateway_key_required");}
  }
  if (!value || !/^antseed_[A-Za-z0-9_-]{24,200}$/.test(value)) throw new Error("managed_antseed_gateway_key_required");
  return value;
}
