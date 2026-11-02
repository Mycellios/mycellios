// Legacy dashboard fallback. Prefer the panel's own Agent navigation when present.
(() => {
  const installed = "__mycelliosAgentNavigationMounted";
  if (window[installed]) return;
  window[installed] = true;
  const id = "mycellios-agent-navigation";
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".account-signout")) return;
    void fetch("/agent/api/auth/sign-out", {
      method: "POST", credentials: "include", keepalive: true,
      headers: { "content-type": "application/json" }, body: "{}",
    }).catch(() => undefined);
  }, { capture: true });

  function mount() {
    const nav = document.querySelector("#panel-navigation nav");
    const fallback = document.getElementById(id);
    const nativeEntry = nav && [...nav.querySelectorAll("a[href]")].some((link) => {
      try {
        const url = new URL(link.getAttribute("href"), window.location.href);
        return url.origin === window.location.origin && /^\/agent\/?$/.test(url.pathname);
      } catch { return false; }
    });
    if (nativeEntry) { fallback?.remove(); return; }
    if (!nav || fallback) return;
    const entry = document.createElement("button");
    entry.id = id; entry.type = "button";
    entry.setAttribute("aria-label", "Agent"); entry.title = "Agent";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({ width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) icon.setAttribute(name, value);
    const path = document.createElementNS(icon.namespaceURI, "path");
    path.setAttribute("d", "M12 3v3m-4 5h.01M16 11h.01M9 15h6M5 7h14v12H5zM2 11v4m20-4v4");
    icon.append(path);
    const label = document.createElement("span"); label.textContent = "Agent";
    entry.append(icon, label);
    entry.addEventListener("click", () => window.location.assign("/agent"));
    nav.append(entry);
  }
  const observer = new MutationObserver(mount);
  function start() {
    mount();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.addEventListener("pagehide", () => observer.disconnect());
  window.addEventListener("pageshow", start);
})();
