import { z } from "zod";

/**
 * Mycellios API keys of the signed-in account. The Agent server reads them with the
 * user's own Mycellios session; the browser never receives that session token.
 */
const ExpectedUserId = z.string().min(1).max(128);

export const MycelliosApiKeySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  /** Public prefix only (for example `myc_live_ab12cd34ef`); never the secret. */
  prefix: z.string().max(64),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** This key is Mycellios Agent's own connection to the account's Credits. */
  usedByAgent: z.boolean(),
});
export type MycelliosApiKey = z.infer<typeof MycelliosApiKeySchema>;

export const MycelliosApiKeyListSchema = z.object({
  apiBaseUrl: z.string(),
  keys: z.array(MycelliosApiKeySchema),
});
export type MycelliosApiKeyList = z.infer<typeof MycelliosApiKeyListSchema>;

export const MycelliosApiKeyListInput = z.object({ expectedUserId: ExpectedUserId }).strict();
export const MycelliosApiKeyCreateInput = z
  .object({ expectedUserId: ExpectedUserId, name: z.string().trim().min(1).max(80) })
  .strict();
export const MycelliosApiKeyRevokeInput = z
  .object({ expectedUserId: ExpectedUserId, keyId: z.string().min(1).max(100) })
  .strict();

/** The full secret is returned once, to the caller that created it. */
export const MycelliosApiKeyCreatedSchema = z.object({
  key: MycelliosApiKeySchema,
  secret: z.string().min(16).max(4096),
});
export type MycelliosApiKeyCreated = z.infer<typeof MycelliosApiKeyCreatedSchema>;
