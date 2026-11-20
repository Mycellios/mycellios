/** Public first-party billing metadata. Upstream credentials never cross this boundary. */
export type ManagedModality = "text" | "image" | "speech" | "transcription" | "video" | "embeddings" | "rerank" | "batch" | "decisions";
export interface ManagedCatalogDiscovery {
  id:string;name:string;inputModalities:string[];outputModalities:string[];
  available:boolean;reason?:string;provider:string;processing:string;pricing:ManagedModel["pricing"]|null;
}
/** Operator-owned mapping. Changing an upstream never changes a customer's wallet. */
export interface ManagedTextRoute {id:string;backend:string;model:string;name?:string}
export interface MediaCostContract {
  version:1; sourceDigest:string;
  components:Array<{unit:"request"|"input_token"|"input_character"|"audio_second"|"image"|"megapixel"|"video_second"|"rerank_token"|"output_token";usd:string}>;
  /** Fixed server-selected parameters; callers cannot inject paid options or routing. */
  controls: {resolution?:string;size?:string;aspect_ratio?:string;quality?:string;providerTag?:string;output_format?:"png"|"jpeg"|"webp"};
  maxOutputTokens?:number;
  maxInputTokens?:number;
}
export interface MediaOffer { id:string; upstreamId:string; name:string; kind:Exclude<ManagedModality,"text">; maximumUsd:string; expiresAt:number; voices?:string[];durations?:number[]; costContract?:MediaCostContract }
export interface ManagedModel {
  id: string;
  name: string;
  modality: ManagedModality;
  owned_by: "mycellios";
  processing: "external";
  pricing: {
    currency: "credits";
    serviceFeeBasisPoints: 400;
    /** Decimal credits per unit, already including the service fee. */
    input: string;
    output: string;
    unit: "token";
    request?: string;
    fundingCostBasisPoints?: number;
    estimate?:"maximum";
  };
  /** Token-equivalent admission bounds of this route, from managedTextLimits. */
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  /** The best currently free route, chosen from upstream signals. Clients may start new accounts on it. */
  recommended?: true;
}
/** Requests above this many JSON bytes are refused before any paid upstream call. */
export const MANAGED_TEXT_MAX_REQUEST_BYTES = 131_072;
/**
 * Clients estimate tokens; quotes bound input by JSON bytes. Publishing a token
 * budget at 0.28 tokens per byte keeps an admitted estimate under both the byte
 * cap and the route context (counted as bytes plus the route overhead), so a
 * client can plan without changing the conservative paid admission bound.
 */
export function managedTextLimits(contextTokens: number, maxOutput: number, overhead: number) {
  const bytes = Math.min(MANAGED_TEXT_MAX_REQUEST_BYTES, contextTokens - overhead - maxOutput);
  const input = Math.max(0, Math.floor(bytes * 0.28));
  return { context_length: input + maxOutput, max_input_tokens: input, max_output_tokens: maxOutput };
}

export interface ManagedCharge {
  upstreamUsd: string;
  upstreamMicrounits: number;
  fundingCostMicrounits?: number;
  fundingCostBasisPoints?: number;
  serviceFeeMicrounits: number;
  totalMicrounits: number;
  serviceFeeBasisPoints: 400;
}
