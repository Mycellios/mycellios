// Chrome tab sharing (specs/agent-chrome-tabs, phases 1-2: tab list and page reading). Runs in the side
// panel document, so tabs are shared only while a Mycellios panel is open and the strip shows
// it. One panel per profile holds the connection through a Web Lock; the others stand by.
// The server sends JSON operations only; this file never runs code it receives.
import { snapshotPage } from "./page-agent.js";
import { refusedPage } from "./sensitive.js";

const API = "https://www.mycellios.com/agent/api/browser-tabs";
/** A whole snapshot, in characters, before it is cut with `truncated`. */
const SNAPSHOT_LIMIT = 48_000;
const LOCK = "mycellios-browser-tabs";
const MAX_TABS = 50;
const TITLE_MAX = 200;

const headers = { "content-type": "application/json", "x-mycellios-extension": "1" };

async function post(action, body, signal, keepalive = false) {
  return fetch(`${API}/${action}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers,
    body: JSON.stringify(body),
    signal,
    keepalive,
  });
}

/** Origin and path of an http(s) address; null for every other page. */
export function tabAddress(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const address = `${url.origin}${url.pathname}`;
    return address.length <= 2048 ? address : null;
  } catch {
    return null;
  }
}

/** The list operation: titles and addresses only, the focused window's active tab first. */
export async function listTabs() {
  if (!(await chrome.permissions.contains({ permissions: ["tabs"] }))) return { error: "tabs_permission_missing" };
  const [tabs, focused] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getLastFocused().catch(() => undefined),
  ]);
  const ordered = tabs
    .filter((tab) => !tab.incognito && typeof tab.id === "number" && tab.id >= 0)
    .sort((a, b) => {
      const rank = (tab) => (tab.windowId === focused?.id ? (tab.active ? 0 : 1) : 2);
      return rank(a) - rank(b) || a.windowId - b.windowId || a.index - b.index;
    });
  const listed = [];
  let omitted = 0;
  for (const tab of ordered) {
    const url = tab.url ? tabAddress(tab.url) : null;
    if (!url || listed.length >= MAX_TABS) {
      omitted += 1;
      continue;
    }
    listed.push({
      tab: `t${tab.id}`,
      title: (tab.title ?? "").slice(0, TITLE_MAX),
      url,
      active: tab.active === true,
      audible: tab.audible === true,
    });
  }
  return { tabs: listed, omitted };
}

/**
 * Reads one tab. A site this browser has not allowed asks the person in the panel first
 * (`ask` resolves "once", "always" or "deny"); "once" removes the site's access again after
 * reading. Nothing the server sends can skip that question.
 */
export async function snapshotTab(handle, ask) {
  const id = typeof handle === "string" && /^t\d{1,12}$/.test(handle) ? Number(handle.slice(1)) : NaN;
  const tab = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
  if (!tab || tab.incognito || !tab.url) return { error: "tab_gone" };
  const refused = refusedPage(tab.url);
  if (refused) return { error: refused };
  const origin = new URL(tab.url).origin;
  const origins = [`${origin}/*`];
  let once = false;
  if (!(await chrome.permissions.contains({ origins }))) {
    const answer = await ask({ site: new URL(tab.url).host, origins });
    if (answer === "timeout") return { error: "consent_timeout" };
    if (answer !== "once" && answer !== "always") return { error: "declined" };
    once = answer === "once";
  }
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: id }, func: snapshotPage, args: [SNAPSHOT_LIMIT] });
    const page = injection?.result;
    // The tab may have moved to another site while the person answered.
    if (!page || typeof page.href !== "string" || refusedPage(page.href) || new URL(page.href).origin !== origin) return { error: "tab_changed" };
    return { page: { title: page.title, url: tabAddress(page.href), text: page.text, truncated: page.truncated === true } };
  } catch {
    return { error: "not_scriptable" };
  } finally {
    if (once) await chrome.permissions.remove({ origins }).catch(() => {});
  }
}

async function run(request, ask) {
  if (request?.op === "list") return listTabs();
  if (request?.op === "snapshot") return snapshotTab(request.tab, ask);
  return { error: "unsupported" };
}

const pause = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Starts sharing for this panel. `ask` puts a site question in front of the person. `onState` receives "connecting", "sharing", "standby" (another
 * panel holds the connection), "signed-out" or "offline". Returns a stop function; `revoke`
 * also tells the server to drop this browser at once (Stop sharing).
 */
export function startSharing(onState, ask) {
  const controller = new AbortController();
  const { signal } = controller;
  let generation = null;
  let holder = false;

  const connection = async () => {
    holder = true;
    let backoff = 2_000;
    while (!signal.aborted) {
      generation = crypto.randomUUID();
      onState("connecting");
      try {
        const registered = await post("register", { generation, capabilities: { tabs: 1, read: 1 } }, signal);
        if (registered.status === 401) {
          onState("signed-out");
          await pause(30_000, signal);
          continue;
        }
        if (!registered.ok) throw new Error("register");
        onState("sharing");
        backoff = 2_000;
        while (!signal.aborted) {
          const response = await post("poll", { generation, wait: true }, signal);
          if (response.status === 401) {
            onState("signed-out");
            break;
          }
          if (!response.ok) throw new Error("poll");
          const { operations = [] } = await response.json();
          await Promise.all(operations.map(async ({ id, request }) => {
            const result = await run(request, ask).catch(() => ({ error: "unsupported" }));
            await post("result", { generation, id, result }, signal).catch(() => {});
          }));
        }
      } catch {
        if (signal.aborted) break;
        onState("offline");
        await pause(backoff, signal);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  };

  onState("standby");
  // ifAvailable is not used: a panel waits for the lock and takes over when the holder closes.
  navigator.locks.request(LOCK, { signal }, connection).catch(() => {});

  const release = () => {
    if (holder && generation) post("release", { generation }, undefined, true).catch(() => {});
  };
  addEventListener("pagehide", release);

  return async ({ revoke = false } = {}) => {
    removeEventListener("pagehide", release);
    controller.abort();
    if (holder && generation) {
      await post(revoke ? "revoke" : "release", { generation }, undefined, true).catch(() => {});
    } else if (revoke) {
      // Another panel holds the connection: revoking ends that session's sharing too.
      await post("revoke", { generation: crypto.randomUUID() }, undefined, true).catch(() => {});
    }
  };
}
