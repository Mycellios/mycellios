// A normal tab where the person allows the microphone for this extension. Chrome cannot show its
// permission prompt inside the side panel, and the framed Agent app takes dictation permission from
// the extension that embeds it, so the question is asked here once. Nothing is recorded: the stream
// is stopped as soon as the permission is granted.
const t = (key) => chrome.i18n.getMessage(key) || key;
const title = document.getElementById("notice-title");
const allow = document.getElementById("mic-allow");

document.documentElement.lang = chrome.i18n.getUILanguage();
title.textContent = t("micTitle");
allow.textContent = t("micAllow");

allow.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    title.textContent = t("micDone");
    allow.hidden = true;
  } catch {
    title.textContent = t("micDenied");
  }
});
