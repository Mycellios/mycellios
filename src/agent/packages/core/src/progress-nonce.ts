/**
 * clientNonce prefix for a bot's durable mid-turn progress message. The nonce is what tells
 * readers (the reconciler, the message API and the chat) that a message is a progress note,
 * not the turn's answer.
 */
export const USER_PROGRESS_CLIENT_NONCE_PREFIX = "user-progress:";

export function isUserProgressClientNonce(clientNonce: string | null | undefined): boolean {
  return Boolean(clientNonce?.startsWith(USER_PROGRESS_CLIENT_NONCE_PREFIX));
}
