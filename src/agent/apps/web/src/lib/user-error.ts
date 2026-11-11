import { t } from "@lingui/core/macro";
import { isNetworkVoiceErrorCode, isVoiceAccountErrorCode } from "@rakazo/contracts";
import type { CredentialField } from "@rakazo/core";
import { authErrorMessage, MAX_PASSWORD_LENGTH, userErrorMessage } from "@rakazo/core";

/** Text for a failure: human messages pass through; network and implementation detail become copy. */
export function errorText(error: unknown, fallback = t`Something went wrong. Try again.`): string {
  return (
    voiceAccountErrorText(error) ??
    userErrorMessage(error, {
      fallback,
      offline: t`Could not reach the server`,
      integrationSetup: t`This integration needs server setup. Contact the administrator.`,
    })
  );
}

/** Text for an RPC error or `/api/voice` body whose code says the voice account needs attention. */
export function voiceAccountErrorText(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (isNetworkVoiceErrorCode(code)) {
    switch (code) {
      case "NETWORK_VOICE_KEY_REJECTED": return t`Your Mycellios key was rejected. Reconnect it in Models.`;
      case "NETWORK_VOICE_ACCESS_DENIED": return t`Your Mycellios connection cannot use this voice model. Check its access in Models.`;
      case "NETWORK_VOICE_CREDITS": return t`You do not have enough Mycellios credits for this reply.`;
      case "NETWORK_VOICE_BUSY": return t`Mycellios network voice is busy. Try again later or choose local voice.`;
      case "NETWORK_VOICE_TIMEOUT": return t`Mycellios network voice took too long. Try again later or choose local voice.`;
      case "NETWORK_VOICE_INVALID_AUDIO": return t`Mycellios returned invalid speech audio.`;
      case "NETWORK_VOICE_NOT_CONNECTED": return t`Connect your Mycellios account in Models to use network voice.`;
      case "NETWORK_VOICE_CONNECTION_UNAVAILABLE": return t`Your Mycellios connection could not be read. Open Models to check it.`;
      case "NETWORK_VOICE_UNAVAILABLE": return t`Mycellios network voice is unavailable. Try again later or choose local voice.`;
    }
  }
  if (!isVoiceAccountErrorCode(code)) return undefined;
  return code === "VOICE_OUT_OF_CREDIT"
    ? t`Your voice provider is out of credit.`
    : t`Your voice provider key was rejected.`;
}

export function credentialIssueText(field: CredentialField): string {
  return field === "email" ? t`Enter a valid email` : t`Enter a password`;
}

/** Text for a failed Better Auth client result (`{ code, message }`). */
export function authErrorText(error: unknown, fallback: string): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "SSO_UNAVAILABLE") return t`SSO is temporarily unavailable. Try again.`;
  if (code === "account_not_linked") return t`Sign in to your existing account to link SSO`;
  if (code === "REGISTRATION_CLOSED") return t`Registration is closed`;
  if (code === "EMAIL_NOT_ALLOWED") return t`Email is not allowed to register`;
  if (code === "EMAIL_VERIFICATION_REQUIRED" || code === "unable_to_link_account")
    return t`Email verification required`;
  if (code === "REAUTHENTICATION_REQUIRED") return t`Sign in again`;
  if (code === "PASSWORD_AUTH_DISABLED") return t`Password sign-in is turned off on this server`;
  if (code === "PASSWORD_TOO_LONG")
    return t`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`;
  if (code === "EMAIL_DELETION_UNAVAILABLE") return t`Could not continue`;
  if (code === "INVALID_OTP") return t`Invalid code`;
  if (code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS") return t`Request a new code`;
  return authErrorMessage(error, {
    fallback,
    email: credentialIssueText("email"),
    password: credentialIssueText("password"),
  });
}
