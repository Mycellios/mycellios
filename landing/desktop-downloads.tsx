import { createRoot } from "react-dom/client";
import "./src/ui/agent-style.css";
import "./src/ui/agent-components.css";
import { DesktopDownloads } from "./src/DesktopDownloads";
import "./desktop-page.css";
createRoot(document.getElementById("root")!).render(<DesktopDownloads />);
