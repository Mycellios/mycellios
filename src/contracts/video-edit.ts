import {z} from "zod";

/** Quote contains metadata only. MP4 bytes travel only after explicit acceptance. */
export const ManagedEditRequestSchema=z.object({
 model:z.literal("mycellios/antseed/video-edit"),project:z.string().regex(/^[a-f0-9]{64}$/),
 prompt:z.string().trim().min(3).max(2000),
 source:z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),duration:z.number().min(1).max(30),
  width:z.number().int().min(128).max(3840),height:z.number().int().min(128).max(3840)}).strict(),
}).strict();
export type ManagedEditRequest=z.infer<typeof ManagedEditRequestSchema>;
export interface ManagedEditOffer {
 model:string;seller:string;provider:string;service:string;protocol:"fal-video"|"venice-video";
 resolution:string;upstreamUsd:string;creditsMicros:number;
}
export interface ManagedEditJob {
 id:string;offer:ManagedEditOffer;tag:string;bootId:string;cursor:number;
 downloadRequestId:string;bytes?:string;artifactHash?:string;
}
