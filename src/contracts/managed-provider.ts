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
