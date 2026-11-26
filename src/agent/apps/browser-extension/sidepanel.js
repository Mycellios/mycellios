// Opens the hosted Mycellios Agent in the side panel. The hosted app's CSP lets only this
// extension's origin frame it; sign-in happens in a normal tab because the identity pages refuse
// to be framed, and the panel picks up the shared session once it exists.
import { startSharing } from "./tabs-bridge.js";

const AGENT_ORIGIN = "https://www.mycellios.com";
const AGENT_URL = `${AGENT_ORIGIN}/agent/app`;
const SESSION_URL = `${AGENT_ORIGIN}/agent/api/auth/get-session`;
const SIGN_IN_POLL_MS = 2000;

const t = (key) => chrome.i18n.getMessage(key) || key;
const notice = document.getElementById("notice");
const title = document.getElementById("notice-title");
const primary = document.getElementById("primary");
const secondary = document.getElementById("secondary");
const app = document.getElementById("app");

const appearanceKey = "mycellios.panel.appearance";
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const designs = new Set(["original", "light", "dark", "system"]);
const design = document.getElementById("design");
const discreet = document.getElementById("discreet");
const root = document.documentElement;

root.lang = chrome.i18n.getUILanguage();
for (const label of document.querySelectorAll("[data-i18n]")) {
  label.textContent = t(label.dataset.i18n);
}

function readAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey) || "null");
    return {
      design: designs.has(saved?.design) ? saved.design : "original",
      discreet: saved?.discreet === true,
    };
  } catch {
    return { design: "original", discreet: false };
  }
}

function loadAppearance() {
  const saved = readAppearance();
  design.value = saved.design;
  discreet.checked = saved.discreet;
  applyAppearance();
}

function sendAppearance() {
  if (!app.getAttribute("src")) return;
  app.contentWindow?.postMessage({
    type: "mycellios:browser-panel-appearance",
    theme: root.dataset.theme,
    discreet: discreet.checked,
  }, AGENT_ORIGIN);
}

function applyAppearance() {
  root.dataset.theme = design.value === "system" ? (systemDark.matches ? "dark" : "light") : design.value;
  root.toggleAttribute("data-discreet", discreet.checked);
  if (title.dataset.message) title.textContent = noticeText(title.dataset.message);
  sendAppearance();
}

function saveAppearance() {
  try {
    localStorage.setItem(appearanceKey, JSON.stringify({ design: design.value, discreet: discreet.checked }));
  } catch {
    // The controls still apply for the open panel if storage is unavailable.
  }
  applyAppearance();
}

function noticeText(key) {
  return t(discreet.checked ? `${key}Discreet` : key);
}

design.addEventListener("change", saveAppearance);
discreet.addEventListener("change", saveAppearance);
systemDark.addEventListener("change", applyAppearance);
window.addEventListener("storage", event => {
  if (event.key === appearanceKey || event.key === null) loadAppearance();
  // Another panel turned sharing on or off for this profile.
  if ((event.key === "mycellios.panel.shareTabs" || event.key === null) && !shareStrip.hidden) syncSharing();
});
app.addEventListener("load", sendAppearance);
loadAppearance();

let pollTimer = null;

async function sessionState() {
  try {
    const response = await fetch(SESSION_URL, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return "unavailable";
    const session = await response.json();
    return session?.user ? "signed-in" : "signed-out";
  } catch {
    return "unavailable";
  }
}

function openTab(url) {
  chrome.tabs.create({ url });
}

function showNotice(message, primaryLabel, onPrimary) {
  app.hidden = true;
  notice.hidden = false;
  title.dataset.message = message;
  title.textContent = noticeText(message);
  primary.textContent = primaryLabel;
  primary.onclick = onPrimary;
  secondary.textContent = t("openInTab");
  secondary.onclick = () => openTab(AGENT_URL);
}

function showApp() {
  stopPolling();
  notice.hidden = true;
  if (!app.src) app.src = AGENT_URL;
  app.hidden = false;
  shareStrip.hidden = false;
  syncSharing();
}

// Tab sharing (specs/agent-chrome-tabs): off until the person turns it on in this browser
// profile. The choice is kept here; the connection exists only while a panel is open.
const shareKey = "mycellios.panel.shareTabs";
const shareStrip = document.getElementById("tabs-share");
const shareStatus = document.getElementById("tabs-share-status");
const shareToggle = document.getElementById("tabs-share-toggle");
const shareDetail = document.getElementById("tabs-share-detail");
const shareLabels = {
  connecting: "shareTabsConnecting",
  sharing: "shareTabsSharing",
  standby: "shareTabsStandby",
  "signed-out": "shareTabsSignedOut",
  offline: "shareTabsOffline",
};
let stopSharing = null;

function shareChosen() {
  try {
    return localStorage.getItem(shareKey) === "on";
  } catch {
    return false;
  }
}

function chooseSharing(on) {
  try {
    if (on) localStorage.setItem(shareKey, "on");
    else localStorage.removeItem(shareKey);
  } catch {
    // Without storage the choice lasts while this panel is open.
  }
}

function showShareState(state) {
  const on = state !== "off";
  root.toggleAttribute("data-sharing", state === "sharing" || state === "standby");
  shareStatus.textContent = t(on ? shareLabels[state] : "shareTabsOff");
  shareToggle.textContent = t(on ? "shareTabsStop" : "shareTabsOn");
  shareToggle.classList.toggle("secondary", on);
  shareDetail.hidden = on;
  chrome.action.setBadgeText({ text: state === "sharing" ? "•" : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#2f7d4f" }).catch(() => {});
}

async function syncSharing() {
  const wanted = shareChosen() && await chrome.permissions.contains({ permissions: ["tabs"] }).catch(() => false);
  if (wanted && !stopSharing) {
    stopSharing = startSharing(showShareState, askSite);
  } else if (!wanted && stopSharing) {
    const stop = stopSharing;
    stopSharing = null;
    await stop();
  }
  if (!wanted) showShareState("off");
}

// The site question for page reading. Only this extension page can answer it: the framed app
// and the pages themselves cannot reach these buttons. Buttons arm after 500 ms so a click
// meant for something else cannot answer, and the question expires before the server gives up.
const consent = document.getElementById("tabs-consent");
const consentText = document.getElementById("tabs-consent-text");
const consentButtons = ["once", "always", "deny"].map((choice) => [choice, document.getElementById(`tabs-consent-${choice}`)]);
const CONSENT_ARM_MS = 500;
const CONSENT_TIMEOUT_MS = 75_000;
let consentQueue = Promise.resolve();

function askSite({ site, origins }) {
  const asked = consentQueue.then(() => new Promise((resolve) => {
    consentText.textContent = t("consentQuestion").replace("{site}", site);
    consent.hidden = false;
    for (const [, button] of consentButtons) button.disabled = true;
    const arm = setTimeout(() => { for (const [, button] of consentButtons) button.disabled = false; }, CONSENT_ARM_MS);
    const finish = (answer) => {
      clearTimeout(arm);
      clearTimeout(expire);
      consent.hidden = true;
      for (const [, button] of consentButtons) button.onclick = null;
      resolve(answer);
    };
    const expire = setTimeout(() => finish("timeout"), CONSENT_TIMEOUT_MS);
    for (const [choice, button] of consentButtons) {
      button.onclick = () => {
        if (choice === "deny") return finish("deny");
        // Chrome's own site prompt needs this click's user gesture.
        chrome.permissions.request({ origins }).then((granted) => finish(granted ? choice : "deny"), () => finish("deny"));
      };
    }
  }));
  consentQueue = asked.catch(() => {});
  return asked;
}

shareToggle.addEventListener("click", async () => {
  if (stopSharing || shareChosen()) {
    chooseSharing(false);
    const stop = stopSharing;
    stopSharing = null;
    showShareState("off");
    await stop?.({ revoke: true });
    return;
  }
  // Chrome's own prompt explains the tabs permission; it needs this click's user gesture.
  const granted = await chrome.permissions.request({ permissions: ["tabs"] }).catch(() => false);
  if (!granted) return;
  chooseSharing(true);
  await syncSharing();
});
chrome.permissions.onRemoved.addListener(({ permissions = [] }) => {
  if (!permissions.includes("tabs")) return;
  chooseSharing(false);
  syncSharing();
});

function stopPolling() {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
}

// Waits for the sign-in tab to finish, checking only while the panel is visible.
function waitForSignIn() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    if ((await sessionState()) === "signed-in") showApp();
  }, SIGN_IN_POLL_MS);
}

async function start() {
  const state = await sessionState();
  if (state === "signed-in") {
    showApp();
  } else if (state === "signed-out") {
    showNotice("signInTitle", t("signIn"), () => {
      openTab(AGENT_URL);
      waitForSignIn();
    });
    secondary.hidden = true;
  } else {
    showNotice("unavailableTitle", t("retry"), start);
    secondary.hidden = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && app.hidden && pollTimer === null) start();
});

start();
