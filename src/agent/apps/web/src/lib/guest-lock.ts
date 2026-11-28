import { guestModeActive, promptGuestAccount, subscribeGuestMode } from "./guest-mode";

/**
 * In the guest shell every control is locked unless it, or a closer ancestor, carries
 * `data-guest-allowed`: features added later stay behind the account by default. A locked
 * control looks dimmed (styles.css) and opens the account offer instead of acting, and the
 * shell's keyboard shortcuts are withheld. The guest data layer refuses the same features on
 * its own and a guest has no Agent account at all; this only keeps the screen honest.
 */
const INTERACTIVE = "button, a[href], input, select, textarea, summary, [role=button], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=combobox], [role=option], [contenteditable=true]";
/** Text editing keys a guest keeps in the composer. */
const EDITING_KEYS = new Set(["a", "c", "v", "x", "z", "y", "arrowleft", "arrowright", "arrowup", "arrowdown", "backspace", "delete", "home", "end"]);

function shellOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  if (target === document.body || target === document.documentElement) return document.querySelector("[data-guest-shell]");
  return target.closest("[data-guest-shell]");
}

function allowed(control: Element, shell: Element): boolean {
  // Links and code actions inside a reply stay usable.
  const decision = control.closest("[data-guest-allowed], [data-guest-locked], .rk-chat-markdown");
  return Boolean(decision && shell.contains(decision) && !decision.hasAttribute("data-guest-locked"));
}

/** The locked control an event reached, or null when the event may proceed. */
export function guestLockedTarget(target: EventTarget | null): Element | null {
  const shell = shellOf(target);
  if (!shell || !(target instanceof Element)) return null;
  const control = target.closest(INTERACTIVE);
  if (!control || !shell.contains(control) || allowed(control, shell)) return null;
  return control;
}

export function installGuestLock(root: Window = window): () => void {
  const swallow = (event: Event) => {
    if (!guestLockedTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const offer = (event: Event) => {
    const control = guestLockedTarget(event.target);
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    promptGuestAccount(control.getAttribute("aria-label") ?? undefined);
  };
  const keys = (event: KeyboardEvent) => {
    const shell = shellOf(event.target);
    if (!shell || event.key === "Tab" || event.key === "Escape") return;
    const target = event.target as Element;
    const control = target.closest(INTERACTIVE);
    if (control && shell.contains(control) && allowed(control, shell)) {
      // The composer keeps typing and sending; the shell's own shortcuts are withheld.
      if ((event.ctrlKey || event.metaKey || event.altKey) && !EDITING_KEYS.has(event.key.toLowerCase())) event.stopImmediatePropagation();
      return;
    }
    if (control && shell.contains(control)) {
      if (event.key === "Enter" || event.key === " ") offer(event);
      else { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    // Outside any control: the browser keeps scrolling and its own shortcuts, the shell gets nothing.
    event.stopImmediatePropagation();
  };
  const contextMenu = (event: MouseEvent) => {
    // Custom context menus (Mico, message and tab actions) need an account.
    if (!shellOf(event.target) || (event.target as Element).closest("[data-guest-allowed-context], .rk-chat-markdown, textarea")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointerTypes = ["pointerdown", "mousedown", "touchstart", "pointerup", "mouseup", "auxclick", "dblclick"];
  const options = { capture: true } as const;
  for (const type of pointerTypes) root.addEventListener(type, swallow, options);
  root.addEventListener("click", offer, options);
  root.addEventListener("keydown", keys, options);
  root.addEventListener("contextmenu", contextMenu, options);
  return () => {
    for (const type of pointerTypes) root.removeEventListener(type, swallow, options);
    root.removeEventListener("click", offer, options);
    root.removeEventListener("keydown", keys, options);
    root.removeEventListener("contextmenu", contextMenu, options);
  };
}

let uninstall: (() => void) | null = null;

/**
 * Installs the lock before the shell mounts, so its window listeners run ahead of the shell's own
 * shortcut handlers, and removes it when guest mode ends.
 */
export function ensureGuestLock(): void {
  if (uninstall || typeof window === "undefined") return;
  const remove = installGuestLock();
  const unsubscribe = subscribeGuestMode(() => {
    if (guestModeActive()) return;
    remove();
    unsubscribe();
    uninstall = null;
  });
  uninstall = () => { remove(); unsubscribe(); };
}
