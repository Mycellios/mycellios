const { ipcRenderer } = require("electron");

// Isolated preload only: no bridge or IPC capability is exposed to the webpage.
let enabled = false;
let token = "";
let picker;
let highlight;
let observer;
const clear = () => {
  highlight?.remove();
  highlight = undefined;
};
function removePicker() {
  observer?.disconnect();
  observer = undefined;
  try {
    picker?.hidePopover?.();
  } catch {
    /* Already closed or navigating. */
  }
  picker?.remove();
  picker = undefined;
  clear();
}
function promotePicker() {
  if (!picker || !enabled) return;
  // A picker outside a modal dialog would be inert. Keep it in that dialog's subtree.
  const focused = document.activeElement?.closest("dialog[open]");
  const modal =
    focused ??
    [...document.querySelectorAll("dialog[open]")].reverse().find((dialog) => {
      try {
        return dialog.matches(":modal");
      } catch {
        return false;
      }
    });
  const host = modal ?? document.documentElement;
  if (picker.parentElement !== host) host.append(picker);
  try {
    picker.hidePopover?.();
    picker.showPopover?.();
  } catch {
    /* Fixed overlay on older engines. */
  }
}
function installPicker() {
  removePicker();
  if (!enabled || !document.documentElement) return;
  picker = document.createElement("div");
  picker.setAttribute("popover", "manual");
  picker.setAttribute("aria-hidden", "true");
  Object.assign(picker.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    maxWidth: "none",
    maxHeight: "none",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    display: "block",
    zIndex: "2147483647",
    pointerEvents: "auto",
    cursor: "crosshair",
  });
  promotePicker();
  observer = new MutationObserver(promotePicker);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
}
function pickedElement(event) {
  if (!(event.target instanceof Element)) return null;
  if (!picker?.contains(event.target)) return event.target;
  // Hit-test the top document, so an iframe is selected as a container. The real
  // click stays on our overlay and can never activate controls inside the frame.
  picker.style.pointerEvents = "none";
  const target = document.elementFromPoint(event.clientX, event.clientY);
  picker.style.pointerEvents = "auto";
  return target instanceof Element && target !== picker ? target : null;
}
ipcRenderer.on("desktop.preview.inspect", (_event, value) => {
  if (!value || typeof value.token !== "string") return;
  token = value.token;
  enabled = value.enabled === true;
  installPicker();
});
ipcRenderer.send("desktop.preview.ready");
document.addEventListener(
  "pointermove",
  (event) => {
    if (!enabled) return;
    const target = pickedElement(event);
    if (!target) return;
    clear();
    const rect = target.getBoundingClientRect();
    highlight = document.createElement("div");
    Object.assign(highlight.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      outline: "2px solid Highlight",
      outlineOffset: "-2px",
      borderRadius: "2px",
    });
    (picker ?? document.documentElement).append(highlight);
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    if (!enabled || !token || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = pickedElement(event);
    if (!target) return;
    enabled = false;
    removePicker();
    const parts = [];
    let node = target;
    while (node && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${CSS.escape(node.id)}`);
        break;
      }
      if (node.parentElement)
        part += `:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    const chunks = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (
      let child = walker.nextNode();
      child && chunks.join(" ").length < 2000;
      child = walker.nextNode()
    ) {
      const host = child.parentElement;
      if (!host || host.closest("input,textarea,select,[contenteditable],script,style,[hidden]"))
        continue;
      const style = getComputedStyle(host);
      if (host.getClientRects().length && style.visibility === "visible")
        chunks.push(child.textContent ?? "");
    }
    const rect = target.getBoundingClientRect();
    ipcRenderer.send("desktop.preview.selection", {
      token,
      selector: parts.join(" > ").slice(0, 1000),
      text: (
        chunks.join(" ").trim() ||
        target.getAttribute("title") ||
        target.getAttribute("aria-label") ||
        ""
      ).slice(0, 2000),
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (!enabled || !event.isTrusted || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enabled = false;
    removePicker();
    ipcRenderer.send("desktop.preview.cancel", { token });
  },
  true,
);
addEventListener("pagehide", () => {
  enabled = false;
  token = "";
  removePicker();
});
