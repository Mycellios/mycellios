// Opens the hosted Mycellios Agent in the side panel. The hosted app's CSP lets only this
// extension's origin frame it; sign-in happens in a normal tab because the identity pages refuse
// to be framed, and the panel picks up the shared session once it exists.
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
}

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
