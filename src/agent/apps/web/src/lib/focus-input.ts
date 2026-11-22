/** Keep keyboard orientation without leaving pointer-triggered focus halos behind. */
export function installFocusInput() {
  const root = document.documentElement;
  root.dataset.focusInput = "pointer";
  const mobile = () => window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches;
  const textField = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const field = target.closest<HTMLElement>('textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (field instanceof HTMLInputElement && !["text", "search", "email", "url", "tel", "password", "number"].includes(field.type)) return null;
    return field;
  };
  let intendedField: HTMLElement | null = null;
  const pointer = (event: PointerEvent) => {
    root.dataset.focusInput = "pointer";
    const target = event.target instanceof Element ? event.target : null;
    const label = target?.closest("label");
    intendedField = textField(target) ?? textField(label?.control ?? null);
    if (!mobile() || intendedField) return;
    const active = textField(document.activeElement);
    // Controls next to the field (send, attach, dictation) keep typing open. Closing the
    // keyboard on pointerdown would move them under the finger before the click lands.
    if (active && target && active.closest("fieldset, form")?.contains(target)) { intendedField = active; return; }
    active?.blur();
  };
  // A menu's focus restoration or a new conversation must not summon the phone
  // keyboard. A direct field/label tap or hardware keyboard navigation still can.
  const focus = (event: FocusEvent) => {
    const field = textField(event.target);
    if (mobile() && root.dataset.focusInput !== "keyboard" && field && field !== intendedField) field.blur();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      && !event.metaKey && !event.ctrlKey && !event.altKey) root.dataset.focusInput = "keyboard";
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("focusin", focus, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("focusin", focus, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.focusInput;
  };
}
