import { z } from "zod";

export const VIDEO_EDIT_MAX_BYTES = 24 * 1024 * 1024;
export const VideoEditRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("import"), name: z.string().min(1).max(200), data: z.string().max(Math.ceil(VIDEO_EDIT_MAX_BYTES / 3) * 4) }),
  z.strictObject({ action: z.literal("quote"), id: z.uuid(), prompt: z.string().trim().min(3).max(2000) }),
  z.strictObject({ action: z.literal("submit"), id: z.uuid(), quoteId: z.uuid() }),
  z.strictObject({ action: z.literal("get"), id: z.uuid() }),
  z.strictObject({ action: z.literal("artifact"), id: z.uuid(), kind: z.enum(["source", "result"]) }),
]);
export type VideoEditRequest = z.infer<typeof VideoEditRequestSchema>;
export interface VideoEditQuote {
  id: string; model: string; seller: string; protocol: "fal-video" | "venice-video";
  resolution: string; creditsMicros: number; expiresAt: string; sourceHash: string; promptHash: string;
  managed?:{token:string;request:Record<string,unknown>;key:string};
}
export interface VideoEditProject {
  id: string; appId: string; appVersion: string; definitionHash: string; name: string; sourceHash: string; duration: number; width: number; height: number;
  prompt: string; status: "draft" | "quoted" | "submitting" | "running" | "ready" | "failed" | "uncertain";
  createdAt: string; updatedAt: string; quote?: VideoEditQuote; jobId?: string;
  error?: string; resultHash?: string; chargedCreditsMicros?:number;
}
export type VideoEditResponse = { projects: VideoEditProject[]; providerReady: boolean; creditsReady: boolean }
  | VideoEditProject | { data: string; mimeType: "video/mp4" };
export interface VideoEditBridge { request(input: VideoEditRequest): Promise<VideoEditResponse> }
