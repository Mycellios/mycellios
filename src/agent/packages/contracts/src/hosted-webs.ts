import * as z from "zod";

export const HOSTED_WEB_LIMITS = {
  files: 100,
  fileBytes: 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
  sites: 20,
  revisions: 100,
} as const;
export const HostedWebSlug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/);
export const HostedWebBundle = z
  .object({
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(240),
            base64: z.string().max(1_398_104),
          })
          .strict(),
      )
      .min(1)
      .max(HOSTED_WEB_LIMITS.files),
  })
  .strict();
export const HOSTED_WEB_COVER_FILES = {"image/png":"mycellios-cover.png","image/jpeg":"mycellios-cover.jpg","image/webp":"mycellios-cover.webp"} as const;
export const HostedWebCard = z.object({
  id: z.string(),
  slug: HostedWebSlug,
  title: z.string(),
  summary: z.string(),
  published: z.boolean(),
  revision: z.number().int(),
  views: z.number().int().nonnegative(),
  recentViews: z.number().int().nonnegative(),
  pinned: z.boolean(),
  owned: z.boolean(),
  updatedAt: z.string(),
  forkedFrom: z.string().nullable(),
  coverPath:z.enum(["mycellios-cover.png","mycellios-cover.jpg","mycellios-cover.webp"]).nullable().optional(),
  coverRevisionId:z.string().uuid().nullable().optional(),
});
export const HostedWebDraft = z.object({
  id: z.string(),
  slug: HostedWebSlug,
  title: z.string(),
  summary: z.string(),
  bundle: HostedWebBundle,
  version: z.number().int().positive(),
  published: z.boolean(),
});
export const HostedWebAgent = z.object({
  botId: z.string(),
  threadId: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});
export type HostedWebAgent = z.infer<typeof HostedWebAgent>;
export const HostedWebSave = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    slug: HostedWebSlug,
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().max(240),
    bundle: HostedWebBundle,
  })
  .strict();
export type HostedWebBundle = z.infer<typeof HostedWebBundle>;
export type HostedWebCard = z.infer<typeof HostedWebCard>;
export type HostedWebDraft = z.infer<typeof HostedWebDraft>;
