import { z } from "zod";

/**
 * Sign-in methods of the signed-in Mycellios account. The Agent server reads and changes
 * them at the Mycellios identity authority with the user's own Mycellios session; the
 * browser never receives that session token.
 */
const ExpectedUserId = z.string().min(1).max(128);

/** Providers this account can link or unlink from Agent (the identity authority calls X `twitter`). */
export const MycelliosLinkableProviderSchema = z.enum(["google", "twitter"]);
export type MycelliosLinkableProvider = z.infer<typeof MycelliosLinkableProviderSchema>;

/** One-time query marker on the return from a provider; it carries the browser's own state. */
export const MYCELLIOS_IDENTITY_LINK_STATE_PARAM = "identityLinkState";
/** 128 random bits as lowercase hex, chosen and remembered by the browser that started linking. */
export const MycelliosIdentityLinkStateSchema = z.string().regex(/^[a-f0-9]{32}$/);

export const MycelliosIdentitySchema = z.object({
  id: z.string().min(1).max(128),
  /** Authority provider name: `email`, `google`, `twitter`, `web3`, … */
  provider: z.string().min(1).max(64),
  email: z.string().max(320).nullable(),
});
export type MycelliosIdentity = z.infer<typeof MycelliosIdentitySchema>;

export const MycelliosSignInMethodsSchema = z.object({
  /** Providers the authority currently offers for linking. */
  available: z.object({ google: z.boolean(), twitter: z.boolean() }),
  /** Every sign-in method of the account, so the last one is never removed. */
  identities: z.array(MycelliosIdentitySchema).max(50),
});
export type MycelliosSignInMethods = z.infer<typeof MycelliosSignInMethodsSchema>;

export const MycelliosIdentityListInput = z.object({ expectedUserId: ExpectedUserId }).strict();
export const MycelliosIdentityLinkInput = z
  .object({
    expectedUserId: ExpectedUserId,
    provider: MycelliosLinkableProviderSchema,
    state: MycelliosIdentityLinkStateSchema,
  })
  .strict();
export const MycelliosIdentityUnlinkInput = z
  .object({ expectedUserId: ExpectedUserId, identityId: z.string().min(1).max(128) })
  .strict();
export const MycelliosIdentityLinkSchema = z.object({ url: z.string().url().max(4096) });
