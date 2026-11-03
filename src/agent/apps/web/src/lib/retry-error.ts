import { t } from "@lingui/core/macro";
const UNSAFE_RETRY = "This request already produced output or actions. Continue in the chat to avoid repeating them.";
export function isUnsafeRunRetry(error: unknown): boolean {
 if (typeof error === "object" && error !== null && "code" in error && error.code !== "CONFLICT") return false;
 return typeof error === "object" && error !== null && "message" in error && error.message === UNSAFE_RETRY;
}
export function unsafeRunRetryText(): string {
 return t`This request stopped after producing results or actions. Send a new message to continue; retrying it could repeat actions.`;
}
