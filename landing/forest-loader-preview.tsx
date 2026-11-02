import { createRoot } from "react-dom/client";
import "./src/ui/agent-style.css";
import "./src/ui/agent-components.css";
import { ForestLoaderPreview } from "./src/rebrand/ForestLoaderPreview";

createRoot(document.getElementById("root")!).render(<ForestLoaderPreview />);
