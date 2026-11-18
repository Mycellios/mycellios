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
/**
 * Optional browser rights an owner grants one frozen revision. Absent means none;
 * the sandbox still never gains same-origin, forms, popups or navigation.
 */
// Screen capture is deliberately absent: Chromium rejects getDisplayMedia from the
// opaque origin this sandbox requires, and allow-same-origin is never granted.
// `storage` changes no header: it enables the host's per-user data bridge.
// `files` (large per-user files) stays unavailable unless the operator enables it.
export const HOSTED_WEB_CAPABILITIES = ["downloads", "storage", "files"] as const;
export const HostedWebCapability = z.enum(HOSTED_WEB_CAPABILITIES);
export type HostedWebCapability = z.infer<typeof HostedWebCapability>;
export const HostedWebBundle = z
  .object({
    capabilities: z
      .array(HostedWebCapability)
      .max(HOSTED_WEB_CAPABILITIES.length)
      .optional(),
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
  capabilities: z.array(HostedWebCapability).optional(),
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
/**
 * Per-user app data, reached only through the Hifa Store host bridge. The app never
 * sees the session or user: the host scopes every call to (app, user, Space).
 */
export const HOSTED_WEB_DATA_LIMITS = {
  keys: 1000,
  valueBytes: 1024 * 1024,
  totalBytes: 5 * 1024 * 1024,
  listPage: 200,
} as const;
export const HostedWebDataKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:/-]+$/);
const dataTarget = { id: z.string().uuid(), preview: z.boolean() };
export const HostedWebDataGet = z.object({ ...dataTarget, key: HostedWebDataKey }).strict();
export const HostedWebDataSet = z
  .object({ ...dataTarget, key: HostedWebDataKey, value: z.json() })
  .strict();
export const HostedWebDataList = z
  .object({ ...dataTarget, prefix: z.string().max(200).regex(/^[A-Za-z0-9_.:/-]*$/).default("") })
  .strict();
export const HostedWebDataEntry = z.object({
  key: HostedWebDataKey,
  bytes: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export const HostedWebDataUsage = z.object({
  keys: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
/**
 * Large per-user files for apps (videos, images). Off by default: the operator must
 * set MYCELLIOS_HOSTED_WEB_FILES_ENABLED=true and configure object storage.
 */
export const HOSTED_WEB_FILE_DEFAULTS = {
  fileBytes: 25 * 1024 * 1024,
  quotaBytes: 250 * 1024 * 1024,
  files: 200,
} as const;
const fileTarget = { id: z.string().uuid(), preview: z.boolean() };
export const HostedWebFileName = HostedWebDataKey;
export const HostedWebFileRef = z.object({ ...fileTarget, name: HostedWebFileName }).strict();
export const HostedWebFilePut = z
  .object({
    ...fileTarget,
    name: HostedWebFileName,
    mimeType: z.string().max(120).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
    // Hard ceiling; the server applies the smaller configured per-file limit.
    contentBase64: z.string().max(Math.ceil((HOSTED_WEB_FILE_DEFAULTS.fileBytes * 4) / 3) + 4),
  })
  .strict();
export const HostedWebFileEntry = z.object({
  name: HostedWebFileName,
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export const HostedWebFilesStatus = z.object({
  available: z.boolean(),
  fileBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
});
export const HostedWebFilesUsage = z.object({
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
/** One private draft snapshot; restoring creates a new draft version. */
export const HostedWebSnapshot = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  source: z.enum(["manual", "mico", "restore"]),
  title: z.string(),
  createdAt: z.string(),
  bytes: z.number().int().nonnegative(),
  current: z.boolean(),
});
export type HostedWebSnapshot = z.infer<typeof HostedWebSnapshot>;
export type HostedWebBundle = z.infer<typeof HostedWebBundle>;
export type HostedWebCard = z.infer<typeof HostedWebCard>;
export type HostedWebDraft = z.infer<typeof HostedWebDraft>;
