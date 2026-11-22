// First: copies storage saved under the legacy key names before any module reads it.
import "../lib/legacy-storage";
import { createRoot } from "react-dom/client";
import { OAuthConsent } from "./OAuthConsent";
import { applyHostedChrome } from "./hosted-chrome";
import "@mycellios/ui-tokens/css";
import "../typography.css";
import "./login.css";

applyHostedChrome();
if (typeof matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", () => applyHostedChrome());
}
createRoot(document.getElementById("root")!).render(<OAuthConsent />);
