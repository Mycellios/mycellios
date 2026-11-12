/** Keep keyboard orientation without leaving pointer-triggered focus halos behind. */
export function installFocusInput() {
  const root = document.documentElement;
  root.dataset.focusInput = "pointer";
  const pointer = () => { root.dataset.focusInput = "pointer"; };
  const keyboard = (event: KeyboardEvent) => {
    if (["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      && !event.metaKey && !event.ctrlKey && !event.altKey) root.dataset.focusInput = "keyboard";
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.focusInput;
  };
}
