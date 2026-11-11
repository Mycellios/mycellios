/** Voice failures the user fixes in their own provider account. Clients show their own copy. */
export const VOICE_ACCOUNT_ERROR_CODES = ["VOICE_OUT_OF_CREDIT", "VOICE_KEY_REJECTED"] as const;

export type VoiceAccountErrorCode = (typeof VOICE_ACCOUNT_ERROR_CODES)[number];

export function isVoiceAccountErrorCode(value: unknown): value is VoiceAccountErrorCode {
  return (VOICE_ACCOUNT_ERROR_CODES as readonly unknown[]).includes(value);
}

export const NETWORK_VOICE_ERROR_CODES = [
  "NETWORK_VOICE_KEY_REJECTED", "NETWORK_VOICE_CREDITS", "NETWORK_VOICE_BUSY",
  "NETWORK_VOICE_UNAVAILABLE", "NETWORK_VOICE_TIMEOUT", "NETWORK_VOICE_INVALID_AUDIO",
  "NETWORK_VOICE_NOT_CONNECTED", "NETWORK_VOICE_CONNECTION_UNAVAILABLE",
  "NETWORK_VOICE_ACCESS_DENIED",
] as const;
export type NetworkVoiceErrorCode = (typeof NETWORK_VOICE_ERROR_CODES)[number];
export function isNetworkVoiceErrorCode(value: unknown): value is NetworkVoiceErrorCode {
  return (NETWORK_VOICE_ERROR_CODES as readonly unknown[]).includes(value);
}
