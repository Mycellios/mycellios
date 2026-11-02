const { ipcRenderer } = require("electron");
window.addEventListener("DOMContentLoaded", () => {
  for (const button of document.querySelectorAll("button[data-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (["close", "minimize", "maximize"].includes(action)) {
        ipcRenderer.send("desktop.chrome.action", action);
      }
    });
  }
});
