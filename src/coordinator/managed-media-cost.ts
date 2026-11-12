import {createHash} from "node:crypto";
import type {MediaCostContract} from "../contracts/managed-provider.js";
import {addUsd,unitCost,usdAtoms} from "../economy/managed-pricing.js";
import {transcriptionAudio} from "../contracts/transcription.js";

/** Validate duration from canonical PCM bytes, never client duration or compressed headers. */
export function managedAudioSeconds(audio:{data:string;format:string}) {
  if(audio.format!=="wav")throw new Error("managed_audio_requires_pcm_wav");
  const bytes=Buffer.from(audio.data,"base64");
  transcriptionAudio({schema:"mycellios-transcription-input/1",language:"auto",audio:{format:"wav",data:audio.data,sha256:createHash("sha256").update(bytes).digest("hex")}});
  return Math.ceil((bytes.length-44)/32000);
}
export function mediaCost(contract:MediaCostContract,input:{state?:string|undefined;prompt?:string|undefined;audio?:{data:string;format:string}|undefined;duration?:number|undefined;documents?:string[]|undefined;max_tokens?:number|undefined}) {
  if(contract.version!==1||!/^sha256:[a-f0-9]{64}$/.test(contract.sourceDigest)||!contract.components.length||contract.components.length>32)throw new Error("managed_media_cost_contract_invalid");
  const bytes=Buffer.byteLength(input.prompt??"")+Buffer.byteLength(input.state??""),tokens=bytes+4096;
  if(contract.maxInputTokens&&tokens+(input.max_tokens??0)>contract.maxInputTokens)throw new Error("managed_request_too_large");
  const pixels=contract.controls.size?.match(/^(\d{2,4})x(\d{2,4})$/);
  const dimension=pixels?Number(pixels[1])*Number(pixels[2]):({"1K":1048576,"2K":4194304,"4K":16777216} as Record<string,number>)[contract.controls.resolution??""];
  const parts=contract.components.map(rate=>{
    usdAtoms(rate.usd);
    switch(rate.unit) {
      case "request":case "image":return rate.usd;
      case "input_character":return unitCost(rate.usd,bytes); // UTF-8 bytes dominate code points and UTF-16 units.
      case "input_token":return unitCost(rate.usd,tokens);
      case "output_token":{
        const count=input.max_tokens??contract.maxOutputTokens;
        if(!count||!contract.maxOutputTokens||count>contract.maxOutputTokens)throw new Error("managed_output_bound_missing");
        return unitCost(rate.usd,count);
      }
      case "audio_second":if(!input.audio)throw new Error("managed_audio_required");return unitCost(rate.usd,managedAudioSeconds(input.audio));
      case "video_second":if(!input.duration)throw new Error("managed_duration_required");return unitCost(rate.usd,input.duration);
      case "megapixel":if(!dimension)throw new Error("managed_image_size_bound_missing");return unitCost(rate.usd,dimension,1000000);
      case "rerank_token":{
        if(!input.documents?.length)throw new Error("managed_documents_required");
        if(contract.maxInputTokens&&input.documents.some(d=>Buffer.byteLength(d)+tokens>contract.maxInputTokens!))throw new Error("managed_request_too_large");
        // Query is repeated for each document; do not price the concatenation only once.
        return unitCost(rate.usd,input.documents.reduce((n,doc)=>n+Buffer.byteLength(doc)+tokens,0));
      }
      default:throw new Error("managed_media_cost_unit_unsupported");
    }
  });
  return addUsd(...parts);
}
