import { useSyncExternalStore } from "react";
import { useQueryUserId } from "./query";

const EVENT = "mycellios:developer-mode";
const fallback = new Map<string, boolean>();
const key = (userId: string) => `mycellios.developerMode:${userId}`;

export function getDeveloperMode(userId: string | null | undefined): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key(userId)) === "on";
  } catch {
    return fallback.get(userId) ?? false;
  }
}

export function setDeveloperMode(userId: string | null | undefined, enabled: boolean) {
  if (!userId || typeof window === "undefined") return;
  fallback.set(userId, enabled);
  try {
    window.localStorage.setItem(key(userId), enabled ? "on" : "off");
  } catch {
    /* Retain this tab's choice when browser storage is unavailable. */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** A display preference only; server authorization always remains authoritative. */
export function useDeveloperMode() {
  const userId = useQueryUserId();
  const enabled = useSyncExternalStore(
    subscribe,
    () => getDeveloperMode(userId),
    () => false,
  );
  return [enabled, (value: boolean) => setDeveloperMode(userId, value)] as const;
}
