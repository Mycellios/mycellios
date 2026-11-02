/* Optional development bridge. Include on a page you own to select elements from Agent. */
(() => {
  let session = null;
  let ownerOrigin = null;
  let enabled = false;
  let highlighted = null;
  let previousOutline = "";
  function clear() {
    if (highlighted) highlighted.style.outline = previousOutline;
    highlighted = null;
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || parent === window) return;
    if (event.data?.type !== "mycellios:inspect" || typeof event.data.session !== "string") return;
    // The first parent binds this frame's session. Other origins cannot replace it.
    if (ownerOrigin !== null && ownerOrigin !== event.origin) return;
    ownerOrigin = event.origin;
    session = event.data.session;
    enabled = event.data.enabled === true;
    clear();
    parent.postMessage(
      { type: "mycellios:ready", session },
      ownerOrigin === "null" ? "*" : ownerOrigin,
    );
  });
  document.addEventListener(
    "pointerover",
    (event) => {
      if (!enabled || !(event.target instanceof HTMLElement)) return;
      clear();
      highlighted = event.target;
      previousOutline = highlighted.style.outline;
      highlighted.style.outline = "2px solid currentColor";
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!enabled || !session || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = event.target;
      clear();
      const parts = [];
      let node = element;
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
      // Exclude fields, editable controls and hidden text, including ancestor selections.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const chunks = [];
      let child;
      while ((child = walker.nextNode()) && chunks.join(" ").length < 2000) {
        const host = child.parentElement;
        if (!host || host.closest("input,textarea,select,[contenteditable],script,style,[hidden]"))
          continue;
        const style = getComputedStyle(host);
        if (!host.getClientRects().length || style.visibility !== "visible") continue;
        chunks.push(child.textContent ?? "");
      }
      const text = chunks.join(" ").trim().slice(0, 2000);
      parent.postMessage(
        { type: "mycellios:selection", session, selector: parts.join(" > "), text },
        ownerOrigin === "null" ? "*" : ownerOrigin,
      );
    },
    true,
  );
  addEventListener("pagehide", clear);
})();
