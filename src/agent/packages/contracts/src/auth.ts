import { z } from "zod";

/** A Desktop release version, `major.minor.patch` without prerelease or build suffixes. */
export const DESKTOP_VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** Whether `version` is an older Desktop release than `minimum`; unreadable versions never are. */
export function isBelowDesktopMinimum(version: string, minimum: string): boolean {
  if (!DESKTOP_VERSION_PATTERN.test(version) || !DESKTOP_VERSION_PATTERN.test(minimum)) return false;
  const current = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) return current[index]! < required[index]!;
  }
  return false;
}

export const authCapabilitiesSchema = z.object({
  sso: z
    .object({
      name: z.string().min(1),
      availability: z.enum(["available", "unavailable", "checking"]),
    })
    .nullable(),
  passwordAuth: z.boolean(),
  mycelliosAccount: z.boolean().optional(),
  passwordReset: z.boolean(),
  resetUrl: z.string().url().nullable(),
  // Older servers omit this field; clients treat omission as unavailable.
  emailCode: z.boolean().optional(),
  billing: z.boolean().optional(),
  /** WebAuthn relying party ID; null or omitted when this server does not offer passkeys. */
  passkeyRpId: z.string().min(1).nullable().optional(),
  /** Native apps this domain vouches for; omitted by older servers, which means none. */
  nativePasskeys: z.object({ ios: z.boolean(), android: z.boolean() }).optional(),
  /** Desktop releases below this version must update before continuing; omitted or null means none. */
  desktopMinimumVersion: z
    .string()
    .regex(DESKTOP_VERSION_PATTERN)
    .nullable()
    .optional(),
});
export type AuthCapabilities = z.infer<typeof authCapabilitiesSchema>;

export const accountSecuritySchema = z.object({
  hasPassword: z.boolean(),
  // Older servers omit this field; clients treat omission as enabled.
  passwordChangeEnabled: z.boolean().optional(),
  freshOidcAuth: z.boolean(),
  ssoLinked: z.boolean(),
  emailDeletion: z.boolean(),
  sso: z.object({ name: z.string().min(1) }).nullable(),
});
export type AccountSecurity = z.infer<typeof accountSecuritySchema>;

/** Only a complete pre-SSO shape may opt into password-only compatibility. */
export const legacyAuthCapabilitiesSchema = authCapabilitiesSchema
  .omit({ sso: true, passwordAuth: true })
  .strict()
  .transform((value) => ({ ...value, passwordAuth: true, sso: null }));

/** Pre-SSO servers only had credential accounts and password-protected deletion. */
export const legacyAccountSecurity: AccountSecurity = {
  hasPassword: true,
  passwordChangeEnabled: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: false,
  sso: null,
};
