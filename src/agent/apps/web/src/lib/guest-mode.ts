import { t } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import type { GuestLimits } from "./guest-chat";

/**
 * Guest mode (specs/guest-chat/spec.md): a signed-out visitor sees the ordinary Agent shell,
 * backed by a browser-local guest data layer (guest-rpc.ts) instead of the Agent API. Features
 * that need an account stay visible but disabled; the only server route a guest reaches is the
 * coordinator's text-only /mobile/v1/guest chat, which enforces its own limits.
 */
export const GUEST_USER_ID = "guest";
export const GUEST_SPACE_ID = "guest-space";
export const GUEST_BOT_ID = "guest-mico";
export const GUEST_THREAD_ID = "guest-thread";

type GuestState = { limits: GuestLimits } | null;
let state: GuestState = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function activateGuestMode(limits: GuestLimits): void {
  if (state?.limits === limits) return;
  state = { limits };
  notify();
}

export function leaveGuestMode(): void {
  if (!state) return;
  state = null;
  notify();
}

export function guestModeActive(): boolean {
  return state !== null;
}

export function guestLimits(): GuestLimits | null {
  return state?.limits ?? null;
}

export function subscribeGuestMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGuestMode(): boolean {
  return useSyncExternalStore(subscribeGuestMode, guestModeActive, () => false);
}

/** Free messages left in this guest session, as the coordinator last reported; null when unknown. */
let remaining: number | null = null;
const remainingListeners = new Set<() => void>();
export function setGuestRemaining(value: number | null): void {
  if (remaining === value) return;
  remaining = value;
  for (const listener of remainingListeners) listener();
}
export function useGuestRemaining(): number | null {
  return useSyncExternalStore(listener => {
    remainingListeners.add(listener);
    return () => { remainingListeners.delete(listener); };
  }, () => remaining, () => null);
}

/** Raised by the guest data layer for anything that needs an account. */
export class GuestAccountRequiredError extends Error {
  readonly code = "GUEST_ACCOUNT_REQUIRED";
  constructor(readonly feature?: string) {
    super(t`Create a free account to use this.`);
  }
}

export function isGuestAccountRequired(error: unknown): error is GuestAccountRequiredError {
  return error instanceof GuestAccountRequiredError
    || (Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "GUEST_ACCOUNT_REQUIRED");
}

/** Asks the guest shell to offer an account; a no-op outside guest mode. */
const promptListeners = new Set<(feature?: string) => void>();
export function promptGuestAccount(feature?: string): void {
  for (const listener of promptListeners) listener(feature);
}
export function onGuestAccountPrompt(listener: (feature?: string) => void): () => void {
  promptListeners.add(listener);
  return () => { promptListeners.delete(listener); };
}

// Dev only: guest state lives in this module, so an edit reloads the page instead of keeping two copies.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
