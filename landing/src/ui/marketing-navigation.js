/** Shared enhancement for the React and server-rendered native disclosures. */
export function attachMarketingNavigation() {
  const close = (header, restoreFocus = false) => {
    const opened = [...header.querySelectorAll("details[open]")].reverse();
    if (restoreFocus) {
      const visible = opened.find(details => details.getClientRects().length);
      if (!visible) return;
      visible.open = false; visible.querySelector("summary")?.focus();
    } else opened.forEach(details => { details.open = false; });
  };
  const pointer = event => document.querySelectorAll(".marketing-header").forEach(header => {
    if (!header.contains(event.target)) close(header);
  });
  const keyboard = event => {
    if (event.key === "Escape") document.querySelectorAll(".marketing-header").forEach(header => close(header, true));
  };
  const navigate = event => {
    if (event.target.closest?.(".marketing-header a")) close(event.target.closest(".marketing-header"));
  };
  document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", keyboard); document.addEventListener("click", navigate);
  return () => {
    document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); document.removeEventListener("click", navigate);
  };
}

if (typeof document !== "undefined") {
  const dispose = attachMarketingNavigation();
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
