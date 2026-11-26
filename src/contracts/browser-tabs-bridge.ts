/**
 * Chrome tab sharing (specs/agent-chrome-tabs): messages between the Mycellios browser
 * extension's side panel and the Agent API, and between the worker and the API. Plain
 * JSON only; the server never sends code. The extension cannot import TypeScript, so a
 * contract test feeds its real message shapes through these parsers.
 */

/** The capability versions a panel advertises: tab list (phase 1) and page reading (phase 2). */
export interface BrowserTabsCapabilities { tabs: 1; read?: 1 }
/**
 * The browser that shares: one account and one sign-in session (sha256 of its id). Not
 * bound to a Space: the panel does not choose one, and only the account owner's own runs
 * ever reach it.
 */
export interface BrowserTabsOwner { userId: string; sessionKey: string }

export type BrowserTabsRequest = { op: "list" } | { op: "snapshot"; tab: string };
export interface BrowserTabsOperation { id: string; request: BrowserTabsRequest }
export interface BrowserTab {
  /** Opaque handle for later phases: "t" and Chrome's numeric tab id. */
  tab: string;
  title: string;
  /** Origin and path only: the extension drops the query and the fragment. */
  url: string;
  active: boolean;
  audible: boolean;
}
export interface BrowserPage { title: string; url: string; text: string; truncated: boolean }
export type BrowserTabsResult =
  | { tabs: BrowserTab[]; omitted: number }
  | { page: BrowserPage }
  | { error: BrowserTabsFailure };
/** Settled failures reported by the extension; nothing ran (or only a read). */
export const BROWSER_TABS_FAILURES = [
  "chrome_not_shared", "tabs_permission_missing", "unsupported",
  // Page reading: the person declined or did not answer, the page is refused or not a web
  // page, the tab closed or moved to another site, or Chrome refused the script.
  "declined", "consent_timeout", "refused_site", "not_web_page", "tab_gone", "tab_changed", "not_scriptable",
] as const;
export type BrowserTabsFailure = (typeof BROWSER_TABS_FAILURES)[number];
/** The page text a snapshot may carry, in characters. */
export const BROWSER_TABS_PAGE_MAX = 48_000;

export const BROWSER_TABS_MAX_TABS = 50;
export const BROWSER_TABS_TITLE_MAX = 200;
export const BROWSER_TABS_URL_MAX = 2_048;
/** Bounded bodies for every bridge route. */
export const BROWSER_TABS_MAX_BYTES = 64 * 1_024;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const sessionKey = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function object(value: unknown, fields: readonly string[], message = "Invalid browser tabs message"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(message);
  return value as Record<string, unknown>;
}

/** Panel → API: one connection of one panel document (`generation` is new per connection). */
export function parseBrowserTabsRegister(value: unknown): { generation: string; capabilities: BrowserTabsCapabilities } {
  const input = object(value, ["generation", "capabilities"]);
  const capabilities = object(input.capabilities, ["tabs", "read"]);
  if (!uuid(input.generation) || capabilities.tabs !== 1 || (capabilities.read !== undefined && capabilities.read !== 1))
    throw new Error("Invalid browser tabs registration");
  return { generation: input.generation.toLowerCase(), capabilities: { tabs: 1, ...(capabilities.read === 1 ? { read: 1 as const } : {}) } };
}

/** Panel → API: long poll, release (panel closing) and revoke (Stop sharing). */
export function parseBrowserTabsPoll(value: unknown): { generation: string; wait?: boolean } {
  const input = object(value, ["generation", "wait"]);
  if (!uuid(input.generation) || (input.wait !== undefined && typeof input.wait !== "boolean")) throw new Error("Invalid browser tabs poll");
  return { generation: input.generation.toLowerCase(), ...(input.wait !== undefined ? { wait: input.wait } : {}) };
}

/** Keeps a tab address to http(s) origin and path, or null when it is not one. */
export function browserTabAddress(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const address = `${url.origin}${url.pathname}`;
  return address.length <= BROWSER_TABS_URL_MAX ? address : null;
}

function parseTab(value: unknown): BrowserTab {
  const input = object(value, ["tab", "title", "url", "active", "audible"], "Invalid browser tab");
  if (typeof input.tab !== "string" || !/^t\d{1,12}$/.test(input.tab) || typeof input.title !== "string" ||
      input.title.length > BROWSER_TABS_TITLE_MAX || typeof input.url !== "string" ||
      typeof input.active !== "boolean" || typeof input.audible !== "boolean") throw new Error("Invalid browser tab");
  // The extension already drops the query and fragment; a server never trusts that alone.
  const url = browserTabAddress(input.url);
  if (!url) throw new Error("Invalid browser tab");
  return { tab: input.tab, title: input.title, url, active: input.active, audible: input.audible };
}

/** Panel → API: the result of one operation. */
export function parseBrowserTabsResult(value: unknown): { generation: string; id: string; result: BrowserTabsResult } {
  const input = object(value, ["generation", "id", "result"]);
  if (!uuid(input.generation) || !uuid(input.id)) throw new Error("Invalid browser tabs result");
  const result = object(input.result, ["tabs", "omitted", "error", "page"], "Invalid browser tabs result");
  const ids = { generation: input.generation.toLowerCase(), id: input.id.toLowerCase() };
  if (result.error !== undefined) {
    if (Object.keys(result).length !== 1 || !(BROWSER_TABS_FAILURES as readonly unknown[]).includes(result.error))
      throw new Error("Invalid browser tabs result");
    return { ...ids, result: { error: result.error as BrowserTabsFailure } };
  }
  if (result.page !== undefined) {
    if (Object.keys(result).length !== 1) throw new Error("Invalid browser tabs result");
    const page = object(result.page, ["title", "url", "text", "truncated"], "Invalid browser page");
    if (typeof page.title !== "string" || page.title.length > BROWSER_TABS_TITLE_MAX || typeof page.url !== "string" ||
        typeof page.text !== "string" || page.text.length > BROWSER_TABS_PAGE_MAX || typeof page.truncated !== "boolean")
      throw new Error("Invalid browser page");
    const url = browserTabAddress(page.url);
    if (!url) throw new Error("Invalid browser page");
    return { ...ids, result: { page: { title: page.title, url, text: page.text, truncated: page.truncated } } };
  }
  if (!Array.isArray(result.tabs) || result.tabs.length > BROWSER_TABS_MAX_TABS || typeof result.omitted !== "number" ||
      !Number.isSafeInteger(result.omitted) || result.omitted < 0 || result.omitted > 100_000)
    throw new Error("Invalid browser tabs result");
  return { generation: input.generation.toLowerCase(), id: input.id.toLowerCase(), result: { tabs: result.tabs.map(parseTab), omitted: result.omitted } };
}

export function parseBrowserTabsRequest(value: unknown): BrowserTabsRequest {
  const input = object(value, ["op", "tab"], "Invalid browser tabs request");
  if (input.op === "list" && input.tab === undefined) return { op: "list" };
  if (input.op === "snapshot" && typeof input.tab === "string" && /^t\d{1,12}$/.test(input.tab)) return { op: "snapshot", tab: input.tab };
  throw new Error("Invalid browser tabs request");
}

/** Worker → API (signed): probe whether a browser shares tabs, or run one operation. */
export function parseBrowserTabsDispatch(value: unknown): { scope: BrowserTabsOwner; nonce: string; probe?: "tabs" | "read"; request?: BrowserTabsRequest } {
  const input = object(value, ["scope", "nonce", "probe", "request"]);
  const scope = object(input.scope, ["userId", "sessionKey"]);
  if (!id(scope.userId) || !sessionKey(scope.sessionKey) || !uuid(input.nonce))
    throw new Error("Invalid browser tabs dispatch");
  if ((input.probe === undefined) === (input.request === undefined) || (input.probe !== undefined && input.probe !== "tabs" && input.probe !== "read"))
    throw new Error("Invalid browser tabs dispatch");
  return {
    scope: { userId: scope.userId, sessionKey: scope.sessionKey },
    nonce: input.nonce,
    ...(input.probe === "tabs" || input.probe === "read" ? { probe: input.probe } : {}),
    ...(input.request !== undefined ? { request: parseBrowserTabsRequest(input.request) } : {}),
  };
}
