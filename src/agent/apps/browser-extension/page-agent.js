// Injected with chrome.scripting.executeScript into the extension's isolated world of one tab.
// It must stay self-contained: Chrome serializes only this function, never the module around it.
// Refs live in a Map of the isolated world, never in DOM attributes, so a page cannot move one.
// It reads no cookies or storage, and omits the values of secret, payment and hidden fields.
export function snapshotPage(limit) {
  const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;
  const SECRET_NAME = /pass(word)?|pwd|otp|cvc|cvv|card.?num|iban|security.?code|pin\b/i;
  const INTERACTIVE_ROLES = [
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "menuitem",
    "tab",
    "option",
    "switch",
    "combobox",
  ];

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      return false;
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
    if (["a", "button", "input", "textarea", "select", "summary"].includes(tag))
      return !(tag === "input" && el.type === "hidden");
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    return Boolean(role && INTERACTIVE_ROLES.includes(role));
  };
  const clean = (value, max) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const nameOf = (el) =>
    clean(
      el.getAttribute("aria-label") ||
        Array.from(el.labels || [])
          .map((label) => label.textContent)
          .join(" ") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        el.innerText ||
        el.textContent ||
        el.getAttribute("name") ||
        "",
      80,
    );
  const secret = (el) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden"))
      return true;
    return (
      SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "") ||
      SECRET_NAME.test(`${el.name} ${el.id} ${el.getAttribute("aria-label") || ""}`)
    );
  };

  const refs = new Map();
  globalThis.__mycelliosRefs = refs;
  const lines = [];
  let count = 0;
  for (const el of document.querySelectorAll(
    "a[href], button, input, textarea, select, summary, [role], [contenteditable='true']",
  )) {
    if (count >= 400) break;
    if (!interactive(el) || !visible(el)) continue;
    count += 1;
    const ref = `e${count}`;
    refs.set(ref, new WeakRef(el));
    let value = "";
    if (
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.value !== ""
    ) {
      value = secret(el) ? " value=(hidden)" : ` value=${JSON.stringify(clean(el.value, 200))}`;
    }
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
      value = el.checked ? " checked" : "";
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

// Acting (specs/agent-chrome-tabs, phase 3). Each function below is injected on its own, so each
// stays self-contained. State lives only in this isolated world (refs, the overlay and the person's
// last input), never in the page's DOM attributes, and the script accepts no message from the page.

/**
 * Called before a Mico works in the tab: starts watching for the person's own input (so the Mico
 * yields to them) and shows who is working: a flat border in the Mico's color, its name, and a
 * cursor that moves to each click. The overlay is cosmetic: a page can hide it, which is why the
 * tab group and the panel are the indicators a page cannot forge. Closed shadow root, no pointer
 * events, no gradients, and its motion stops for reduced-motion preferences.
 */
export function preparePage(mico) {
  const HEX = {
    grey: "#5f6368",
    blue: "#1a73e8",
    red: "#d93025",
    yellow: "#f9ab00",
    green: "#188038",
    pink: "#d01884",
    purple: "#9334e6",
    cyan: "#007b83",
    orange: "#e8710a",
  };
  const color = HEX[mico?.color] || HEX.green;
  const name =
    String(mico?.name ?? "Mico")
      .replace(/[\p{Cc}<>]/gu, "")
      .slice(0, 32) || "Mico";
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!globalThis.__mycelliosGuard) {
    const stamp = (event) => {
      if (event.isTrusted) globalThis.__mycelliosPersonAt = Date.now();
    };
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"])
      addEventListener(type, stamp, { capture: true, passive: true });
    globalThis.__mycelliosGuard = true;
  }
  const person = Date.now() - (globalThis.__mycelliosPersonAt ?? 0) < 3000;

  globalThis.__mycelliosOverlay?.remove();
  const host = document.createElement("div");
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  const root = host.attachShadow({ mode: "closed" });
  const frame = document.createElement("div");
  Object.assign(frame.style, {
    position: "fixed",
    inset: "0",
    boxSizing: "border-box",
    border: `4px solid ${color}`,
    pointerEvents: "none",
  });
  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "fixed",
    top: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "2px 10px",
    background: color,
    color: "#fff",
    font: "600 12px/18px system-ui, sans-serif",
    borderRadius: "999px",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  });
  label.textContent = name;
  const cursor = document.createElement("div");
  Object.assign(cursor.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "14px",
    height: "14px",
    boxSizing: "border-box",
    borderRadius: "50%",
    background: color,
    border: "2px solid #fff",
    pointerEvents: "none",
    opacity: "0",
  });
  root.append(frame, label, cursor);
  (document.documentElement || document.body).append(host);
  if (!reduced && typeof frame.animate === "function") {
    frame.animate([{ opacity: 0.55 }, { opacity: 1 }], {
      duration: 1400,
      iterations: Infinity,
      direction: "alternate",
    });
  }
  let at = null;
  globalThis.__mycelliosOverlay = {
    move(x, y) {
      const to = `translate(${Math.round(x - 7)}px, ${Math.round(y - 7)}px)`;
      cursor.style.opacity = "1";
      if (!reduced && at && typeof cursor.animate === "function") {
        cursor.animate([{ transform: at }, { transform: to }], {
          duration: 320,
          fill: "forwards",
          easing: "ease-in-out",
        });
      }
      cursor.style.transform = to;
      at = to;
    },
    remove() {
      host.remove();
      globalThis.__mycelliosOverlay = undefined;
    },
  };
  return { person, href: location.href };
}

/** Removes the overlay when the Mico is done with the tab, or sharing stops. */
export function releasePage() {
  globalThis.__mycelliosOverlay?.remove();
}

/**
 * What one action is about to touch, described plainly for the extension's consent rules (which
 * decide there, not here): the field or the clicked element, the form around it and any payment
 * frames on the page. It reads no values.
 */
export function describeAction(action) {
  const refs = globalThis.__mycelliosRefs;
  const active =
    document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  const el = action.ref ? refs?.get(action.ref)?.deref() : active;
  if (action.ref && !el?.isConnected) return { error: "stale_ref" };
  const clean = (value, max) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const form = el?.closest ? el.closest("form") : null;
  const fields = form ? Array.from(form.querySelectorAll("input, select, textarea")) : [];
  const attribute = (node, name) => (node.getAttribute ? node.getAttribute(name) || "" : "");
  const formHasPassword = fields.some(
    (field) =>
      field.type === "password" ||
      /\b(current-password|new-password)\b/i.test(attribute(field, "autocomplete")),
  );
  const formHasPayment = fields.some(
    (field) =>
      /\bcc-[a-z-]+\b/i.test(attribute(field, "autocomplete")) ||
      /card.?num|\bcv[cv]\b|\biban\b/i.test(`${field.name} ${field.id}`),
  );
  const tag = el?.tagName?.toLowerCase() ?? "";
  const type = String(el?.getAttribute ? el.getAttribute("type") || "" : "").toLowerCase();
  const submitsForm =
    Boolean(form) &&
    ((tag === "button" && (type === "" || type === "submit")) ||
      (tag === "input" && (type === "submit" || type === "image")));
  const label = clean(
    attribute(el ?? document.body, "aria-label") ||
      Array.from(el?.labels || [])
        .map((item) => item.textContent)
        .join(" ") ||
      attribute(el ?? document.body, "placeholder") ||
      attribute(el ?? document.body, "title"),
    120,
  );
  return {
    // The person's own input wins: a Mico stops when they start using the tab.
    person: Date.now() - (globalThis.__mycelliosPersonAt ?? 0) < 3000,
    field: {
      type: el?.type ?? type,
      autocomplete: attribute(el ?? document.body, "autocomplete"),
      name: el?.name ?? "",
      id: el?.id ?? "",
      label,
    },
    target: {
      submitsForm,
      inForm: Boolean(form),
      formHasPassword,
      formHasPayment,
      href: el?.closest ? (el.closest("a")?.href ?? "") : "",
      text: clean(el?.innerText ?? el?.textContent ?? el?.value ?? "", 120),
    },
    frameSources: Array.from(document.querySelectorAll("iframe[src]"))
      .slice(0, 12)
      .map((frame) => frame.src),
  };
}

/**
 * Performs one action by ref and reports whether its effect could be seen. Events come from the
 * extension, not the person (isTrusted is false) and some sites ignore them: then the result says
 * the effect was not confirmed, never that it was done.
 */
export async function performAction(action) {
  const refs = globalThis.__mycelliosRefs;
  const el = action.ref ? refs?.get(action.ref)?.deref() : undefined;
  if (action.ref && !el?.isConnected) return { ok: false, note: "stale ref: take a new snapshot" };
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const content = (node) => (node ? (node.innerText ?? node.textContent ?? "") : "");
  const fingerprint = (node) =>
    [
      location.href,
      content(document.body).length,
      document.querySelectorAll("*").length,
      node && "checked" in node ? node.checked : "",
      node && "value" in node ? node.value : "",
    ].join("|");
  const pointAt = (node) => {
    if (!node?.getBoundingClientRect) return;
    const rect = node.getBoundingClientRect();
    globalThis.__mycelliosOverlay?.move(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const reveal = (node) => {
    if (typeof node?.scrollIntoView === "function")
      node.scrollIntoView({ block: "center", inline: "center" });
  };
  const setValue = (node, value) => {
    const proto =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : node instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(node, value);
    else node.value = value;
  };
  const textField = (node) => {
    if (node instanceof HTMLTextAreaElement) return true;
    if (node instanceof HTMLInputElement)
      return ![
        "checkbox",
        "radio",
        "button",
        "submit",
        "file",
        "hidden",
        "reset",
        "image",
        "range",
        "color",
      ].includes(node.type);
    return Boolean(node?.isContentEditable);
  };
  const read = (node) =>
    node?.isContentEditable && !("value" in node) ? node.textContent : node.value;

  if (action.kind === "click") {
    if (!el) return { ok: false, note: "click needs an element ref" };
    if (el.disabled || el.getAttribute?.("aria-disabled") === "true")
      return { ok: false, note: "the element is disabled" };
    reveal(el);
    pointAt(el);
    if (!reduced) await pause(350);
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint?.(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
      return { ok: false, note: "another element covers it" };
    const before = fingerprint(el);
    for (const type of ["mouseover", "mousedown", "mouseup"])
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    el.focus?.();
    el.click();
    await pause(400);
    return fingerprint(el) === before
      ? { ok: false, note: "not confirmed: nothing visibly changed" }
      : { ok: true };
  }

  if (action.kind === "fill" || action.kind === "type") {
    if (!el || !textField(el)) return { ok: false, note: "not a text field" };
    if (el.disabled || el.readOnly) return { ok: false, note: "the field is not editable" };
    reveal(el);
    pointAt(el);
    el.focus?.();
    const text = String(action.text ?? "");
    const editable = el.isContentEditable && !("value" in el);
    const write = (value) => {
      if (editable) el.textContent = value;
      else setValue(el, value);
    };
    if (action.kind === "fill") {
      write(text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      write("");
      for (const char of text) {
        const init = { key: char, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent("keydown", init));
        el.dispatchEvent(new KeyboardEvent("keypress", init));
        write(read(el) + char);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", init));
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return read(el) === text
      ? { ok: true }
      : { ok: false, note: "not confirmed: the field shows different text" };
  }

  if (action.kind === "select") {
    if (!(el instanceof HTMLSelectElement)) return { ok: false, note: "not a select list" };
    if (el.disabled) return { ok: false, note: "the list is disabled" };
    const wanted = String(action.text ?? "")
      .trim()
      .toLowerCase();
    const option = Array.from(el.options).find(
      (item) => item.value.toLowerCase() === wanted || item.text.trim().toLowerCase() === wanted,
    );
    if (!option || option.disabled) return { ok: false, note: "no such option" };
    reveal(el);
    pointAt(el);
    setValue(el, option.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === option.value
      ? { ok: true }
      : { ok: false, note: "not confirmed: the option was not selected" };
  }

  if (action.kind === "scroll") {
    if (el) {
      reveal(el);
      pointAt(el);
      return { ok: true };
    }
    const before = [scrollX, scrollY].join(",");
    const dx = action.direction === "left" ? -0.8 : action.direction === "right" ? 0.8 : 0;
    const dy = action.direction === "up" ? -0.8 : action.direction === "down" ? 0.8 : 0;
    scrollBy(Math.round(dx * innerWidth), Math.round(dy * innerHeight));
    await pause(150);
    return [scrollX, scrollY].join(",") === before
      ? { ok: true, note: "already at the edge" }
      : { ok: true };
  }

  if (action.kind === "key") {
    const target = el ?? (document.activeElement || document.body);
    const parts = String(action.key ?? "").split("+");
    const main = parts.pop() || "";
    const mods = new Set(parts.map((part) => part.toLowerCase()));
    const init = {
      key: main,
      bubbles: true,
      cancelable: true,
      shiftKey: mods.has("shift"),
      ctrlKey: mods.has("control") || mods.has("ctrl"),
      altKey: mods.has("alt"),
      metaKey: mods.has("meta"),
    };
    pointAt(el);
    const before = fingerprint(target);
    const focusBefore = document.activeElement;
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    if (main.length === 1 || main === "Enter")
      target.dispatchEvent(new KeyboardEvent("keypress", init));
    // Synthetic keys do not trigger the browser's own behaviour, so the common ones are done here.
    if (main === "Enter") {
      const form = target.closest?.("form");
      if (target instanceof HTMLTextAreaElement || target.isContentEditable) {
        // A new line is the key's meaning there; nothing is submitted.
      } else if (
        target instanceof HTMLInputElement &&
        form &&
        !["button", "submit", "checkbox", "radio"].includes(target.type)
      ) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
      } else if (target.click) {
        target.click();
      }
    } else if (main === "Tab") {
      const focusable = Array.from(
        document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"),
      ).filter((node) => !node.disabled && node.tabIndex >= 0);
      const index = focusable.indexOf(target);
      const next =
        focusable[(index + (mods.has("shift") ? -1 : 1) + focusable.length) % focusable.length];
      next?.focus?.();
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    await pause(300);
    // Moving the focus is the visible effect of Tab.
    const changed = fingerprint(target) !== before || document.activeElement !== focusBefore;
    return changed ? { ok: true } : { ok: false, note: "not confirmed: nothing visibly changed" };
  }

  return { ok: false, note: "unsupported action" };
}
