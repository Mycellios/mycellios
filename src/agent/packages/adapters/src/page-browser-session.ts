import type {
  BrowserActResult,
  BrowserActStep,
  BrowserNavigateResult,
  BrowserSnapshotNode,
  BrowserSnapshotResult,
} from "@mycellios/adapter-kit";
import { JSDOM } from "jsdom";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='combobox']",
  "[role='menuitem']",
  "[contenteditable='true']",
].join(",");

const REOPEN_SAVED_SITE = "Open the saved site with browser_navigate, then fill again.";

/** Saved usernames are typed only into these input types. Textareas stay out: a username is an input. */
const USERNAME_INPUT_TYPES = new Set(["text", "email", "tel"]);

/** A step declined before the page changed, such as a saved-login fill: settled, not uncertain. */
class StepRefused extends Error {}

/** Page text compared the way a wait compares it: case and runs of spaces ignored. */
function plainText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type DomWindow = JSDOM["window"];
type DomElement = InstanceType<DomWindow["Element"]>;

/** In-process page session used by fake/emulator browser adapters (offline). */
export class PageBrowserSession {
  private dom: JSDOM;
  private refs = new Map<string, DomElement>();
  /** Fields holding a saved login; snapshots never report their values. */
  private loginFilled = new WeakSet<DomElement>();
  private nextRef = 1;

  constructor(
    url = "about:blank",
    html = "<!doctype html><html><head><title></title></head><body></body></html>",
  ) {
    this.dom = new JSDOM(html, { url, contentType: "text/html", pretendToBeVisual: true });
  }

  close(): void {
    this.dom.window.close();
    this.refs.clear();
  }

  get url(): string {
    return this.dom.window.location.href;
  }

  get title(): string {
    return this.dom.window.document.title || "";
  }

  load(url: string, html: string): BrowserNavigateResult {
    this.dom.window.close();
    this.dom = new JSDOM(html, { url, contentType: "text/html", pretendToBeVisual: true });
    this.refs.clear();
    return { url: this.url, title: this.title };
  }

  /** Part 0 is the whole page here: it lists every control, so there is never a later part. */
  snapshot(from = 0): BrowserSnapshotResult {
    if (from > 0) {
      return {
        url: this.url,
        title: this.title,
        tree: "",
        elements: [],
        error: `This page has 1 part(s), numbered from 0, so there is no part ${from}.`,
      };
    }
    const { elements, tree } = this.buildSnapshot();
    return {
      url: this.url,
      title: this.title,
      tree,
      elements,
    };
  }

  act(actions: BrowserActStep[]): BrowserActResult {
    let completed = 0;
    for (const action of actions) {
      const ref = "ref" in action ? action.ref : undefined;
      const el = ref ? this.refs.get(ref) : undefined;
      if (ref && !el) {
        const snap = this.snapshot();
        return {
          ok: false,
          completed,
          url: snap.url,
          title: snap.title,
          tree: snap.tree,
          elements: snap.elements,
          error: `Unknown element ref "${ref}". Call browser_snapshot and use a fresh ref.`,
          fallback: "computer_act",
        };
      }
      try {
        this.applyAction(el, action);
      } catch (error) {
        const snap = this.snapshot();
        return {
          ok: false,
          completed,
          url: snap.url,
          title: snap.title,
          tree: snap.tree,
          elements: snap.elements,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof StepRefused
            ? { uncertain: false }
            : { fallback: "computer_act" as const }),
        };
      }
      completed += 1;
    }
    const snap = this.snapshot();
    return {
      ok: true,
      completed,
      url: snap.url,
      title: snap.title,
      tree: snap.tree,
      elements: snap.elements,
    };
  }

  private applyAction(target: DomElement | undefined, action: BrowserActStep): void {
    const win = this.dom.window;
    const document = win.document;
    if (action.kind === "dialog") {
      throw new StepRefused(
        "No dialog from your steps is open on this page, so there is nothing to answer.",
      );
    }
    if (action.kind === "wait") {
      // An in-process page does not change by itself, so a wait only checks it once.
      const shown = plainText(document.body?.textContent ?? "");
      const found = action.text !== undefined && shown.includes(plainText(action.text));
      const met =
        action.until === "quiet" ||
        (action.until === "text" && found) ||
        (action.until === "gone" && !found) ||
        (action.until === "url" && action.text !== undefined && this.url.includes(action.text));
      if (!met)
        throw new StepRefused(`The page did not change as wait expected (${action.until}).`);
      return;
    }
    if (action.kind === "press") {
      const focused = target ?? document.activeElement ?? document.body;
      if (target instanceof win.HTMLElement) target.focus();
      const key = action.key.split("+").pop() ?? action.key;
      for (const type of ["keydown", "keyup"]) {
        focused?.dispatchEvent(
          new win.KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
        );
      }
      return;
    }
    if (action.kind === "scroll") return;
    // From here on, every step names an element.
    const el = target as DomElement;
    if (action.kind === "hover") {
      for (const type of ["mouseover", "mouseenter", "mousemove"]) {
        el.dispatchEvent(new win.MouseEvent(type, { bubbles: type !== "mouseenter" }));
      }
      return;
    }
    if (action.kind === "upload") {
      if (!(el instanceof win.HTMLInputElement) || el.type !== "file") {
        throw new Error("upload needs a file upload element from browser_snapshot");
      }
      if (action.paths.length > 1 && !el.multiple) {
        throw new Error("This file upload accepts one file");
      }
      // jsdom cannot build a FileList, so page handlers get named, empty files instead.
      const files = action.paths.map((path) => new win.File([], path.split("/").pop() ?? path));
      Object.defineProperty(el, "files", { configurable: true, value: files });
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
      return;
    }
    if (action.kind === "click") {
      if (el instanceof win.HTMLAnchorElement && el.href) {
        const next = new URL(el.href, this.url);
        if (next.href !== this.url) {
          // jsdom does not load a new document on location changes. Fall back so
          // callers use computer_act on the live browser instead of a false success.
          throw new Error(
            "In-process page browser cannot navigate links. Use computer_act on the desktop browser.",
          );
        }
      }
      el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
      // Checkboxes toggle via jsdom activation behavior. Force radios on; do not
      // invert checkboxes after dispatchEvent (that would undo the activation).
      if (el instanceof win.HTMLInputElement && el.type === "radio") {
        el.checked = true;
      }
      return;
    }
    if (action.kind === "fill" || action.kind === "type") {
      if (action.origin) {
        const page = new URL(this.url);
        let saved: URL;
        try {
          saved = new URL(action.origin);
        } catch {
          throw new StepRefused(`Website logins can only be filled on HTTPS. ${REOPEN_SAVED_SITE}`);
        }
        // Private-LAN HTTP never qualifies, even when the page origin matches.
        if (saved.protocol !== "https:" || page.protocol !== "https:") {
          throw new StepRefused(`Website logins can only be filled on HTTPS. ${REOPEN_SAVED_SITE}`);
        }
        if (page.origin !== saved.origin) {
          throw new StepRefused(
            `The page is not on the site this login was saved for. ${REOPEN_SAVED_SITE}`,
          );
        }
        const inputType = el instanceof win.HTMLInputElement ? el.type : "";
        // A password goes only into a password field, which never displays it.
        if (action.field !== "username" && inputType !== "password") {
          throw new StepRefused("A saved password can only be typed into a password field.");
        }
        if (action.field === "username" && !USERNAME_INPUT_TYPES.has(inputType)) {
          throw new StepRefused(
            "A saved username can only be typed into a text, email, or telephone field.",
          );
        }
      }
      const text = action.text;
      const formField = el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement;
      if (formField) {
        // Fill and type both replace the field, and with it any saved login.
        if (action.origin) this.loginFilled.add(el);
        else this.loginFilled.delete(el);
        el.value = text;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
        return;
      }
      if (el instanceof win.HTMLSelectElement) {
        const match = [...el.options].find((o) => o.value === text || o.text === text);
        el.value = match ? match.value : text;
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
        return;
      }
      if (el.getAttribute("contenteditable") === "true") {
        el.textContent = text;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        return;
      }
      throw new Error(`Ref ${action.ref} is not fillable`);
    }
    throw new Error(`Unsupported browser action ${action.kind}`);
  }

  private buildSnapshot(): { elements: BrowserSnapshotNode[]; tree: string } {
    this.refs.clear();
    const win = this.dom.window;
    const elements: BrowserSnapshotNode[] = [];
    const lines: string[] = [];
    const nodes = win.document.querySelectorAll(INTERACTIVE_SELECTOR);
    for (const node of nodes) {
      if (!(node instanceof win.Element)) continue;
      if (isIgnored(win, node)) continue;
      const ref = `e${this.nextRef++}`;
      this.refs.set(ref, node);
      const role = roleFor(win, node);
      const name = nameFor(win, node);
      const value = this.loginFilled.has(node) ? undefined : valueFor(win, node);
      const tag = node.tagName.toLowerCase();
      const entry: BrowserSnapshotNode = { ref, role, name, tag };
      if (value !== undefined) entry.value = value;
      elements.push(entry);
      const valuePart = value !== undefined ? ` value=${JSON.stringify(value)}` : "";
      lines.push(`- ${role} ${JSON.stringify(name)} [${ref}]${valuePart}`);
    }
    return { elements, tree: lines.join("\n") || "(no interactive elements)" };
  }
}

function isIgnored(win: DomWindow, el: DomElement): boolean {
  if (el instanceof win.HTMLInputElement && el.type === "hidden") return true;
  // Sites often aria-hide the real file input behind a styled button; it is still the upload target.
  if (el.getAttribute("aria-hidden") === "true")
    return !(el instanceof win.HTMLInputElement && el.type === "file");
  return false;
}

function roleFor(win: DomWindow, el: DomElement): string {
  if (el instanceof win.HTMLInputElement && el.type === "file") return "file upload";
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "summary") return "button";
  if (tag === "input" && el instanceof win.HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button" || type === "reset") return "button";
    return "textbox";
  }
  return tag;
}

function nameFor(win: DomWindow, el: DomElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  if (el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement) {
    const label = el.labels?.[0]?.textContent?.trim();
    if (label) return label;
    if (el.placeholder?.trim()) return el.placeholder.trim();
    if (el.name?.trim()) return el.name.trim();
  }
  const text = el.textContent?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 120);
  return el.tagName.toLowerCase();
}

function valueFor(win: DomWindow, el: DomElement): string | undefined {
  if (el instanceof win.HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "checked" : "unchecked";
    if (el.type === "file") return Array.from(el.files ?? [], (file) => file.name).join(", ");
    if (el.type === "password") return el.value ? "••••" : "";
    return el.value;
  }
  if (el instanceof win.HTMLTextAreaElement || el instanceof win.HTMLSelectElement) return el.value;
  return undefined;
}

/**
 * In-process page sessions for fake/emulator providers.
 * Callers must pass an isolation key that includes bot identity on Team
 * Computers (see `pageBrowserSessionKey`), never the bare computer id alone.
 */
export class PageBrowserSessionStore {
  private readonly sessions = new Map<string, PageBrowserSession>();

  get(sessionKey: string): PageBrowserSession {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = new PageBrowserSession();
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  clear(sessionKey?: string): void {
    if (sessionKey) {
      this.sessions.get(sessionKey)?.close();
      this.sessions.delete(sessionKey);
    } else {
      for (const session of this.sessions.values()) session.close();
      this.sessions.clear();
    }
  }
}

/**
 * Isolate page state per computer and running bot on Team Computers.
 * Prefer `context.botId` (the running bot). `computer.botId` is the home key and
 * is shared by every bot on a Team Computer, so it alone cannot isolate sessions.
 * Do not include screen-lease fences: the same bot reacquiring the computer must
 * keep the in-process page and element refs across renewals and takeover resumes.
 */
export function pageBrowserSessionKey(
  computer: { id: string; botId: string },
  context?: { botId?: string; browserThreadId?: string },
): string {
  const bot = context?.botId?.trim() || computer.botId;
  return context?.browserThreadId
    ? JSON.stringify([computer.id, bot, context.browserThreadId])
    : `${computer.id}::${bot}`;
}
