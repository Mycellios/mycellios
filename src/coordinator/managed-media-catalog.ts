import {sha256CanonicalEvidence} from "../core/json.js";
import type {MediaOffer,MediaCostContract} from "../contracts/managed-provider.js";
import {addUsd,unitCost,usdAtoms} from "../economy/managed-pricing.js";
import {parseManagedProviderJson} from "./managed-openrouter.js";

type Row=Record<string,any>;
const object=(v:unknown):Row=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("managed_media_metadata_invalid");return v as Row;};
const validId=(id:unknown):id is string=>typeof id==="string"&&/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]{1,200}$/.test(id);
const zero=(v:unknown)=>typeof v==="string"&&usdAtoms(v)===0n;
const max=(a:string,b:string)=>usdAtoms(a)>usdAtoms(b)?a:b;
const values=(cap:unknown):string[]=>{const c=cap as {type?:string;values?:unknown};return c?.type==="enum"&&Array.isArray(c.values)?c.values.filter((v):v is string=>typeof v==="string"):[];};

/** Metadata only. Fixed host/paths, bounded bodies, no redirects or inference during discovery. */
export class ManagedMediaCatalog {
  private pending:Promise<MediaOffer[]>|null=null;
  private offers:MediaOffer[]=[];
  private expires=0;
  private unavailable:Array<{id:string;reason:string}>=[];
  constructor(private readonly key:string,private readonly allowlist:readonly string[],private readonly transport:typeof fetch=fetch) {}
  inventory(){return this.unavailable.map(v=>({...v,available:false}));}
  async load():Promise<MediaOffer[]> {
    if(Date.now()<this.expires)return this.offers;
    this.pending??=this.refresh().finally(()=>{this.pending=null;});return this.pending;
  }
  private admitted(id:unknown):id is string {return validId(id)&&(this.allowlist.includes("*")||this.allowlist.includes(id));}
  private async get(path:string):Promise<Row> {
    const signal=AbortSignal.timeout(15000);
    const r=await this.transport("https://openrouter.ai/api/v1"+path,{method:"GET",redirect:"error",signal,headers:{authorization:`Bearer ${this.key}`}});
    if(!r.ok){await r.body?.cancel();throw new Error("managed_media_catalog_unavailable");}
    const reader=r.body?.getReader();if(!reader)throw new Error("managed_media_metadata_invalid");
    let length=0;const chunks:Uint8Array[]=[];
    try{while(true){const v=await reader.read();if(v.done)break;length+=v.value.length;if(length>8388608)throw new Error("managed_media_catalog_too_large");chunks.push(v.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return object(parseManagedProviderJson(Buffer.concat(chunks).toString("utf8")));
  }
  private rows(body:Row):Row[]{if(!Array.isArray(body.data)||body.data.length>10000)throw new Error("managed_media_catalog_invalid");return body.data.map(object);}
  private contract(source:unknown,components:MediaCostContract["components"],controls:MediaCostContract["controls"]={},maxOutputTokens?:number):MediaCostContract {
    if(!components.length||components.some(p=>typeof p.usd!=="string"||usdAtoms(p.usd)<0n))throw new Error("managed_media_price_invalid");
    return {version:1,sourceDigest:sha256CanonicalEvidence(source),components,controls,...(maxOutputTokens?{maxOutputTokens}:{})};
  }
  private offer(row:Row,kind:MediaOffer["kind"],costContract:MediaCostContract,extra:Partial<MediaOffer>={}):MediaOffer {
    // Public summary bounds cover the allowed request controls; exact quotes use actual units.
    let maximumUsd=addUsd(...costContract.components.map(c=>unitCost(c.usd,
      c.unit==="input_character"?16000:c.unit==="input_token"?(kind==="decisions"?36096:20096):c.unit==="audio_second"?30:c.unit==="video_second"?15:
      c.unit==="output_token"?(costContract.maxOutputTokens??8192):c.unit==="rerank_token"?40*36096:1)));
    if(kind==="batch")maximumUsd=unitCost(maximumUsd,8);
    return {id:`mycellios/media/${kind}/${row.id}`,upstreamId:row.id,name:typeof row.name==="string"?row.name.slice(0,250):row.id,kind,
      maximumUsd,expiresAt:Date.now()+300000,costContract,...extra};
  }
  private tokenRates(row:Row) {
    const p=object(row.pricing),variants=[p,...(Array.isArray(p.overrides)?p.overrides.map(object):[])];
    const allowed=new Set(["prompt","completion","request","input_cache_read","input_cache_write","input_cache_write_1h","internal_reasoning","overrides","web_search","image","audio","input_audio_cache"]);
    for(const v of variants)for(const [k,n] of Object.entries(v)) {
      if(["min_prompt_tokens","max_prompt_tokens","start_time","end_time","weekdays"].includes(k))continue;
      if(!allowed.has(k)||(k!=="overrides"&&(typeof n!=="string"||usdAtoms(n)<0n)))throw new Error("managed_media_extra_price_unsupported");
    }
    const rate=(keys:string[])=>variants.reduce((n,v)=>keys.reduce((n,k)=>v[k]===undefined?n:max(n,String(v[k])),n),"0");
    if(typeof p.prompt!=="string"||typeof p.completion!=="string")throw new Error("managed_media_price_invalid");
    return {input:rate(["prompt","input_cache_read","input_cache_write","input_cache_write_1h"]),output:rate(["completion","internal_reasoning"]),request:rate(["request"])};
  }
  private image(row:Row,endpoint:Row) {
    if(!validId(row.id)||typeof endpoint.provider_tag!=="string"||!/^[a-z0-9._/-]{1,150}$/i.test(endpoint.provider_tag)||!Array.isArray(endpoint.pricing)||!endpoint.pricing.length)throw new Error("managed_image_endpoint_invalid");
    const caps=object(endpoint.supported_parameters),controls:MediaCostContract["controls"]={providerTag:endpoint.provider_tag};
    if(caps.n?.type==="range"&&(caps.n.min>1||caps.n.max<1)||caps.input_references?.min>0)throw new Error("managed_image_inputs_unsupported");
    const formats=values(caps.output_format),format=["png","jpeg","webp"].find(v=>formats.includes(v));
    if(formats.length&&!format)throw new Error("managed_image_format_unsupported");
    if(format)controls.output_format=format as "png"|"jpeg"|"webp";
    if(values(caps.aspect_ratio).includes("1:1"))controls.aspect_ratio="1:1";
    const resolutions=values(caps.resolution);if(resolutions.includes("1K"))controls.resolution="1K";
    else if((caps.size as Row|undefined)?.type==="boolean")controls.size="1024x1024";
    if(values(caps.quality).includes("low"))controls.quality="low";
    const rates:MediaCostContract["components"]=[];
    for(const value of endpoint.pricing) {
      const p=object(value);if(typeof p.cost_usd!=="string")throw new Error("managed_image_price_invalid");usdAtoms(p.cost_usd);
      if(["input_image","input_reference","input_font"].includes(p.billable))continue; // No reference inputs are accepted.
      if(p.billable==="input_text"&&p.unit==="token")rates.push({unit:"input_token",usd:p.cost_usd});
      else if(p.unit==="request")rates.push({unit:"request",usd:p.cost_usd});
      else if(p.billable==="output_image"&&p.unit==="image")rates.push({unit:"image",usd:p.cost_usd});
      else if(p.billable==="output_image"&&p.unit==="megapixel"&&(controls.size||controls.resolution)) {
        const pixels=controls.resolution?1048576:1024*1024;
        rates.push({unit:"image",usd:unitCost(p.cost_usd,pixels,1000000)});
      } else if(!zero(p.cost_usd))throw new Error("managed_image_output_bound_missing");
    }
    if(!rates.some(r=>r.unit==="image"||r.unit==="request"))throw new Error("managed_image_output_bound_missing");
    return this.offer(row,"image",this.contract(endpoint,rates,controls));
  }
  private video(row:Row) {
    const skus=object(row.pricing_skus),rates:string[]=[];
    for(const [key,value] of Object.entries(skus)) {
      if(typeof value!=="string")throw new Error("managed_video_price_invalid");usdAtoms(value);
      if(/^(?:text_to_video_)?duration_seconds(?:_(?:with_audio|without_audio))?(?:_(?:360p|480p|720p|768p|1080p|1k|2k|4k))?$/.test(key))rates.push(value);
      else if(/^cents_per_(?:video_output_second|second_output)(?:_(?:480p|720p|1080p|2k|4k))?$/.test(key))rates.push(unitCost(value,1,100));
      else if(/^(?:image_to_video|reference|long)_duration_seconds|^(?:reference_images|reference_input_images|cents_per_image_input)$/.test(key))continue;
      else if(!zero(value))throw new Error("managed_video_unit_unsupported");
    }
    if(!rates.length||!Array.isArray(row.supported_durations)||!Array.isArray(row.supported_resolutions)||!Array.isArray(row.supported_aspect_ratios))throw new Error("managed_video_controls_missing");
    const durations=row.supported_durations.filter((n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=1&&Number(n)<=15);
    const resolution=["480p","720p","360p","768p","1080p"].find(v=>row.supported_resolutions.includes(v));
    const ratio=row.supported_aspect_ratios.includes("16:9")?"16:9":row.supported_aspect_ratios[0];
    if(!durations.length||!resolution||typeof ratio!=="string"||!/^\d{1,2}:\d{1,2}$/.test(ratio))throw new Error("managed_video_controls_missing");
    return this.offer(row,"video",this.contract(row,[{unit:"video_second",usd:rates.reduce(max,"0")}],{resolution,aspect_ratio:ratio}),{durations});
  }
  private async refresh() {
    const [general,images,videos]=await Promise.allSettled([this.get("/models?output_modalities=all"),this.get("/images/models"),this.get("/videos/models")]);
    const offers:MediaOffer[]=[],unavailable:typeof this.unavailable=[];
    if(general.status==="fulfilled")for(const row of this.rows(general.value)) {
      if(!this.admitted(row.id))continue;
      const modalities=row.architecture?.output_modalities;if(!Array.isArray(modalities)||modalities.length!==1)continue;
      const batch=modalities[0]==="text"&&row.id.endsWith(":batch")&&Array.isArray(row.endpoints)&&row.endpoints.includes("/api/v1/batches");
      const kind=batch?"batch":modalities[0];if(!["speech","transcription","embeddings","rerank","batch","decisions"].includes(kind))continue;
      try {
        const p=this.tokenRates(row);
        if(kind==="decisions"&&(!row.endpoints?.includes("/api/alpha/decisions")||!row.architecture?.input_modalities?.includes("text")
          ||usdAtoms(row.pricing?.web_search??"0")>0n))throw new Error("managed_decisions_contract_unsupported");
        if(batch) {
          if(!Number.isSafeInteger(row.context_length)||row.context_length<4608||row.supported_parameters?.includes("web_search_options"))throw new Error("managed_batch_context_unsupported");
          const output=Math.min(8192,Number(row.top_provider?.max_completion_tokens??8192),row.context_length-4608);
          if(!Number.isSafeInteger(output)||output<1)throw new Error("managed_batch_output_bound_missing");
          const contract=this.contract(row,[{unit:"input_token",usd:p.input},{unit:"output_token",usd:p.output},{unit:"request",usd:p.request}],{},output);
          contract.maxInputTokens=row.context_length;
          offers.push({...this.offer(row,"batch",contract),upstreamId:row.id.slice(0,-6)});continue;
        }
        if(usdAtoms(p.output)!==0n)throw new Error("managed_output_bound_missing");
        if(kind==="transcription"&&row.context_length!==0)throw new Error("managed_audio_token_contract_unsupported");
        const components:MediaCostContract["components"]=[{unit:kind==="speech"?"input_character":kind==="transcription"?"audio_second":kind==="rerank"?"rerank_token":"input_token",usd:p.input},{unit:"request",usd:p.request}];
        const voices=kind==="speech"&&Array.isArray(row.supported_voices)?row.supported_voices.filter((v:unknown):v is string=>typeof v==="string"&&v.length<80).slice(0,200):undefined;
        if(kind==="speech"&&(!voices?.length||/^(heygen|google)\//.test(row.id)))throw new Error("managed_audio_format_not_qualified");
        const contract=this.contract(row,components);
        if(["embeddings","rerank","decisions"].includes(kind)) {
          if(!Number.isSafeInteger(row.context_length)||row.context_length<4608)throw new Error("managed_context_bound_missing");
          contract.maxInputTokens=row.context_length;
        }
        offers.push(this.offer(row,kind,contract,voices?{voices}:{}));
      }catch(error){unavailable.push({id:row.id,reason:error instanceof Error?error.message:"managed_media_unavailable"});}
    }
    if(videos.status==="fulfilled")for(const row of this.rows(videos.value))if(this.admitted(row.id))try{offers.push(this.video(row));}catch(error){unavailable.push({id:row.id,reason:error instanceof Error?error.message:"managed_media_unavailable"});}
    if(images.status==="fulfilled") {
      const rows=this.rows(images.value).filter(r=>this.admitted(r.id));let index=0;
      await Promise.all(Array.from({length:4},async()=>{while(index<rows.length){const row=rows[index++]!;
        try {const body=await this.get(`/images/models/${row.id}/endpoints`);if(body.id!==row.id||!Array.isArray(body.endpoints)||body.endpoints.length>100)throw new Error("managed_image_endpoint_invalid");
          const options=body.endpoints.flatMap((e:unknown)=>{try{return [this.image(row,object(e))];}catch{return [];}});
          options.sort((a:MediaOffer,b:MediaOffer)=>usdAtoms(a.maximumUsd)<usdAtoms(b.maximumUsd)?-1:1);
          if(!options[0])throw new Error("managed_image_output_bound_missing");offers.push(options[0]);
        }catch(error){unavailable.push({id:row.id,reason:error instanceof Error?error.message:"managed_media_unavailable"});}
      }}));
    }
    if(general.status!=="fulfilled"&&images.status!=="fulfilled"&&videos.status!=="fulfilled")throw new Error("managed_media_catalog_unavailable");
    const counts=new Map<string,number>();for(const row of offers)counts.set(row.id,(counts.get(row.id)??0)+1);
    const order=["image","speech","transcription","video","embeddings","rerank","batch","decisions"];
    this.offers=offers.filter(row=>counts.get(row.id)===1).sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||a.id.localeCompare(b.id));this.unavailable=unavailable;this.expires=Date.now()+300000;
    return this.offers;
  }
}
