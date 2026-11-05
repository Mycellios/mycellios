import * as z from "zod";

export const VideoSceneSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  narration: z.string().trim().min(1).max(260),
});
export const VideoScriptSchema = z.strictObject({ scenes: z.array(VideoSceneSchema).length(6) });
export type VideoScene = z.infer<typeof VideoSceneSchema>;
export interface StudioProject {
  id: string;
  appId: string;
  appVersion: string;
  definitionHash: string;
  topic: string;
  revision: number;
  scenes: VideoScene[];
  voiceRevision: number | null;
  previewRevision: number | null;
  approvedRevision: number | null;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "script" | "voice" | "approved" | "ready" | "interrupted";
  quote: { currency: "credits"; maxMicrounits: 0; acceptedAt: string };
  modelUsage?: { inputTokens: number; outputTokens: number };
  activeStep?: { action: "script" | "voice" | "render"; startedAt: string };
  lastError?: string;
  result?: { mimeType: "video/mp4"; bytes: number; sha256: string; duration: number };
}
export const StudioRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("create"), topic: z.string().trim().min(3).max(1000) }),
  z.strictObject({
    action: z.literal("script"),
    id: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("save"),
    id: z.uuid(),
    revision: z.number().int().positive(),
    ...VideoScriptSchema.shape,
  }),
  z.strictObject({
    action: z.literal("voice"),
    id: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("approve"),
    id: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("preview"),
    id: z.uuid(),
    revision: z.number().int().positive(),
    frames: z.array(z.string().max(3_000_000)).length(6),
  }),
  z.strictObject({
    action: z.literal("render"),
    id: z.uuid(),
    revision: z.number().int().positive(),
  }),
  z.strictObject({
    action: z.literal("artifact"),
    id: z.uuid(),
    kind: z.enum(["voice", "video", "image"]),
    index: z.number().int().min(0).max(5).optional(),
  }),
  z.strictObject({ action: z.literal("cancel"), id: z.uuid() }),
]);
export type StudioRequest = z.infer<typeof StudioRequestSchema>;
export type StudioResponse =
  | { projects: StudioProject[] }
  | StudioProject
  | { data: string; mimeType: string }
  | { cancelled: true };
export interface AppsStudioBridge {
  request(input: StudioRequest): Promise<StudioResponse>;
}
