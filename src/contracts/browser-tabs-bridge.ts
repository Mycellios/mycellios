/**
 * Chrome tab sharing (specs/agent-chrome-tabs): messages between the Mycellios browser
 * extension's side panel and the Agent API, and between the worker and the API. Plain
 * JSON only; the server never sends code. The extension cannot import TypeScript, so a
 * contract test feeds its real message shapes through these parsers.
 */

/**
 * The capability versions a panel advertises: tab list (phase 1), page reading (phase 2) and
 * acting in pages with downloads held for the person (phases 3 and 4). `act` is advertised
 * only while the person has turned on "Let Micos click and type" in that browser.
 */
export interface BrowserTabsCapabilities { tabs: 1; read?: 1; act?: 1 }
/**
 * The browser that shares: one account and one sign-in session (sha256 of its id). Not
 * bound to a Space: the panel does not choose one, and only the account owner's own runs
 * ever reach it.
 */
export interface BrowserTabsOwner { userId: string; sessionKey: string }

/** The kinds of page action a Mico may ask for; each one acts on an element ref of the last snapshot. */
export const BROWSER_ACT_KINDS = ["click", "fill", "type", "select", "scroll", "key"] as const;
export type BrowserActKind = (typeof BROWSER_ACT_KINDS)[number];
export const BROWSER_SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const;
export interface BrowserAction {
  kind: BrowserActKind;
  /** Element ref from the tab's latest snapshot; optional for scroll and key. */
  ref?: string;
  /** Text for fill, type and select (an option's text or value). */
  text?: string;
  /** One key for key, such as Enter or Tab. */
  key?: string;
  direction?: (typeof BROWSER_SCROLL_DIRECTIONS)[number];
}
export const BROWSER_TABS_MAX_ACTIONS = 24;
export const BROWSER_TABS_TEXT_MAX = 4_000;
/** Chrome's fixed tab group palette; a Mico's color is a stable pick from it. */
export const BROWSER_GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const;
export type BrowserGroupColor = (typeof BROWSER_GROUP_COLORS)[number];
/** Who is working: the name shown on the tab group and the page glow, and the group color. */
export interface BrowserMico { name: string; color: BrowserGroupColor }
export const BROWSER_MICO_NAME_MAX = 32;

export type BrowserTabsRequest =
  | { op: "list" }
  | { op: "snapshot"; tab: string }
  | { op: "navigate"; url: string; tab?: string; newTab?: true; mico: BrowserMico }
  | { op: "act"; tab: string; actions: BrowserAction[]; mico: BrowserMico };
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
/** One action's outcome. `ok` is false when its effect could not be confirmed or it did not run. */
export interface BrowserActStep { ok: boolean; note?: string }
export interface BrowserActed {
  steps: BrowserActStep[];
  /** The page after the actions, read the same way as a snapshot. */
  page?: BrowserPage;
  /** What the person decided for downloads that started while the actions ran. */
  downloads?: ("kept" | "cancelled")[];
}
export type BrowserTabsResult =
  | { tabs: BrowserTab[]; omitted: number }
  | { page: BrowserPage }
  | { acted: BrowserActed }
  | { navigated: { tab: string; title: string; url: string } }
  | { error: BrowserTabsFailure };
/** Settled failures reported by the extension; nothing ran (or only a read). */
export const BROWSER_TABS_FAILURES = [
  "chrome_not_shared", "tabs_permission_missing", "unsupported",
  // Page reading: the person declined or did not answer, the page is refused or not a web
  // page, the tab closed or moved to another site, or Chrome refused the script.
  "declined", "consent_timeout", "refused_site", "not_web_page", "tab_gone", "tab_changed", "not_scriptable",
  // Acting, before anything ran: the person used the tab a moment ago, or navigation was asked
  // for a tab the Mico does not work in. What goes wrong during the steps (a declined password,
  // payment or sign-in, an old ref, an unconfirmed effect) is reported per step, with the steps
  // that did run, never as an error that would hide them.
  "person_active", "tab_not_working",
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

const tabHandle = (value: unknown): value is string => typeof value === "string" && /^t\d{1,12}$/.test(value);

function parsePage(value: unknown): BrowserPage {
  const page = object(value, ["title", "url", "text", "truncated"], "Invalid browser page");
  if (typeof page.title !== "string" || page.title.length > BROWSER_TABS_TITLE_MAX || typeof page.url !== "string" ||
      typeof page.text !== "string" || page.text.length > BROWSER_TABS_PAGE_MAX || typeof page.truncated !== "boolean")
    throw new Error("Invalid browser page");
  const url = browserTabAddress(page.url);
  if (!url) throw new Error("Invalid browser page");
  return { title: page.title, url, text: page.text, truncated: page.truncated };
}

function parseActed(value: unknown): BrowserActed {
  const acted = object(value, ["steps", "page", "downloads"], "Invalid browser action result");
  if (!Array.isArray(acted.steps) || acted.steps.length > BROWSER_TABS_MAX_ACTIONS) throw new Error("Invalid browser action result");
  const steps = acted.steps.map((item): BrowserActStep => {
    const step = object(item, ["ok", "note"], "Invalid browser action result");
    if (typeof step.ok !== "boolean" || (step.note !== undefined && (typeof step.note !== "string" || step.note.length > 200)))
      throw new Error("Invalid browser action result");
    return { ok: step.ok, ...(step.note !== undefined ? { note: step.note as string } : {}) };
  });
  let downloads: ("kept" | "cancelled")[] | undefined;
  if (acted.downloads !== undefined) {
    if (!Array.isArray(acted.downloads) || acted.downloads.length > 8 || acted.downloads.some(item => item !== "kept" && item !== "cancelled"))
      throw new Error("Invalid browser action result");
    downloads = acted.downloads as ("kept" | "cancelled")[];
  }
  return { steps, ...(acted.page !== undefined ? { page: parsePage(acted.page) } : {}), ...(downloads ? { downloads } : {}) };
}

function parseMico(value: unknown): BrowserMico {
  const mico = object(value, ["name", "color"], "Invalid browser tabs request");
  if (typeof mico.name !== "string" || mico.name.length > BROWSER_MICO_NAME_MAX ||
      !(BROWSER_GROUP_COLORS as readonly unknown[]).includes(mico.color)) throw new Error("Invalid browser tabs request");
  return { name: mico.name, color: mico.color as BrowserGroupColor };
}

function parseAction(value: unknown): BrowserAction {
  const input = object(value, ["kind", "ref", "text", "key", "direction"], "Invalid browser tabs request");
  const kind = input.kind;
  if (!(BROWSER_ACT_KINDS as readonly unknown[]).includes(kind)) throw new Error("Invalid browser tabs request");
  const ref = input.ref;
  if (ref !== undefined && (typeof ref !== "string" || !/^e\d{1,6}$/.test(ref))) throw new Error("Invalid browser tabs request");
  if (input.text !== undefined && (typeof input.text !== "string" || input.text.length > BROWSER_TABS_TEXT_MAX)) throw new Error("Invalid browser tabs request");
  if (input.key !== undefined && (typeof input.key !== "string" || input.key.length === 0 || input.key.length > 32)) throw new Error("Invalid browser tabs request");
  if (input.direction !== undefined && !(BROWSER_SCROLL_DIRECTIONS as readonly unknown[]).includes(input.direction)) throw new Error("Invalid browser tabs request");
  // Each kind needs its own inputs: an element for click, fill and select, text for fill, type and
  // select, a key for key, and an element or a direction for scroll.
  const needsRef = kind === "click" || kind === "fill" || kind === "select";
  const needsText = kind === "fill" || kind === "type" || kind === "select";
  if ((needsRef && ref === undefined) || (needsText && input.text === undefined) || (kind === "key" && input.key === undefined) ||
      (kind === "scroll" && ref === undefined && input.direction === undefined)) throw new Error("Invalid browser tabs request");
  return {
    kind: kind as BrowserActKind,
    ...(ref !== undefined ? { ref } : {}),
    ...(input.text !== undefined ? { text: input.text as string } : {}),
    ...(input.key !== undefined ? { key: input.key as string } : {}),
    ...(input.direction !== undefined ? { direction: input.direction as BrowserAction["direction"] } : {}),
  };
}

/** Panel → API: one connection of one panel document (`generation` is new per connection). */
export function parseBrowserTabsRegister(value: unknown): { generation: string; capabilities: BrowserTabsCapabilities } {
  const input = object(value, ["generation", "capabilities"]);
  const capabilities = object(input.capabilities, ["tabs", "read", "act"]);
  // Acting needs reading: refs come from snapshots.
  if (!uuid(input.generation) || capabilities.tabs !== 1 || (capabilities.read !== undefined && capabilities.read !== 1) ||
      (capabilities.act !== undefined && capabilities.act !== 1) || (capabilities.act === 1 && capabilities.read !== 1))
    throw new Error("Invalid browser tabs registration");
  return {
    generation: input.generation.toLowerCase(),
    capabilities: { tabs: 1, ...(capabilities.read === 1 ? { read: 1 as const } : {}), ...(capabilities.act === 1 ? { act: 1 as const } : {}) },
  };
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
  const result = object(input.result, ["tabs", "omitted", "error", "page", "acted", "navigated"], "Invalid browser tabs result");
  const ids = { generation: input.generation.toLowerCase(), id: input.id.toLowerCase() };
  if (result.acted !== undefined) {
    if (Object.keys(result).length !== 1) throw new Error("Invalid browser tabs result");
    return { ...ids, result: { acted: parseActed(result.acted) } };
  }
  if (result.navigated !== undefined) {
    if (Object.keys(result).length !== 1) throw new Error("Invalid browser tabs result");
    const navigated = object(result.navigated, ["tab", "title", "url"], "Invalid browser navigation");
    if (!tabHandle(navigated.tab) || typeof navigated.title !== "string" || navigated.title.length > BROWSER_TABS_TITLE_MAX ||
        typeof navigated.url !== "string") throw new Error("Invalid browser navigation");
    const url = browserTabAddress(navigated.url);
    if (!url) throw new Error("Invalid browser navigation");
    return { ...ids, result: { navigated: { tab: navigated.tab, title: navigated.title, url } } };
  }
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

/**
 * Sites a Mico never reads or acts on in the person's Chrome: Mycellios itself (so a Mico cannot
 * read or approve its own cards or touch the session), the Chrome Web Store and password-manager
 * vaults. The extension carries the same list and checks it before any script runs; a test keeps
 * the two equal. The server checks it again before it asks to open a page.
 */
export const BROWSER_TABS_REFUSED_HOSTS = [
  "mycellios.com", "chromewebstore.google.com", "passwords.google.com", "1password.com", "1password.eu",
  "1password.ca", "bitwarden.com", "bitwarden.eu", "lastpass.com", "dashlane.com", "keepersecurity.com",
  "keepersecurity.eu", "nordpass.com", "proton.me", "roboform.com", "enpass.io",
] as const;

/** Why an address is refused for Micos, or null when the person may be asked about it. */
export function browserTabsRefusedAddress(address: string): "not_web_page" | "refused_site" | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "not_web_page";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "not_web_page";
  if (url.username || url.password) return "refused_site";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "chrome.google.com" && url.pathname.startsWith("/webstore")) return "refused_site";
  return BROWSER_TABS_REFUSED_HOSTS.some(refused => host === refused || host.endsWith(`.${refused}`)) ? "refused_site" : null;
}

export function parseBrowserTabsRequest(value: unknown): BrowserTabsRequest {
  const input = object(value, ["op", "tab", "url", "newTab", "actions", "mico"], "Invalid browser tabs request");
  if (input.op === "list" && Object.keys(input).length === 1) return { op: "list" };
  if (input.op === "snapshot" && tabHandle(input.tab) && Object.keys(input).length === 2) return { op: "snapshot", tab: input.tab };
  if (input.op === "navigate") {
    // An existing tab or a new one, never both and never neither.
    if (typeof input.url !== "string" || input.url.length > BROWSER_TABS_URL_MAX || input.actions !== undefined ||
        (input.tab === undefined) === (input.newTab === undefined) || (input.tab !== undefined && !tabHandle(input.tab)) ||
        (input.newTab !== undefined && input.newTab !== true)) throw new Error("Invalid browser tabs request");
    if (browserTabsRefusedAddress(input.url) !== null) throw new Error("Invalid browser tabs request");
    return {
      op: "navigate", url: input.url, mico: parseMico(input.mico),
      ...(input.tab !== undefined ? { tab: input.tab as string } : {}),
      ...(input.newTab === true ? { newTab: true as const } : {}),
    };
  }
  if (input.op === "act") {
    if (!tabHandle(input.tab) || !Array.isArray(input.actions) || input.actions.length === 0 ||
        input.actions.length > BROWSER_TABS_MAX_ACTIONS || input.url !== undefined || input.newTab !== undefined)
      throw new Error("Invalid browser tabs request");
    return { op: "act", tab: input.tab, actions: input.actions.map(parseAction), mico: parseMico(input.mico) };
  }
  throw new Error("Invalid browser tabs request");
}

/** Worker → API (signed): probe whether a browser shares tabs, or run one operation. */
export function parseBrowserTabsDispatch(value: unknown): { scope: BrowserTabsOwner; nonce: string; probe?: "tabs" | "read" | "act"; request?: BrowserTabsRequest } {
  const input = object(value, ["scope", "nonce", "probe", "request"]);
  const scope = object(input.scope, ["userId", "sessionKey"]);
  if (!id(scope.userId) || !sessionKey(scope.sessionKey) || !uuid(input.nonce))
    throw new Error("Invalid browser tabs dispatch");
  if ((input.probe === undefined) === (input.request === undefined) ||
      (input.probe !== undefined && input.probe !== "tabs" && input.probe !== "read" && input.probe !== "act"))
    throw new Error("Invalid browser tabs dispatch");
  return {
    scope: { userId: scope.userId, sessionKey: scope.sessionKey },
    nonce: input.nonce,
    ...(input.probe === "tabs" || input.probe === "read" || input.probe === "act" ? { probe: input.probe } : {}),
    ...(input.request !== undefined ? { request: parseBrowserTabsRequest(input.request) } : {}),
  };
}
