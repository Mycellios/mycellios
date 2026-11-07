import { createRoot } from "react-dom/client";
import { Panel } from "../../landing/src/Panel";
import { applySeoMetadata } from "../../landing/src/seo";
import { initializeDesignProfile } from "../../landing/src/ui/design-profile";
import "./styles.css";
import "../../landing/src/button-style.css";
import "../../landing/src/logo-style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing mobile root element");

initializeDesignProfile();
applySeoMetadata("/browser/");
createRoot(root).render(<Panel mobileEntry />);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" });
  });
}
