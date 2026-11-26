// Injected with chrome.scripting.executeScript into the extension's isolated world of one tab.
// It must stay self-contained: Chrome serializes only this function, never the module around it.
// Refs live in a Map of the isolated world, never in DOM attributes, so a page cannot move one.
// It reads no cookies or storage, and omits the values of secret, payment and hidden fields.
export function snapshotPage(limit) {
  const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;
  const SECRET_NAME = /pass(word)?|pwd|otp|cvc|cvv|card.?num|iban|security.?code|pin\b/i;
  const INTERACTIVE_ROLES = ["button", "link", "textbox", "checkbox", "radio", "menuitem", "tab", "option", "switch", "combobox"];

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea" || el.isContentEditable) return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "file") return "file upload";
      return "textbox";
    }
    return tag;
  };
  const interactive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (["a", "button", "input", "textarea", "select", "summary"].includes(tag)) return !(tag === "input" && el.type === "hidden");
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    return Boolean(role && INTERACTIVE_ROLES.includes(role));
  };
  const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const nameOf = (el) => clean(
    el.getAttribute("aria-label") ||
    Array.from(el.labels || []).map((label) => label.textContent).join(" ") ||
    el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") ||
    el.innerText || el.textContent || el.getAttribute("name") || "",
    80,
  );
  const secret = (el) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden")) return true;
    return SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "") ||
      SECRET_NAME.test(`${el.name} ${el.id} ${el.getAttribute("aria-label") || ""}`);
  };

  const refs = new Map();
  globalThis.__mycelliosRefs = refs;
  const lines = [];
  let count = 0;
  for (const el of document.querySelectorAll("a[href], button, input, textarea, select, summary, [role], [contenteditable='true']")) {
    if (count >= 400) break;
    if (!interactive(el) || !visible(el)) continue;
    count += 1;
    const ref = `e${count}`;
    refs.set(ref, new WeakRef(el));
    let value = "";
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.value !== "") {
      value = secret(el) ? " value=(hidden)" : ` value=${JSON.stringify(clean(el.value, 200))}`;
    }
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) value = el.checked ? " checked" : "";
    lines.push(`- ${roleOf(el)} "${nameOf(el)}" [${ref}]${value}`);
  }

  // Hidden secret fields never reach innerText; visible field values come only from the tree above.
  const text = (document.body?.innerText || "").slice(0, limit);
  const body = `Page text:\n${text.replace(/\n{3,}/g, "\n\n").trim()}\n\nInteractive elements:\n${lines.join("\n") || "(none)"}`;
  const truncated = body.length > limit;
  return {
    title: clean(document.title, 200),
    href: location.href,
    text: truncated ? body.slice(0, limit) : body,
    truncated,
  };
}
