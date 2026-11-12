import * as z from "zod";

export const APP_COVER_MAX_BYTES = 8 * 1024 * 1024;
export const AppCoverId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
export const AppCoverImageType = z.enum(["image/png", "image/jpeg", "image/webp"]);
export const AppCoverWrite = z.object({
  appId: AppCoverId,
  botId: z.string().min(1),
  expectedRevision: z.string().nullable(),
  clientNonce: z.string().uuid(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("upload"), mimeType: AppCoverImageType,
      contentBase64: z.string().min(1).max(Math.ceil(APP_COVER_MAX_BYTES * 4 / 3) + 4) }),
    z.object({ kind: z.literal("artifact"), artifactId: z.string().min(1) }),
    z.object({ kind: z.literal("default") }),
  ]),
});
export type AppCoverWrite = z.infer<typeof AppCoverWrite>;
