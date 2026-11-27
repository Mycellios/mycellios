// Chrome tab sharing (specs/agent-chrome-tabs, phases 1-4: tab list, page reading, acting and held
// downloads). Runs in the side panel document, so tabs are shared only while a Mycellios panel is open
// and the strip shows it. One panel per profile holds the connection through a Web Lock; the others
// stand by. The server sends JSON operations only; this file never runs code it receives.
import {
  beginAction,
  describeAction,
  endAction,
  overlayVisible,
  performAction,
  preparePage,
  releasePage,
  snapshotPage,
} from "./page-agent.js";
import { actionConsentClass, isPaymentHost, isSignInAddress, refusedPage } from "./sensitive.js";

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
  if (!(await chrome.permissions.contains({ permissions: ["tabs"] })))
    return { error: "tabs_permission_missing" };
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

const tabIdOf = (handle) =>
  typeof handle === "string" && /^t\d{1,12}$/.test(handle) ? Number(handle.slice(1)) : NaN;

/**
 * Whether this browser may use the tab's site: refused sites never, an allowed site at once, any
 * other site only after the person answers the panel's question (`ask`). Nothing the server sends
 * can skip it. `once` tells the caller to remove the grant again when it is done.
 */
async function siteAccess(tab, ask) {
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
  return { origin, origins, once };
}

/**
 * Reads one tab. A site this browser has not allowed asks the person in the panel first
 * (`ask` resolves "once", "always" or "deny"); "once" removes the site's access again after
 * reading. Nothing the server sends can skip that question.
 */
export async function snapshotTab(handle, ask) {
  const id = tabIdOf(handle);
  const tab = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
  if (!tab || tab.incognito || !tab.url) return { error: "tab_gone" };
  const access = await siteAccess(tab, ask);
  if (access.error) return { error: access.error };
  const { origin, origins, once } = access;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: snapshotPage,
      args: [SNAPSHOT_LIMIT],
    });
    const page = injection?.result;
    // The tab may have moved to another site while the person answered.
    if (
      !page ||
      typeof page.href !== "string" ||
      refusedPage(page.href) ||
      new URL(page.href).origin !== origin
    )
      return { error: "tab_changed" };
    return {
      page: {
        title: page.title,
        url: tabAddress(page.href),
        text: page.text,
        truncated: page.truncated === true,
      },
    };
  } catch {
    return { error: "not_scriptable" };
  } finally {
    if (once) await chrome.permissions.remove({ origins }).catch(() => {});
  }
}

// Tabs a Mico works in. The first use of a tab adds it to the Mico's colored tab group, which is
// the indicator a page cannot forge. When the Mico is idle its overlay goes and the person's own
// tabs leave the group; tabs the Mico opened stay grouped until the person closes them.
const IDLE_MS = 90_000;
const GROUP_COLORS = new Set([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);
const working = new Map();
const groups = new Map();
let idleTimer = null;
const cleanName = (name) =>
  String(name ?? "")
    .replace(/[\p{Cc}<>]/gu, "")
    .trim()
    .slice(0, 32) || "Mico";

// Real input. With the optional `debugger` permission, clicks and typing go through Chrome's own
// input pipeline (trusted events, like a person's), so sites that ignore synthetic events still
// respond. Chrome shows its "started debugging this browser" bar while a tab is attached; tabs
// are detached when the Mico's work ends. Without the permission, the synthetic path is used.
const attached = new Set();

let detachWatched = false;

async function realInput(tabId) {
  if (!chrome.debugger) return false;
  if (!detachWatched) {
    // The person can end debugging from Chrome's bar, or the tab can close.
    chrome.debugger.onDetach?.addListener((source) => attached.delete(source.tabId));
    detachWatched = true;
  }
  if (attached.has(tabId)) return true;
  if (!(await chrome.permissions.contains({ permissions: ["debugger"] }).catch(() => false)))
    return false;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
    return true;
  } catch {
    return false;
  }
}

async function detach(tabId) {
  if (!attached.delete(tabId)) return;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

/** Named keys and their Windows key codes; one printable character is typed as itself. */
const KEYS = {
  Enter: [13, "\r"],
  Tab: [9],
  Escape: [27],
  Backspace: [8],
  Delete: [46],
  ArrowUp: [38],
  ArrowDown: [40],
  ArrowLeft: [37],
  ArrowRight: [39],
  Home: [36],
  End: [35],
  PageUp: [33],
  PageDown: [34],
  Space: [32, " "],
};

/** One key press with optional modifiers ("Shift+Tab", "Control+A", "Enter", "."). */
export async function pressKey(tabId, combo) {
  const parts = String(combo).split("+");
  // "+" itself, and combinations ending in it, keep the plus as the key.
  const key = combo.endsWith("+") ? "+" : parts.pop() || "";
  const mods = new Set(parts.map((part) => part.toLowerCase()));
  const modifiers =
    (mods.has("alt") ? 1 : 0) |
    (mods.has("control") || mods.has("ctrl") ? 2 : 0) |
    (mods.has("meta") ? 4 : 0) |
    (mods.has("shift") ? 8 : 0);
  const named = KEYS[key];
  const printable = !named && key.length === 1;
  const keyCode = named?.[0] ?? (printable ? key.toUpperCase().charCodeAt(0) : 0);
  // With Control, Alt or Meta a character is a shortcut, not text.
  const text = modifiers & 7 ? undefined : (named?.[1] ?? (printable ? key : undefined));
  const base = {
    key: key === "Space" ? " " : key,
    code: named ? key : undefined,
    windowsVirtualKeyCode: keyCode,
    modifiers,
  };
  await cdp(tabId, "Input.dispatchKeyEvent", {
    ...base,
    type: text ? "keyDown" : "rawKeyDown",
    ...(text ? { text } : {}),
  });
  await cdp(tabId, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

/** Performs one prepared action with real input, then checks its effect in the page. */
async function performReal(tabId, action) {
  const [{ result: begun } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: beginAction,
    args: [action],
  });
  if (!begun?.ok) return begun ?? { ok: false, note: "the page did not answer" };
  try {
    if (action.kind === "click") {
      const at = { x: begun.x, y: begun.y };
      await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
      await cdp(tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...at,
        button: "left",
        clickCount: 1,
      });
      await cdp(tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...at,
        button: "left",
        clickCount: 1,
      });
    } else if (action.kind === "fill") {
      // The field's text is selected, so this replaces it.
      if (action.text) await cdp(tabId, "Input.insertText", { text: action.text });
      else await pressKey(tabId, "Delete");
    } else if (action.kind === "type") {
      await pressKey(tabId, "Delete");
      for (const char of String(action.text ?? "")) {
        if (char === "\n") await pressKey(tabId, "Enter");
        else await cdp(tabId, "Input.insertText", { text: char });
      }
    } else if (action.kind === "key") {
      await pressKey(tabId, action.key);
    }
  } catch {
    return { ok: false, note: "Chrome did not accept the input" };
  }
  const [{ result: ended } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: endAction,
    args: [action, begun.before],
  });
  return ended ?? { ok: false, note: "the page did not answer" };
}

/** Ends the Mico's work in every tab: overlays go, the person's own tabs leave the group. */
export async function releaseWorking() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const tabs = [...working];
  working.clear();
  groups.clear();
  await Promise.all(
    tabs.map(async ([id, info]) => {
      await chrome.scripting
        .executeScript({ target: { tabId: id }, func: releasePage })
        .catch(() => {});
      await detach(id);
      if (!info.opened) await chrome.tabs.ungroup(id).catch(() => {});
    }),
  );
  for (const id of [...attached]) await detach(id);
}

const keepWorking = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    releaseWorking();
  }, IDLE_MS);
};

async function markWorking(tab, mico, opened) {
  const known = working.get(tab.id);
  working.set(tab.id, { windowId: tab.windowId, opened: opened || known?.opened === true });
  const color = GROUP_COLORS.has(mico?.color) ? mico.color : "green";
  const key = `${tab.windowId}|${cleanName(mico?.name)}|${color}`;
  try {
    if (chrome.tabs.group && chrome.tabGroups) {
      const place = async (groupId) =>
        chrome.tabs.group({
          tabIds: [tab.id],
          ...(groupId === undefined
            ? { createProperties: { windowId: tab.windowId } }
            : { groupId }),
        });
      let groupId;
      try {
        groupId = await place(groups.get(key));
      } catch {
        // The person closed the group: start another.
        groupId = await place(undefined);
      }
      groups.set(key, groupId);
      await chrome.tabGroups.update(groupId, { title: cleanName(mico?.name), color });
    }
  } catch {
    // Grouping is a visible aid; the overlay and the panel still show the work.
  }
  keepWorking();
}

/** Waits until a tab has finished loading a real page, up to `ms`. */
async function settled(id, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab) return null;
    if (tab.status === "complete" && tab.url && tab.url !== "about:blank" && !tab.pendingUrl)
      return tab;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return chrome.tabs.get(id).catch(() => null);
}

const hostName = (address) => {
  try {
    return new URL(address).host;
  } catch {
    return "";
  }
};

/**
 * Opens an address in a new tab, or in a tab the Mico already works in (never in one of the
 * person's other tabs). Sign-in and authorization pages ask the person first, and the page the
 * tab ends on is checked again because redirects can lead anywhere.
 */
export async function navigateTab(request, ui) {
  const refused = refusedPage(request.url);
  if (refused) return { error: refused };
  if (isSignInAddress(request.url)) {
    const answer = await ui.confirm({ kind: "sign_in", site: hostName(request.url), label: "" });
    if (answer === "timeout") return { error: "consent_timeout" };
    if (answer !== "allow") return { error: "declined" };
  }
  let tab;
  let opened = true;
  if (request.newTab) {
    const focused = await chrome.windows.getLastFocused().catch(() => undefined);
    tab = await chrome.tabs.create({
      url: request.url,
      active: false,
      ...(focused?.id !== undefined ? { windowId: focused.id } : {}),
    });
  } else {
    const id = tabIdOf(request.tab);
    const existing = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
    if (!existing || existing.incognito) return { error: "tab_gone" };
    if (!working.has(id)) return { error: "tab_not_working" };
    opened = working.get(id).opened;
    tab = await chrome.tabs.update(id, { url: request.url });
  }
  await markWorking(tab, request.mico, opened);
  const done = await settled(tab.id, 20_000);
  if (!done) return { error: "tab_gone" };
  const final = done.url || request.url;
  if (refusedPage(final)) {
    if (opened) await chrome.tabs.remove(tab.id).catch(() => {});
    else await chrome.tabs.update(tab.id, { url: "about:blank" }).catch(() => {});
    working.delete(tab.id);
    return { error: "refused_site" };
  }
  if (!isSignInAddress(request.url) && isSignInAddress(final)) {
    // A redirect to a sign-in page is still a sign-in.
    const answer = await ui.confirm({ kind: "sign_in", site: hostName(final), label: "" });
    if (answer !== "allow") {
      if (opened) await chrome.tabs.remove(tab.id).catch(() => {});
      else await chrome.tabs.update(tab.id, { url: "about:blank" }).catch(() => {});
      working.delete(tab.id);
      return { error: answer === "timeout" ? "consent_timeout" : "declined" };
    }
  }
  keepWorking();
  return {
    navigated: {
      tab: `t${tab.id}`,
      title: (done.title ?? "").slice(0, TITLE_MAX),
      url: tabAddress(final) ?? tabAddress(request.url),
    },
  };
}

// A download that starts while a Mico acts is held until the person keeps or cancels it. The Mico
// never gets file access to downloads, and downloads outside its actions are never touched.
function watchDownloads(ui, outcomes) {
  if (!chrome.downloads?.onCreated) return async () => {};
  const pending = [];
  const decide = async (item) => {
    await chrome.downloads.pause(item.id).catch(() => {});
    const name =
      String(item.filename || item.finalUrl || item.url || "")
        .split(/[\\/]/)
        .pop()
        ?.split("?")[0] ?? "";
    const answer = await ui.confirm({
      kind: "download",
      site: hostName(item.finalUrl || item.url || ""),
      label: name.slice(0, 120),
    });
    if (answer === "allow") {
      await chrome.downloads.resume(item.id).catch(() => {});
      outcomes.push("kept");
    } else {
      await chrome.downloads.cancel(item.id).catch(() => {});
      await chrome.downloads.erase({ id: item.id }).catch(() => {});
      outcomes.push("cancelled");
    }
  };
  const listener = (item) => {
    pending.push(decide(item).catch(() => {}));
  };
  chrome.downloads.onCreated.addListener(listener);
  return async () => {
    chrome.downloads.onCreated.removeListener(listener);
    await Promise.all(pending);
  };
}

const DECLINED_NOTE = {
  password: "declined by the person: password field",
  payment: "declined by the person: payment details",
  sign_in: "declined by the person: sign-in",
};

/**
 * Acts in one tab: for every action it describes the element, asks the person when a password,
 * payment details or a sign-in are involved (the answer cannot be skipped), performs it, and
 * stops at the first step that did not go through. The result lists every step and the page
 * afterwards. The person's own input in the tab always wins.
 */
export async function actTab(request, ui) {
  const id = tabIdOf(request.tab);
  const tab = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
  if (!tab || tab.incognito || !tab.url) return { error: "tab_gone" };
  const access = await siteAccess(tab, ui.ask);
  if (access.error) return { error: access.error };
  const { origin, origins, once } = access;
  const steps = [];
  const downloads = [];
  let stopDownloads = async () => {};
  try {
    let prepared;
    try {
      [{ result: prepared } = {}] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: preparePage,
        args: [request.mico],
      });
    } catch {
      return { error: "not_scriptable" };
    }
    if (
      !prepared ||
      typeof prepared.href !== "string" ||
      refusedPage(prepared.href) ||
      new URL(prepared.href).origin !== origin
    )
      return { error: "tab_changed" };
    if (prepared.person) {
      if (!working.has(id))
        await chrome.scripting
          .executeScript({ target: { tabId: id }, func: releasePage })
          .catch(() => {});
      return { error: "person_active" };
    }
    await markWorking(tab, request.mico, false);
    stopDownloads = watchDownloads(ui, downloads);
    const stop = (note) => {
      steps.push({ ok: false, note });
      while (steps.length < request.actions.length) steps.push({ ok: false, note: "skipped" });
    };
    for (const action of request.actions) {
      const current = await chrome.tabs.get(id).catch(() => null);
      if (!current || current.incognito) {
        stop("the tab closed");
        break;
      }
      if (!current.url || refusedPage(current.url) || new URL(current.url).origin !== origin) {
        stop("the tab moved to another site: take a new snapshot");
        break;
      }
      let description;
      try {
        [{ result: description } = {}] = await chrome.scripting.executeScript({
          target: { tabId: id },
          func: describeAction,
          args: [action],
        });
      } catch {
        stop("the page did not answer");
        break;
      }
      if (!description || description.error === "stale_ref") {
        stop("stale ref: take a new snapshot");
        break;
      }
      if (description.person) {
        stop("the person started using the tab");
        break;
      }
      if (description.target)
        description.target.pageHasPaymentFrame = (description.frameSources ?? []).some(
          isPaymentHost,
        );
      const kind = actionConsentClass(action, description);
      if (kind) {
        const answer = await ui.confirm({
          kind,
          site: hostName(current.url),
          action: action.kind,
          label: description.field?.label || description.target?.text || "",
        });
        if (answer !== "allow") {
          stop(answer === "timeout" ? "no answer from the person" : DECLINED_NOTE[kind]);
          break;
        }
      }
      let step;
      try {
        // Clicks, typing and keys use real input when Chrome allows it; select and scroll do not need it.
        const real =
          (action.kind === "click" ||
            action.kind === "fill" ||
            action.kind === "type" ||
            action.kind === "key") &&
          (await realInput(id));
        if (real) {
          step = await performReal(id, action);
        } else {
          [{ result: step } = {}] = await chrome.scripting.executeScript({
            target: { tabId: id },
            func: performAction,
            args: [action],
          });
        }
        step ??= { ok: false, note: "the page did not answer" };
      } catch {
        // A click or Enter that opens another page replaces this one, so it cannot answer: that
        // counts as done only if the tab really moved or is loading, never just because the
        // script failed.
        const after = await chrome.tabs.get(id).catch(() => null);
        const moved = after && (after.url !== current.url || after.status === "loading");
        step =
          (action.kind === "click" || action.kind === "key") && moved
            ? { ok: true, note: "the page changed" }
            : { ok: false, note: "the page did not answer" };
      }
      steps.push({
        ok: step.ok === true,
        ...(typeof step.note === "string" ? { note: step.note.slice(0, 200) } : {}),
      });
      if (!step.ok) {
        while (steps.length < request.actions.length) steps.push({ ok: false, note: "skipped" });
        break;
      }
    }
    // A download can start a moment after the click that caused it.
    if (request.actions.some((item) => item.kind === "click" || item.kind === "key"))
      await new Promise((resolve) => setTimeout(resolve, 1200));
    await stopDownloads();
    stopDownloads = async () => {};
    let page;
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: snapshotPage,
        args: [SNAPSHOT_LIMIT],
      });
      if (
        result &&
        typeof result.href === "string" &&
        !refusedPage(result.href) &&
        new URL(result.href).origin === origin &&
        tabAddress(result.href)
      ) {
        page = {
          title: result.title,
          url: tabAddress(result.href),
          text: result.text,
          truncated: result.truncated === true,
        };
      }
    } catch {
      // The page may have been replaced; the steps still report what happened.
    }
    return {
      acted: { steps, ...(page ? { page } : {}), ...(downloads.length ? { downloads } : {}) },
    };
  } finally {
    await stopDownloads();
    if (once) await chrome.permissions.remove({ origins }).catch(() => {});
    keepWorking();
  }
}

/** A screenshot may carry at most this many base64 characters (about 1.8 MB of JPEG). */
const SCREENSHOT_MAX = 2_400_000;

/**
 * A picture of one tab, for models that see images, taken without the Mico's overlay. Reading a
 * site's pixels is reading the site, so it asks like a snapshot. With the debugger permission any
 * tab can be captured, scaled to at most 1280 CSS pixels wide; without it only the visible tab of
 * its window.
 */
export async function screenshotTab(handle, ask) {
  const id = tabIdOf(handle);
  const tab = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
  if (!tab || tab.incognito || !tab.url) return { error: "tab_gone" };
  const access = await siteAccess(tab, ask);
  if (access.error) return { error: access.error };
  const { origin, origins, once } = access;
  let hidden = false;
  try {
    let viewport;
    try {
      [{ result: viewport } = {}] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: overlayVisible,
        args: [false],
      });
      hidden = true;
    } catch {
      return { error: "not_scriptable" };
    }
    const current = await chrome.tabs.get(id).catch(() => null);
    if (!current?.url || refusedPage(current.url) || new URL(current.url).origin !== origin)
      return { error: "tab_changed" };
    let data;
    const shoot = async (quality) => {
      if (await realInput(id)) {
        const width = Math.max(1, viewport?.width ?? 1280);
        const height = Math.max(1, viewport?.height ?? 800);
        const scale = Math.min(1, 1280 / width);
        const shot = await cdp(id, "Page.captureScreenshot", {
          format: "jpeg",
          quality,
          clip: { x: 0, y: 0, width, height, scale },
        });
        return shot?.data;
      }
      if (!current.active) return undefined;
      const url = await chrome.tabs.captureVisibleTab(current.windowId, {
        format: "jpeg",
        quality,
      });
      return typeof url === "string" ? url.slice(url.indexOf(",") + 1) : undefined;
    };
    try {
      data = await shoot(70);
      if (data && data.length > SCREENSHOT_MAX) data = await shoot(40);
    } catch {
      data = undefined;
    }
    if (!data || data.length > SCREENSHOT_MAX) return { error: "not_capturable" };
    return { screenshot: { mimeType: "image/jpeg", data } };
  } finally {
    if (hidden)
      await chrome.scripting
        .executeScript({ target: { tabId: id }, func: overlayVisible, args: [true] })
        .catch(() => {});
    if (once) await chrome.permissions.remove({ origins }).catch(() => {});
    // Detaches the debugger again once the Mico stops working.
    keepWorking();
  }
}

async function run(request, ui) {
  if (request?.op === "list") return listTabs();
  if (request?.op === "snapshot") return snapshotTab(request.tab, ui.ask);
  if (request?.op === "screenshot") return screenshotTab(request.tab, ui.ask);
  // Acting needs the person's separate switch, checked again now in case it was just turned off.
  if (
    (request?.op === "navigate" || request?.op === "act") &&
    ui.actAllowed &&
    (await ui.actAllowed())
  ) {
    return request.op === "navigate" ? navigateTab(request, ui) : actTab(request, ui);
  }
  return { error: "unsupported" };
}

const pause = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Starts sharing for this panel. `ask` puts a site question in front of the person. `extras` carry
 * what acting needs: `confirm` (a password, payment, sign-in or download question, answered
 * "allow", "deny" or "timeout") and `actAllowed` (the person's own switch plus the downloads
 * permission). `onState` receives "connecting", "sharing", "standby" (another panel holds the
 * connection), "signed-out" or "offline". Returns a stop function; `revoke` also tells the server
 * to drop this browser at once (Stop sharing).
 */
export function startSharing(onState, ask, extras = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  let generation = null;
  let holder = false;
  const ui = {
    ask,
    confirm: extras.confirm ?? (async () => "deny"),
    actAllowed: extras.actAllowed,
  };

  const connection = async () => {
    holder = true;
    let backoff = 2_000;
    while (!signal.aborted) {
      generation = crypto.randomUUID();
      onState("connecting");
      try {
        const act = ui.actAllowed ? await ui.actAllowed().catch(() => false) : false;
        const registered = await post(
          "register",
          { generation, capabilities: { tabs: 1, read: 1, ...(act ? { act: 1 } : {}) } },
          signal,
        );
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
          // Operations run on their own: one that waits for the person (a question, a held
          // download) must not stop the next poll, or the server would think this panel is gone.
          for (const { id, request } of operations) {
            run(request, ui)
              .catch(() => ({ error: "unsupported" }))
              .then((result) => post("result", { generation, id, result }, signal))
              .catch(() => {});
          }
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
    // Stop sharing: overlays go and the person's own tabs leave the Mico's group.
    await releaseWorking();
    if (holder && generation) {
      await post(revoke ? "revoke" : "release", { generation }, undefined, true).catch(() => {});
    } else if (revoke) {
      // Another panel holds the connection: revoking ends that session's sharing too.
      await post("revoke", { generation: crypto.randomUUID() }, undefined, true).catch(() => {});
    }
  };
}
