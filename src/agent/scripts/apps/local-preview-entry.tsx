// Private local preview only. The release integration is Shell.tsx, not this DOM adapter.
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { setupI18n } from "@lingui/core";
import { AppsOverlay } from "../../apps/web/src/pages/AppsOverlay";
import "../../apps/web/src/styles.css";

const host = document.createElement("div");
host.dataset.appsLocalPreview = "true";
document.body.append(host);
const root: Root = createRoot(host);
const i18n = setupI18n({ locale: "es", messages: { es: {} } });
let opened = false;
let scope = "";
function render() {
  const owner = document.documentElement.getAttribute("data-preview-owner");
  const space = localStorage.getItem("rakazo:space-id");
  const next = `${owner}:${space}`;
  const allowed = Boolean(
    window.rakazoDesktop?.appsStudio && /\/app(?:\/|$)/.test(location.pathname),
  );
  if (scope !== next || !allowed) opened = false;
  scope = next;
  root.render(
    opened ? (
      <I18nProvider i18n={i18n}>
        <AppsOverlay
          key={scope}
          scope={scope}
          onClose={() => {
            opened = false;
            render();
          }}
        />
      </I18nProvider>
    ) : null,
  );
}
function ensureMenu() {
  if (!/\/app(?:\/|$)/.test(location.pathname)) return;
  const sidebar = document.querySelector('[data-testid="bots-sidebar"]');
  if (!sidebar || sidebar.querySelector('[aria-label="Apps"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Apps");
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Apps</span>';
  button.className = "apps-local-menu";
  button.addEventListener("click", () => {
    opened = true;
    render();
  });
  // Stable sidebar header, independent of other agents' project/conversation markup.
  const header = sidebar.querySelector(".app-drag");
  if (header) header.after(button); else sidebar.prepend(button);
}
const observer = new MutationObserver(() => {
  ensureMenu();
  const next = `${document.documentElement.getAttribute("data-preview-owner")}:${localStorage.getItem("rakazo:space-id")}`;
  if (scope !== next || (opened && !/\/app(?:\/|$)/.test(location.pathname))) render();
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["data-preview-owner"],
});
window.addEventListener("storage", render);
window.addEventListener("popstate", render);
ensureMenu();
render();
