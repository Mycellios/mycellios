import { createRoot } from "react-dom/client";
import { OAuthConsent } from "./OAuthConsent";
import "@rakazo/ui-tokens/css";
import "../typography.css";
import "./login.css";

document.documentElement.dataset.theme = "light";
createRoot(document.getElementById("root")!).render(<OAuthConsent />);
