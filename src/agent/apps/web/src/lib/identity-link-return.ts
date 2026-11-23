import type { MycelliosLinkableProvider } from "@mycellios/contracts";
import { MYCELLIOS_IDENTITY_LINK_STATE_PARAM, MycelliosLinkableProviderSchema } from "@mycellios/contracts";

/** The browser's pending link, kept only for this tab. */
export const IDENTITY_LINK_STORAGE_KEY = "mycellios.identity-link";
const MAX_AGE_MS = 10 * 60_000;
/** Query values the identity authority may add on its return; they never stay in the address. */
const AUTHORITY_QUERY = ["error", "error_code", "error_description", "code"];

export type IdentityLinkReturn =
  | { provider: MycelliosLinkableProvider; result: "linked" }
  | { provider: MycelliosLinkableProvider; result: "failed"; code: string | null };

let captured: IdentityLinkReturn | null = null;

function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** Remembers a new link attempt in this tab and returns the state the server sends back. */
export function beginIdentityLink(
  provider: MycelliosLinkableProvider,
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
): string {
  const state = randomState();
  storage.setItem(IDENTITY_LINK_STORAGE_KEY, JSON.stringify({ state, provider, startedAt: Date.now() }));
  return state;
}

export function forgetIdentityLink(storage: Pick<Storage, "removeItem"> = window.sessionStorage) {
  try {
    storage.removeItem(IDENTITY_LINK_STORAGE_KEY);
  } catch {
    // Nothing to forget when storage is unavailable.
  }
}

/**
 * Reads and removes a provider return from the address before anything else can record
 * it: the authority may append a session in the fragment, which Agent never keeps. The
 * result counts only when the returned state matches this tab's own pending attempt.
 */
export function captureIdentityLinkReturn(
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history,
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
  now = Date.now(),
): IdentityLinkReturn | null {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return null;
  }
  if (!url.searchParams.has(MYCELLIOS_IDENTITY_LINK_STATE_PARAM)) return null;
  const returned = url.searchParams.get(MYCELLIOS_IDENTITY_LINK_STATE_PARAM);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code =
    url.searchParams.get("error_code") ??
    fragment.get("error_code") ??
    url.searchParams.get("error") ??
    fragment.get("error");
  url.searchParams.delete(MYCELLIOS_IDENTITY_LINK_STATE_PARAM);
  for (const key of AUTHORITY_QUERY) url.searchParams.delete(key);
  url.hash = "";
  try {
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
  } catch {
    // The address could not be rewritten; the result is still never stored.
  }
  let pending: { state?: unknown; provider?: unknown; startedAt?: unknown } | null = null;
  try {
    pending = JSON.parse(storage.getItem(IDENTITY_LINK_STORAGE_KEY) ?? "null");
    storage.removeItem(IDENTITY_LINK_STORAGE_KEY);
  } catch {
    return null;
  }
  const provider = MycelliosLinkableProviderSchema.safeParse(pending?.provider);
  if (
    !provider.success ||
    typeof pending?.state !== "string" ||
    pending.state !== returned ||
    typeof pending.startedAt !== "number" ||
    now - pending.startedAt < 0 ||
    now - pending.startedAt > MAX_AGE_MS
  )
    return null;
  captured = code
    ? { provider: provider.data, result: "failed", code: code.slice(0, 100) }
    : { provider: provider.data, result: "linked" };
  return captured;
}

/** The verified provider return captured at startup, handed out once. */
export function takeIdentityLinkReturn(): IdentityLinkReturn | null {
  const value = captured;
  captured = null;
  return value;
}

if (typeof window !== "undefined") {
  try {
    captureIdentityLinkReturn();
  } catch {
    // Startup must continue even if storage or history is unavailable.
  }
}
