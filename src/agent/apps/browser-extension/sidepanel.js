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

document.documentElement.lang = chrome.i18n.getUILanguage();

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

function showNotice(text, primaryLabel, onPrimary) {
  app.hidden = true;
  notice.hidden = false;
  title.textContent = text;
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
    showNotice(t("signInTitle"), t("signIn"), () => {
      openTab(AGENT_URL);
      waitForSignIn();
    });
    secondary.hidden = true;
  } else {
    showNotice(t("unavailableTitle"), t("retry"), start);
    secondary.hidden = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && app.hidden && pollTimer === null) start();
});

start();
